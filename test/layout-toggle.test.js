"use strict";

// Choosing the diff's layout by hand.
//
// A pane still opens in whichever layout the terminal has room for. These are about
// overruling that decision from a key, and about the choice staying made: a
// preference a resize quietly undid would not be one.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const { createState, reduce, toScreenModel, withLayout } = require("../lib/app-state");
const {
  LAYOUT_SPLIT,
  LAYOUT_STACKED,
  SPLIT_MIN_DIFF_WIDTH,
  resolveLayout,
} = require("../lib/layout");
const { anchorFromRow } = require("../lib/comments");
const { MESSAGE_NO_SPLIT_ROOM } = require("../lib/state/messages");

const VIEWPORT = 20;
// The two sides of the decision this key overrules: a width the layout splits on
// its own, and one it would stack on its own.
const SPLIT_COLUMNS = 179;
const STACKED_COLUMNS = 120;

function makeRepo(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "herdr-deep-code-reading-layout-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  execFileSync("git", ["init", "-q"], { cwd: root, stdio: "ignore" });
  const original = [
    "function first(value) {",
    "  return value + 1;",
    "}",
    "",
    "function second(value) {",
    "  return value + 2;",
    "}",
    "",
  ].join("\n");
  fs.writeFileSync(path.join(root, "a.js"), original);
  fs.writeFileSync(path.join(root, "b.js"), original);
  execFileSync("git", ["add", "-A"], { cwd: root, stdio: "ignore" });
  execFileSync(
    "git",
    ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init"],
    { cwd: root, stdio: "ignore" }
  );

  // Several changed lines, so the cursor has somewhere to sit that is not the first
  // row, and both layouts have several rows to build
  const changed = [
    "function first(value) {",
    "  return value + 10;",
    "}",
    "",
    "function second(value) {",
    "  return value + 20;",
    "}",
    "",
  ].join("\n");
  fs.writeFileSync(path.join(root, "a.js"), changed);
  fs.writeFileSync(path.join(root, "b.js"), changed);

  return root;
}

function press(state, keys) {
  return keys.reduce((current, key) => reduce(current, key, VIEWPORT), state);
}

function hasPairs(rows) {
  return rows.some((row) => row.kind === "pair");
}

// --- what the width decides, and what the reader overrules -------------------

test("stacks a diff the width would split, when asked", () => {
  assert.strictEqual(resolveLayout(SPLIT_COLUMNS).sideBySide, true);

  assert.strictEqual(resolveLayout(SPLIT_COLUMNS, LAYOUT_STACKED).sideBySide, false);
});

test("splits a diff the width would stack, when asked", () => {
  assert.strictEqual(resolveLayout(STACKED_COLUMNS).sideBySide, false);

  assert.strictEqual(resolveLayout(STACKED_COLUMNS, LAYOUT_SPLIT).sideBySide, true);
});

test("refuses to split a diff area with no room for two columns", () => {
  // Below the panel's threshold the diff area is the whole terminal, so the column
  // count and the diff width are the same number here
  assert.strictEqual(resolveLayout(SPLIT_MIN_DIFF_WIDTH, LAYOUT_SPLIT).sideBySide, true);
  assert.strictEqual(resolveLayout(SPLIT_MIN_DIFF_WIDTH - 1, LAYOUT_SPLIT).sideBySide, false);
});

// --- the key -----------------------------------------------------------------

test("t stacks the diff a wide pane opened in two columns", (t) => {
  const root = makeRepo(t);
  const state = createState(root, "review", SPLIT_COLUMNS);
  assert.ok(hasPairs(state.rows), "the pane did not open in two columns");

  const stacked = reduce(state, "t", VIEWPORT);

  assert.strictEqual(stacked.sideBySide, false);
  assert.ok(!hasPairs(stacked.rows), "rows are still paired after stacking");
  assert.ok(stacked.rows.some((row) => row.kind === "line"), "no lines to read");
});

test("t splits a diff the width alone would stack", (t) => {
  const root = makeRepo(t);
  const state = createState(root, "review", STACKED_COLUMNS);
  assert.strictEqual(state.sideBySide, false);

  const split = reduce(state, "t", VIEWPORT);

  assert.strictEqual(split.sideBySide, true);
  assert.ok(hasPairs(split.rows), "the diff did not pair its lines");
});

test("t works wherever the reader is in the diff view", (t) => {
  const root = makeRepo(t);
  const state = createState(root, "review", SPLIT_COLUMNS);

  assert.strictEqual(reduce(state, "t", VIEWPORT).sideBySide, false);
  assert.strictEqual(press(state, ["j", "t"]).sideBySide, false);
});

test("t goes back to the layout it started in", (t) => {
  const root = makeRepo(t);
  const state = createState(root, "review", SPLIT_COLUMNS);

  const back = press(state, ["t", "t"]);

  assert.strictEqual(back.sideBySide, true);
  assert.ok(hasPairs(back.rows));
});

test("the choice survives a resize", (t) => {
  const root = makeRepo(t);
  const stacked = reduce(createState(root, "review", SPLIT_COLUMNS), "t", VIEWPORT);

  // Out to a width that stacks on its own, then back to one that would split
  const resized = withLayout(withLayout(stacked, STACKED_COLUMNS), SPLIT_COLUMNS);

  assert.strictEqual(resized.sideBySide, false);
  assert.ok(!hasPairs(resized.rows), "a resize put the diff back into two columns");
});

test("a pinned split comes back when the terminal is wide enough again", (t) => {
  const root = makeRepo(t);
  const split = reduce(createState(root, "review", STACKED_COLUMNS), "t", VIEWPORT);
  assert.strictEqual(split.sideBySide, true);

  // Too narrow for two columns at all, then back
  const narrowed = withLayout(split, SPLIT_MIN_DIFF_WIDTH - 1);
  assert.strictEqual(narrowed.sideBySide, false);

  assert.strictEqual(withLayout(narrowed, STACKED_COLUMNS).sideBySide, true);
});

test("keeps the line under the cursor across the switch", (t) => {
  const root = makeRepo(t);
  const onDiff = press(createState(root, "review", SPLIT_COLUMNS), ["tab", "j", "j"]);
  const before = anchorFromRow(onDiff.rows[onDiff.cursor]);
  assert.ok(before !== null, "the cursor is not on a diff line");

  const stacked = reduce(onDiff, "t", VIEWPORT);
  const after = anchorFromRow(stacked.rows[stacked.cursor]);

  assert.strictEqual(after.side, before.side);
  assert.strictEqual(after.start, before.start);
});

test("says so when the pane is too narrow to split, and changes nothing", (t) => {
  const root = makeRepo(t);
  const state = createState(root, "review", SPLIT_MIN_DIFF_WIDTH - 1);
  assert.strictEqual(state.sideBySide, false);

  const refused = reduce(state, "t", VIEWPORT);

  assert.strictEqual(refused.message, MESSAGE_NO_SPLIT_ROOM);
  assert.strictEqual(refused.sideBySide, false);
  assert.strictEqual(refused.rows, state.rows);
});

// --- what the rest of the pane is told ---------------------------------------

test("the renderer is told which layout the rows were built for", (t) => {
  const root = makeRepo(t);
  const state = createState(root, "review", SPLIT_COLUMNS);

  assert.strictEqual(toScreenModel(state).sideBySide, true);
  assert.strictEqual(toScreenModel(reduce(state, "t", VIEWPORT)).sideBySide, false);
});

test("both of the diff's footers name the key", (t) => {
  const root = makeRepo(t);
  const panel = createState(root, "review", SPLIT_COLUMNS);

  assert.match(toScreenModel(panel).help, /(^|\s)t\s/);
  assert.match(toScreenModel(reduce(panel, "tab", VIEWPORT)).help, /(^|\s)t\s/);
});

test("the read-only modes offer the key too", (t) => {
  const root = makeRepo(t);

  for (const mode of ["staged", "branch"]) {
    const state = createState(root, mode, SPLIT_COLUMNS);
    assert.match(toScreenModel(state).help, /(^|\s)t\s/, `${mode}: footer omits the layout key`);
  }
});

// --- coming back to rows built for the other layout ---------------------------

test("coming back to a file's diff rebuilds it in the chosen layout", (t) => {
  // Regression: rows remembered by the jump history were built for the layout that
  // was showing when they were recorded. Restoring them under a layout the reader
  // has since changed put paired rows back on screen in a stacked diff.
  const root = makeRepo(t);
  const reading = press(createState(root, "files", SPLIT_COLUMNS), ["l", "tab"]);
  assert.strictEqual(reading.view, "read");
  assert.ok(hasPairs(reading.rows), "the file's own diff did not open in two columns");

  const listed = reduce(reading, "o", VIEWPORT);
  assert.strictEqual(listed.view, "search", "the outline did not open");

  const stacked = press(listed, ["e", "t"]);
  assert.strictEqual(stacked.sideBySide, false);

  const back = reduce(stacked, "ctrl-o", VIEWPORT);

  assert.strictEqual(back.view, "read");
  assert.ok(!hasPairs(back.rows), "the restored rows are still paired");
});
