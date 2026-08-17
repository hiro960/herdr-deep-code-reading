"use strict";

// Who last touched each line: the porcelain git speaks, and the layer it becomes.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const { BLAME_WIDTH, dateOf, labelFor, loadBlame, parseBlame } = require("../lib/blame");
const { createState, reduce, toScreenModel } = require("../lib/app-state");

const VIEWPORT = 20;
const COLUMNS = 179;
const GIT_IDENTITY = ["-c", "user.email=test@example.com", "-c", "user.name=herdr-deep-code-reading test"];

function run(cwd, args) {
  execFileSync("git", args, { cwd, stdio: "ignore" });
}

/** One run of blamed lines, as `--porcelain` writes it. */
function block(sha, finalLine, count, fields, text) {
  return [
    `${sha} ${finalLine} ${finalLine}${count === null ? "" : " " + count}`,
    ...fields,
    "\t" + text,
  ].join("\n");
}

const FULL_FIELDS = [
  "author A Reader",
  "author-mail <reader@example.com>",
  "author-time 1786744003",
  "author-tz +0900",
  "summary the subject",
  "filename a.js",
];

// --- the date -----------------------------------------------------------------

test("reads a timestamp in the author's own timezone", () => {
  // 1786744003 is 2026-08-14T21:46:43Z, which in +0900 is already the 15th
  assert.strictEqual(dateOf("1786744003", "+0000"), "2026-08-14");
  assert.strictEqual(dateOf("1786744003", "+0900"), "2026-08-15");
});

test("a negative offset moves the other way", () => {
  assert.strictEqual(dateOf("1786744003", "-0800"), "2026-08-14");
});

test("an unreadable timestamp is left blank rather than guessed", () => {
  assert.strictEqual(dateOf("not a number", "+0000"), "");
  assert.strictEqual(dateOf("", "+0000"), "");
});

test("a missing zone is read as UTC", () => {
  assert.strictEqual(dateOf("1786744003", undefined), "2026-08-14");
});

// --- the label ------------------------------------------------------------------

test("a label is a short sha and a date, and fits the column", () => {
  const label = labelFor({ sha: "0123456789abcdef0123456789abcdef01234567", date: "2026-08-15" });

  assert.strictEqual(label, "0123456 2026-08-15");
  assert.ok(label.length < BLAME_WIDTH, "the column needs a space after the label");
});

// --- the porcelain ----------------------------------------------------------------

test("labels one line from one block", () => {
  const stdout = block("0123456789abcdef", 1, 1, FULL_FIELDS, 'const x = 1;');

  assert.deepStrictEqual([...parseBlame(stdout)], [[1, "0123456 2026-08-15"]]);
});

test("a commit's details arrive once and cover its later runs", () => {
  // The whole reason the porcelain form is worth parsing: git sends `author` and
  // `author-time` the first time a commit appears and never again
  const stdout = [
    block("aaaaaaaaaaaa", 1, 2, FULL_FIELDS, "first"),
    block("aaaaaaaaaaaa", 2, null, ["previous bbbb a.js", "filename a.js"], "second"),
  ].join("\n");

  assert.deepStrictEqual([...parseBlame(stdout)], [
    [1, "aaaaaaa 2026-08-15"],
    [2, "aaaaaaa 2026-08-15"],
  ]);
});

test("two commits keep their own dates", () => {
  const stdout = [
    block("aaaaaaaaaaaa", 1, 1, FULL_FIELDS, "first"),
    block("bbbbbbbbbbbb", 2, 1, ["author B", "author-time 1600000000", "author-tz +0000"], "second"),
  ].join("\n");

  const labels = parseBlame(stdout);
  assert.strictEqual(labels.get(1), "aaaaaaa 2026-08-15");
  assert.strictEqual(labels.get(2), "bbbbbbb 2020-09-13");
});

test("nothing at all reads as no labels", () => {
  assert.strictEqual(parseBlame("").size, 0);
  assert.strictEqual(parseBlame("stray text with no header").size, 0);
});

// --- against a real repository ------------------------------------------------------

function makeRepo(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "herdr-deep-code-reading-blame-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  run(root, ["init", "-q"]);
  fs.mkdirSync(path.join(root, "lib"), { recursive: true });
  fs.writeFileSync(path.join(root, "lib", "a.js"), "one\ntwo\nthree\n");
  run(root, ["add", "-A"]);
  run(root, [...GIT_IDENTITY, "commit", "-qm", "first"]);

  fs.writeFileSync(path.join(root, "lib", "a.js"), "one\nsecond version\nthree\n");
  run(root, ["add", "-A"]);
  run(root, [...GIT_IDENTITY, "commit", "-qm", "second"]);

  return root;
}

test("blames every line of a real file", (t) => {
  const root = makeRepo(t);

  const result = loadBlame(root, "lib/a.js");

  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.labels.size, 3);
});

test("the changed line carries a different commit from its neighbours", (t) => {
  const root = makeRepo(t);
  const labels = loadBlame(root, "lib/a.js").labels;

  assert.strictEqual(labels.get(1), labels.get(3), "the untouched lines share a commit");
  assert.notStrictEqual(labels.get(2), labels.get(1));
});

test("a file git has never committed is reported, not thrown", (t) => {
  const root = makeRepo(t);
  fs.writeFileSync(path.join(root, "fresh.js"), "new\n");

  assert.strictEqual(loadBlame(root, "fresh.js").ok, false);
});

// --- the layer in the pane ------------------------------------------------------------

function reading(root) {
  const state = ["l", "l"].reduce(
    (current, key) => reduce(current, key, VIEWPORT),
    createState(root, "files", COLUMNS)
  );
  assert.strictEqual(state.view, "read");
  return state;
}

test("B puts a label beside every line", (t) => {
  const root = makeRepo(t);

  const blamed = reduce(reading(root), "B", VIEWPORT);

  assert.strictEqual(blamed.blame, true);
  assert.match(blamed.rows[0].cell.blame, /^[0-9a-f]{7} \d{4}-\d{2}-\d{2}$/);
  assert.strictEqual(blamed.rows[0].cell.text, "one", "the line itself is untouched");
});

test("B again takes the column away", (t) => {
  const root = makeRepo(t);
  const off = ["B", "B"].reduce((state, key) => reduce(state, key, VIEWPORT), reading(root));

  assert.strictEqual(off.blame, false);
  assert.strictEqual(off.rows[0].cell.blame, undefined);
});

test("the column is taken out of the width the lines are wrapped to", (t) => {
  // Not drawn over them: a row has to be exactly as wide as it was measured to be
  const root = makeRepo(t);
  // Long enough that the narrower width needs a row the wider one did not
  const long = "x".repeat(510);
  fs.writeFileSync(path.join(root, "lib", "a.js"), long + "\n");
  run(root, ["add", "-A"]);
  run(root, [...GIT_IDENTITY, "commit", "-qm", "a long line"]);

  const plain = reading(root);
  const blamed = reduce(plain, "B", VIEWPORT);

  const widthOf = (rows) => rows[0].cell.text.length;
  assert.strictEqual(widthOf(plain.rows) - widthOf(blamed.rows), BLAME_WIDTH);
  assert.ok(blamed.rows.length > plain.rows.length, "a narrower line needs more rows");
});

test("a wrapped line is labelled once, and keeps the column below it", (t) => {
  const root = makeRepo(t);
  fs.writeFileSync(path.join(root, "lib", "a.js"), "y".repeat(400) + "\n");
  run(root, ["add", "-A"]);
  run(root, [...GIT_IDENTITY, "commit", "-qm", "a long line"]);

  const blamed = reduce(reading(root), "B", VIEWPORT);

  assert.match(blamed.rows[0].cell.blame, /^[0-9a-f]{7}/);
  assert.strictEqual(blamed.rows[1].cell.blame, "", "the column is still there, unlabelled");
});

test("the reader stays on the line the rewrap moved", (t) => {
  const root = makeRepo(t);
  const onLineThree = ["j", "j"].reduce(
    (state, key) => reduce(state, key, VIEWPORT),
    reading(root)
  );
  assert.strictEqual(onLineThree.rows[onLineThree.cursor].cell.num, 3);

  const blamed = reduce(onLineThree, "B", VIEWPORT);

  assert.strictEqual(blamed.rows[blamed.cursor].cell.num, 3);
});

test("a file git cannot blame simply goes without", (t) => {
  const root = makeRepo(t);
  fs.writeFileSync(path.join(root, "fresh.js"), "brand new\n");
  const onFresh = ["l", "h", "j", "l"].reduce(
    (state, key) => reduce(state, key, VIEWPORT),
    createState(root, "files", COLUMNS)
  );
  assert.strictEqual(onFresh.openPath, "fresh.js");

  const blamed = reduce(onFresh, "B", VIEWPORT);

  assert.strictEqual(blamed.blame, true);
  assert.strictEqual(blamed.rows[0].cell.text, "brand new");
  assert.strictEqual(blamed.rows[0].cell.blame, undefined, "no column, and no refusal");
});

test("a diff has nothing to blame and says so", (t) => {
  // Every line of a diff already belongs to the change on screen
  const root = makeRepo(t);
  const asDiff = reduce(reading(root), "tab", VIEWPORT);

  const refused = reduce(asDiff, "B", VIEWPORT);

  assert.strictEqual(refused.blame, false, "the layer was turned on over a diff");
  assert.match(refused.message, /Tab/);
});

test("the reading view's footer offers it", (t) => {
  const root = makeRepo(t);

  assert.match(toScreenModel(reading(root)).help, /B blame/);
});

test("the diff view does not bind it", (t) => {
  const root = makeRepo(t);
  const diff = createState(root, "review", COLUMNS);

  assert.strictEqual(reduce(diff, "B", VIEWPORT), diff);
});
