"use strict";

// A view must keep showing what its header says it is showing, and every row it
// can produce must be renderable in the column it lands in.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const { createState, reduce, toScreenModel, withLayout } = require("../lib/app-state");
const { renderScreen } = require("../lib/render");

const VIEWPORT = 20;
const WIDE = 179;
const NARROW = 100;

function makeRepo(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "herdr-deep-code-reading-integrity-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  execFileSync("git", ["init", "-q"], { cwd: root, stdio: "ignore" });
  fs.writeFileSync(path.join(root, "a.txt"), "one\ntwo\nthree\n");
  fs.writeFileSync(path.join(root, "b.txt"), "alpha\nbeta\n");
  execFileSync("git", ["add", "-A"], { cwd: root, stdio: "ignore" });
  execFileSync(
    "git",
    ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init"],
    { cwd: root, stdio: "ignore" }
  );

  // Both files differ from HEAD, so both have a diff to confuse things with
  fs.writeFileSync(path.join(root, "a.txt"), "one\nTWO\nthree\n");
  fs.writeFileSync(path.join(root, "b.txt"), "ALPHA\nbeta\n");

  return root;
}

function press(state, keys) {
  return keys.reduce((current, key) => reduce(current, key, VIEWPORT), state);
}

// --- the open file survives a resize --------------------------------------

test("a resize keeps the open file's own lines on screen", (t) => {
  // Regression: withLayout rebuilt rows from the diff panel's selection without
  // checking the view, so crossing the side-by-side threshold while reading swapped
  // in another file's diff under the original file's name
  const root = makeRepo(t);
  const opened = press(createState(root, "files", WIDE), ["l"]);

  const resized = withLayout(opened, NARROW);

  assert.strictEqual(resized.openPath, opened.openPath);
  assert.deepStrictEqual(
    resized.rows.map((row) => row.cell.text),
    ["one", "TWO", "three"]
  );
});

test("a resize leaves the reading view in the reading view", (t) => {
  const root = makeRepo(t);
  const opened = press(createState(root, "files", WIDE), ["l"]);

  assert.strictEqual(withLayout(opened, NARROW).view, "read");
});

test("a resize keeps a comment anchored to the file it was written on", (t) => {
  const root = makeRepo(t);
  const opened = press(createState(root, "files", WIDE), ["l"]);

  const commented = press(withLayout(opened, NARROW), ["c", "o", "k", "enter"]);

  assert.strictEqual(commented.comments[0].file, opened.openPath);
  assert.deepStrictEqual(commented.comments[0].lines, [" one"]);
});

test("a resize keeps the search results on screen", (t) => {
  const root = makeRepo(t);
  const searched = press(createState(root, "files", WIDE), ["/", "T", "W", "O", "enter"]);
  assert.strictEqual(searched.view, "search");

  const resized = withLayout(searched, NARROW);

  assert.strictEqual(resized.view, "search");
  assert.deepStrictEqual(
    resized.rows.map((row) => row.kind),
    searched.rows.map((row) => row.kind)
  );
});

test("a resize still relays out the diff view", (t) => {
  const root = makeRepo(t);
  const state = createState(root, "review", WIDE);
  assert.strictEqual(state.sideBySide, true);

  const resized = withLayout(state, NARROW);

  assert.strictEqual(resized.sideBySide, false);
  assert.ok(resized.rows.some((row) => row.kind === "line"));
});

// --- every previewable row is renderable -----------------------------------

test("the browser renders a diff preview without throwing", (t) => {
  // Regression: the preview column only knew note/entry/line rows, but the diff
  // reading mode feeds it hunk and pair rows
  const root = makeRepo(t);
  const browsing = reduce(createState(root, "files", WIDE), "tab", VIEWPORT);

  const model = toScreenModel(browsing);
  assert.ok(model.preview.some((row) => row.kind === "hunk"), "expected a diff preview");

  assert.doesNotThrow(() => renderScreen(model, { columns: WIDE, rows: 20 }));
});

test("the browser renders a diff preview at a narrow width too", (t) => {
  const root = makeRepo(t);
  const browsing = reduce(createState(root, "files", NARROW), "tab", VIEWPORT);

  assert.doesNotThrow(() =>
    renderScreen(toScreenModel(browsing), { columns: NARROW, rows: 20 })
  );
});

test("the browser renders a content preview without throwing", (t) => {
  const root = makeRepo(t);
  const browsing = createState(root, "files", WIDE);

  assert.doesNotThrow(() =>
    renderScreen(toScreenModel(browsing), { columns: WIDE, rows: 20 })
  );
});

// --- movement is the same in every list-shaped view -------------------------

test("the search results honour the paging keys", (t) => {
  // Regression: the movement block was copied per view and the search copy was
  // missing d/u/g/G, so a long result list moved one line at a time
  const root = makeRepo(t);
  const searched = press(createState(root, "files", WIDE), ["/", "e", "enter"]);
  assert.strictEqual(searched.view, "search");
  assert.ok(searched.rows.length > 1, "expected more than one hit");

  assert.strictEqual(reduce(searched, "G", VIEWPORT).cursor, searched.rows.length - 1);
});

test("the reading view honours the paging keys", (t) => {
  const root = makeRepo(t);
  const opened = press(createState(root, "files", WIDE), ["l"]);

  assert.strictEqual(reduce(opened, "G", VIEWPORT).cursor, opened.rows.length - 1);
});
