"use strict";

// Commenting on a run of lines, and writing more than one line about it.

const test = require("node:test");
const assert = require("node:assert");

const { parseUnifiedDiff } = require("../lib/diff-parser");
const { anchorFromRows, formatBatch } = require("../lib/comments");
const {
  firstDiffRow,
  reduce,
  rowsForSelection,
  toScreenModel,
  withLayout,
} = require("../lib/app-state");

const VIEWPORT = 10;

// Unified rows for src/a.js, by index:
//   0 hunk header      3 del  old two (old 3)   6 context tail (new 4)
//   1 context keep     4 add  new one (new 2)
//   2 del  old one     5 add  new two (new 3)
const DIFF = [
  "diff --git a/src/a.js b/src/a.js",
  "--- a/src/a.js",
  "+++ b/src/a.js",
  "@@ -1,5 +1,5 @@",
  " keep",
  "-old one",
  "-old two",
  "+new one",
  "+new two",
  " tail",
  "diff --git a/src/b.js b/src/b.js",
  "--- a/src/b.js",
  "+++ b/src/b.js",
  "@@ -1,2 +1,2 @@",
  " other",
  "+added",
].join("\n");

// The first row of the run of added and context lines, which share the new side
const FIRST_ADDED_ROW = 4;

/** A state on the diff body, with the cursor on the first diff line. */
function makeState(overrides) {
  const files = parseUnifiedDiff(DIFF).map((file) => ({ ...file, gitStatus: " M" }));
  const rows = rowsForSelection(files, 0, false);

  return {
    repoDir: "/repo",
    mode: "review",
    title: "t",
    branch: "main",
    files,
    sideBySide: false,
    selectedIndex: 0,
    rows,
    scroll: 0,
    cursor: firstDiffRow(rows),
    selectionAnchor: null,
    focus: "diff",
    view: "diff",
    comments: [],
    input: null,
    picker: null,
    history: [],
    message: null,
    effect: null,
    pendingQuit: false,
    quit: false,
    ...overrides,
  };
}

function press(state, keys) {
  return keys.reduce((current, key) => reduce(current, key, VIEWPORT), state);
}

// --- the anchor over a run --------------------------------------------------

test("spans the line numbers of the rows it covers", () => {
  const rows = [
    { kind: "line", cell: { num: 4, text: "a", type: "context" } },
    { kind: "line", cell: { num: 5, text: "b", type: "context" } },
    { kind: "line", cell: { num: 6, text: "c", type: "context" } },
  ];

  assert.deepStrictEqual(anchorFromRows(rows), {
    side: "new",
    start: 4,
    end: 6,
    lines: [" a", " b", " c"],
  });
});

test("reads a run of removed lines on the old side", () => {
  const rows = [
    { kind: "line", cell: { num: 7, text: "gone", type: "del" } },
    { kind: "line", cell: { num: 8, text: "also gone", type: "del" } },
  ];

  const anchor = anchorFromRows(rows);

  assert.strictEqual(anchor.side, "old");
  assert.strictEqual(anchor.start, 7);
  assert.strictEqual(anchor.end, 8);
});

test("numbers a mixed run on the new side, keeping every line", () => {
  // A removed line caught inside a new-side span must not drag the range onto the
  // other file's numbering, but its text still belongs in the quote
  const rows = [
    { kind: "line", cell: { num: 3, text: "gone", type: "del" } },
    { kind: "line", cell: { num: 3, text: "added", type: "add" } },
    { kind: "line", cell: { num: 4, text: "kept", type: "context" } },
  ];

  const anchor = anchorFromRows(rows);

  assert.strictEqual(anchor.side, "new");
  assert.strictEqual(anchor.start, 3);
  assert.strictEqual(anchor.end, 4);
  assert.deepStrictEqual(anchor.lines, ["-gone", "+added", " kept"]);
});

test("steps over a row that carries no diff line", () => {
  const rows = [
    { kind: "line", cell: { num: 1, text: "a", type: "context" } },
    { kind: "hunk", text: "@@ -9,2 +9,2 @@" },
    { kind: "line", cell: { num: 2, text: "b", type: "context" } },
  ];

  assert.deepStrictEqual(anchorFromRows(rows).lines, [" a", " b"]);
});

test("reports nothing for a run with no diff lines at all", () => {
  assert.strictEqual(anchorFromRows([{ kind: "note", text: "No changes" }]), null);
});

// --- marking a run ----------------------------------------------------------

test("v marks the row under the cursor", () => {
  const state = reduce(makeState(), "v", VIEWPORT);

  assert.strictEqual(state.selectionAnchor, state.cursor);
  assert.deepStrictEqual(toScreenModel(state).selection, {
    from: state.cursor,
    to: state.cursor,
  });
});

test("moving extends the run from where it was anchored", () => {
  const state = press(makeState(), ["v", "j", "j"]);
  const model = toScreenModel(state);

  assert.strictEqual(model.selection.from, state.selectionAnchor);
  assert.strictEqual(model.selection.to, state.cursor);
  assert.strictEqual(model.selection.to - model.selection.from, 2);
});

test("the run reads the same when it is marked upwards", () => {
  const downwards = press(makeState(), ["v", "j"]);
  const upwards = press(makeState(), ["j", "v", "k"]);

  assert.deepStrictEqual(toScreenModel(upwards).selection, toScreenModel(downwards).selection);
});

test("v again drops the run", () => {
  const state = press(makeState(), ["v", "j", "v"]);

  assert.strictEqual(state.selectionAnchor, null);
  assert.strictEqual(toScreenModel(state).selection, null);
});

test("a run cannot start on a row with no diff line", () => {
  const state = reduce(makeState({ cursor: 0 }), "v", VIEWPORT);

  assert.strictEqual(state.selectionAnchor, null);
  assert.match(state.message, /cursor/);
});

test("resizing the terminal forgets the run", () => {
  // Regression: a resize arrives from the terminal rather than from a key, so it
  // never passes the reducer that drops a stale run — and the run's indexes point
  // into the rows the old layout built, not the ones now on screen.
  const wide = makeState({ sideBySide: true, rows: rowsForSelection(parseUnifiedDiff(DIFF), 0, true) });
  const marked = press(wide, ["v", "j", "j"]);
  assert.notStrictEqual(marked.selectionAnchor, null);

  const narrowed = withLayout(marked, 80);

  assert.notStrictEqual(narrowed.rows, marked.rows, "the layout did not flip");
  assert.strictEqual(narrowed.selectionAnchor, null);
  assert.strictEqual(toScreenModel(narrowed).selection, null);
});

test("rebuilding the rows forgets the run", () => {
  // The run is a pair of indexes into the row list; a new list invalidates it
  const marked = press(makeState(), ["v", "j"]);
  assert.notStrictEqual(marked.selectionAnchor, null);

  const otherFile = reduce(marked, "n", VIEWPORT);

  assert.notStrictEqual(otherFile.rows, marked.rows, "the rows did not change");
  assert.strictEqual(otherFile.selectionAnchor, null);
});

// --- commenting on a run ----------------------------------------------------

/** A state with the cursor on the first row of the new-side run. */
function onAddedLines(overrides) {
  return makeState({ cursor: FIRST_ADDED_ROW, ...overrides });
}

test("c anchors the comment to the whole run", () => {
  const state = press(onAddedLines(), ["v", "j", "j", "c"]);

  assert.strictEqual(state.input.side, "new");
  assert.strictEqual(state.input.start, 2);
  assert.strictEqual(state.input.end, 4);
  assert.deepStrictEqual(state.input.lines, ["+new one", "+new two", " tail"]);
});

test("a run that is only removed lines stays on the old side", () => {
  // Rows 2 and 3 are the two deletions
  const state = press(makeState({ cursor: 2 }), ["v", "j", "c"]);

  assert.strictEqual(state.input.side, "old");
  assert.strictEqual(state.input.start, 2);
  assert.strictEqual(state.input.end, 3);
});

test("saving a run comment reports how far it reaches", () => {
  const state = press(onAddedLines(), ["v", "j", "c", "w", "h", "y", "enter"]);

  assert.strictEqual(state.comments.length, 1);
  assert.strictEqual(state.comments[0].end - state.comments[0].start, 1);
  assert.match(state.message, /2 lines/);
});

test("the run is dropped once the comment is saved", () => {
  const state = press(onAddedLines(), ["v", "j", "c", "x", "enter"]);

  assert.strictEqual(state.selectionAnchor, null);
});

test("Escape drops both the comment and the run", () => {
  const state = press(onAddedLines(), ["v", "j", "c", "x", "escape"]);

  assert.strictEqual(state.input, null);
  assert.strictEqual(state.selectionAnchor, null);
  assert.strictEqual(state.comments.length, 0);
});

test("the gutter marks every line a run comment covers", () => {
  const state = press(onAddedLines(), ["v", "j", "j", "c", "n", "o", "enter"]);

  const keys = toScreenModel(state).commentKeys;

  assert.deepStrictEqual([...keys].sort(), ["new:2", "new:3", "new:4"]);
});

test("x deletes a run comment from any line of it", () => {
  const written = press(onAddedLines(), ["v", "j", "j", "c", "n", "o", "enter"]);
  assert.strictEqual(written.comments.length, 1);

  // Back to the middle of the run, not its first line
  const deleted = press(written, ["k", "x"]);

  assert.strictEqual(deleted.comments.length, 0);
});

test("the range reaches the agent in the heading", () => {
  const state = press(onAddedLines(), ["v", "j", "c", "w", "h", "y", "enter"]);

  assert.match(formatBatch(state.comments), /### src\/a\.js:2-3 \(new side\)/);
});

test("a single line still reads as one number", () => {
  const state = press(onAddedLines(), ["c", "w", "h", "y", "enter"]);

  assert.match(formatBatch(state.comments), /### src\/a\.js:2 \(new side\)/);
});

// --- writing more than one line ---------------------------------------------

test("Ctrl+D adds a line break to a comment", () => {
  const state = press(makeState(), ["c", "a", "ctrl-d", "b"]);

  assert.strictEqual(state.input.text, "a\nb");
});

test("Enter still saves rather than adding a line", () => {
  const state = press(makeState(), ["c", "a", "ctrl-d", "b", "enter"]);

  assert.strictEqual(state.input, null);
  assert.strictEqual(state.comments[0].text, "a\nb");
});

test("carries a multi-line note into the batch verbatim", () => {
  const state = press(makeState(), ["c", "a", "ctrl-d", "b", "enter"]);

  assert.match(formatBatch(state.comments), /\na\nb\n/);
});

test("breaks a commit message the same way", () => {
  // A subject is one line by convention, but the paragraph explaining it is not, and
  // git records everything past the first blank line as the body
  const state = press(makeState(), ["C", "a", "ctrl-d", "b"]);

  assert.strictEqual(state.input.text, "a\nb");
});

test("trims a comment that is only line breaks", () => {
  const state = press(makeState(), ["c", "ctrl-d", "ctrl-d", "enter"]);

  assert.strictEqual(state.comments.length, 0);
  assert.match(state.message, /discarded/);
});
