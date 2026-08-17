"use strict";

// The reading view must never borrow the diff view's movement keys.

const test = require("node:test");
const assert = require("node:assert");

const { parseUnifiedDiff } = require("../lib/diff-parser");
const { reduce, toScreenModel } = require("../lib/app-state");

const VIEWPORT = 10;

const DIFF = [
  "diff --git a/first.js b/first.js",
  "--- a/first.js",
  "+++ b/first.js",
  "@@ -1,2 +1,2 @@",
  "-one",
  "+ONE",
  "diff --git a/second.js b/second.js",
  "--- a/second.js",
  "+++ b/second.js",
  "@@ -1,2 +1,2 @@",
  "-two",
  "+TWO",
].join("\n");

/** A state already open on a file, with the diff view sitting behind it. */
function makeReadingState(overrides) {
  const files = parseUnifiedDiff(DIFF).map((file) => ({ ...file, gitStatus: " M" }));
  const contentRows = ["alpha", "bravo", "charlie", "delta", "echo"].map((text, index) => ({
    kind: "line",
    cell: { num: index + 1, text, type: "context", tokens: null },
  }));

  return Object.assign(
    {
      repoDir: "/repo",
      mode: "review",
      title: "Working tree vs HEAD",
      branch: "main",
      files,
      sideBySide: true,
      selectedIndex: 0,
      rows: contentRows,
      scroll: 0,
      cursor: 0,
      // The diff view leaves focus on the panel; the reader must not honour it
      focus: "panel",
      view: "read",
      openPath: "docs/notes.md",
      repoPaths: ["docs/notes.md", "first.js", "second.js"],
      browse: null,
      preview: null,
      comments: [],
      input: null,
      picker: null,
      message: null,
      effect: null,
      quit: false,
    },
    overrides
  );
}

function press(state, keys) {
  return keys.reduce((current, key) => reduce(current, key, VIEWPORT), state);
}

test("moves the cursor with j even though focus is on the panel", () => {
  const state = makeReadingState();

  const moved = reduce(state, "j", VIEWPORT);

  assert.strictEqual(moved.cursor, 1);
  assert.strictEqual(moved.selectedIndex, 0);
});

test("does not swap in another file's diff while reading", () => {
  // Regression: j used to select the next file and rebuild rows from its diff,
  // leaving one file's lines on screen under another file's name
  const state = makeReadingState();

  const moved = press(state, ["j", "j"]);

  assert.deepStrictEqual(
    moved.rows.map((row) => row.cell.text),
    ["alpha", "bravo", "charlie", "delta", "echo"]
  );
});

test("anchors a comment to the line actually under the cursor", () => {
  const state = press(makeReadingState(), ["j", "j", "c"]);

  assert.strictEqual(state.input.file, "docs/notes.md");
  assert.strictEqual(state.input.start, 3);
  assert.deepStrictEqual(state.input.lines, [" charlie"]);
});

test("ignores the file-switching keys while reading", () => {
  const state = makeReadingState();

  assert.strictEqual(reduce(state, "n", VIEWPORT).selectedIndex, 0);
  assert.strictEqual(reduce(state, "p", VIEWPORT).selectedIndex, 0);
});

test("ignores the focus toggle while reading", () => {
  assert.strictEqual(reduce(makeReadingState(), "tab", VIEWPORT).focus, "panel");
});

test("jumps to the last line with G", () => {
  const state = reduce(makeReadingState(), "G", VIEWPORT);

  assert.strictEqual(state.cursor, 4);
});

test("leaves the reader for the diff with e", () => {
  const state = reduce(makeReadingState(), "e", VIEWPORT);

  assert.strictEqual(state.view, "diff");
  assert.strictEqual(state.openPath, null);
});

test("names the open file in the header", () => {
  assert.match(toScreenModel(makeReadingState()).title, /docs\/notes\.md/);
});

test("still saves a comment from the reading view", () => {
  const state = press(makeReadingState(), ["c", "o", "k", "enter"]);

  assert.strictEqual(state.comments.length, 1);
  assert.strictEqual(state.comments[0].file, "docs/notes.md");
});
