"use strict";

// When a string arrived, and when it went.
//
// `H` asks what happened to this file and `B` asks who last touched each line. This
// asks the third question, which on unfamiliar code is usually the first one worth
// asking: where did this come from. git answers it with -S, which lists the commits
// where the number of times the string appears changed — not the ones that mention it.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const { createState, reduce, toScreenModel } = require("../lib/app-state");
const { historyTitle, loadCommits } = require("../lib/history");

const COLUMNS = 120;
const VIEWPORT = 20;

function commit(root, message) {
  execFileSync("git", ["add", "-A"], { cwd: root, stdio: "ignore" });
  execFileSync(
    "git",
    ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", message],
    { cwd: root, stdio: "ignore" }
  );
}

/**
 * A repository where one string is introduced, mentioned again without changing how
 * many times it appears, and then removed.
 */
function makeRepo(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "herdr-deep-code-reading-pickaxe-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  execFileSync("git", ["init", "-q"], { cwd: root, stdio: "ignore" });
  fs.writeFileSync(path.join(root, "a.js"), "const x = 1;\n");
  commit(root, "first");

  fs.writeFileSync(path.join(root, "a.js"), "const MAX_RETRIES = 3;\nconst x = 1;\n");
  commit(root, "introduce the constant");

  // Moved, not added or removed: the count is the same, so the pickaxe passes it over
  fs.writeFileSync(path.join(root, "a.js"), "const x = 1;\nconst MAX_RETRIES = 3;\n");
  commit(root, "reorder");

  fs.writeFileSync(path.join(root, "a.js"), "const x = 1;\n");
  commit(root, "take the constant away");

  fs.writeFileSync(path.join(root, "a.js"), "const x = 2;\n");

  return root;
}

function subjects(result) {
  return result.commits.map((entry) => entry.subject);
}

// --- what git is asked ---------------------------------------------------------------

test("the commits that changed how many times the string appears", (t) => {
  const found = loadCommits(makeRepo(t), { text: "MAX_RETRIES" });

  assert.strictEqual(found.ok, true);
  assert.deepStrictEqual(subjects(found), ["take the constant away", "introduce the constant"]);
});

test("a commit that only moved it is not a commit that changed it", (t) => {
  // The whole difference between this and grepping the log, and the reason it is
  // worth having: "which commits mention this" is a much longer and much worse answer
  const found = loadCommits(makeRepo(t), { text: "MAX_RETRIES" });

  assert.ok(!subjects(found).includes("reorder"));
});

test("a pattern is the other reading of the same question", (t) => {
  const found = loadCommits(makeRepo(t), { text: "MAX_[A-Z]+", regex: true });

  assert.strictEqual(found.ok, true);
  assert.ok(subjects(found).includes("introduce the constant"));
});

test("a path narrows it", (t) => {
  const root = makeRepo(t);
  fs.writeFileSync(path.join(root, "b.js"), "const MAX_RETRIES = 9;\n");
  commit(root, "another file");

  const everywhere = loadCommits(root, { text: "MAX_RETRIES" });
  const narrowed = loadCommits(root, { text: "MAX_RETRIES", path: "b.js" });

  assert.ok(subjects(everywhere).includes("another file"));
  assert.deepStrictEqual(subjects(narrowed), ["another file"]);
});

test("a string nothing ever held is an empty list, not a failure", (t) => {
  const found = loadCommits(makeRepo(t), { text: "nothing_has_this_name" });

  assert.strictEqual(found.ok, true);
  assert.deepStrictEqual(found.commits, []);
});

test("the header says what was looked for", () => {
  assert.strictEqual(historyTitle({ text: "MAX" }, 2), "changed: MAX  (2)");
  assert.strictEqual(historyTitle({ text: "M.X", regex: true }, 1), "changed matching: M.X  (1)");
  assert.strictEqual(
    historyTitle({ text: "MAX", path: "a.js" }, 3),
    "changed: MAX in a.js  (3)"
  );
});

// --- pressing the key -------------------------------------------------------------------

function press(state, keys) {
  return keys.reduce((current, key) => reduce(current, key, VIEWPORT), state);
}

test("# opens a field with the word under the cursor already in it", (t) => {
  // What the reader is looking at is almost always what they want the history of
  const state = createState(makeRepo(t), "review", COLUMNS);
  const onWord = press(state, ["j", "l"]);

  const asking = reduce(onWord, "#", VIEWPORT);

  assert.strictEqual(asking.input.kind, "pickaxe");
  assert.ok(asking.input.text.length > 0, "the field opened empty");
  assert.match(toScreenModel(asking).help, /find in the history/);
});

test("Enter runs it and lists what it found", (t) => {
  const state = createState(makeRepo(t), "review", COLUMNS);
  const asking = reduce(state, "#", VIEWPORT);
  const typed = press({ ...asking, input: { ...asking.input, text: "" } }, "MAX_RETRIES".split(""));

  const found = reduce(typed, "enter", VIEWPORT);

  assert.strictEqual(found.view, "search");
  assert.match(found.listTitle, /changed: MAX_RETRIES/);
  assert.strictEqual(found.hits.length, 2);
});

test("Ctrl+R reads the query as a pattern, and the field says so", (t) => {
  const state = createState(makeRepo(t), "review", COLUMNS);
  const asking = reduce(reduce(state, "#", VIEWPORT), "ctrl-r", VIEWPORT);

  assert.strictEqual(asking.input.regex, true);
  assert.match(toScreenModel(asking).help, /literal\/regex/);
});

test("an empty query closes the field rather than listing the whole history", (t) => {
  const state = createState(makeRepo(t), "review", COLUMNS);
  const asking = { ...reduce(state, "#", VIEWPORT), input: { kind: "pickaxe", text: "  " } };

  const closed = reduce(asking, "enter", VIEWPORT);

  assert.strictEqual(closed.input, null);
  assert.notStrictEqual(closed.view, "search");
});

test("asked while reading a file, it asks about that file", (t) => {
  // A common word's history across the whole repository is a list nobody reads
  const root = makeRepo(t);
  const browsing = createState(root, "files", COLUMNS);
  const reading = press(browsing, ["l"]);
  assert.strictEqual(reading.view, "read");

  const asking = reduce(reading, "#", VIEWPORT);
  const typed = press({ ...asking, input: { ...asking.input, text: "" } }, "MAX_RETRIES".split(""));
  const found = reduce(typed, "enter", VIEWPORT);

  assert.match(found.listTitle, /in a\.js/);
});

test("Esc leaves without asking anything", (t) => {
  const state = createState(makeRepo(t), "review", COLUMNS);
  const away = reduce(reduce(state, "#", VIEWPORT), "escape", VIEWPORT);

  assert.strictEqual(away.input, null);
  assert.strictEqual(away.view, "diff");
});

test("a commit from the list opens its diff, like every other list of commits", (t) => {
  const state = createState(makeRepo(t), "review", COLUMNS);
  const asking = reduce(state, "#", VIEWPORT);
  const typed = press({ ...asking, input: { ...asking.input, text: "" } }, "MAX_RETRIES".split(""));
  const found = reduce(typed, "enter", VIEWPORT);

  const opened = reduce(found, "enter", VIEWPORT);

  assert.strictEqual(opened.mode, "commit");
  assert.match(opened.message, /take the constant away/);
});
