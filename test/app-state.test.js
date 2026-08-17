"use strict";

const test = require("node:test");
const assert = require("node:assert");

const { parseUnifiedDiff } = require("../lib/diff-parser");
const {
  firstDiffRow,
  reduce,
  rowsForSelection,
  toScreenModel,
} = require("../lib/app-state");

const VIEWPORT = 10;

const DIFF = [
  "diff --git a/src/a.js b/src/a.js",
  "--- a/src/a.js",
  "+++ b/src/a.js",
  "@@ -1,3 +1,3 @@",
  " keep",
  "-old line",
  "+new line",
  " tail",
].join("\n");

/** Build a state directly, without touching git. */
function makeState(overrides) {
  const files = parseUnifiedDiff(DIFF).map((file) => ({ ...file, gitStatus: " M" }));
  const rows = rowsForSelection(files, 0, true);

  return Object.assign(
    {
      repoDir: "/repo",
      mode: "review",
      title: "Working tree vs HEAD",
      branch: "main",
      files,
      sideBySide: true,
      selectedIndex: 0,
      rows,
      scroll: 0,
      cursor: firstDiffRow(rows),
      focus: "diff",
      comments: [],
      history: [],
      input: null,
      picker: null,
      message: null,
      effect: null,
      quit: false,
    },
    overrides
  );
}

/** Apply a sequence of keys. */
function press(state, keys) {
  return keys.reduce((current, key) => reduce(current, key, VIEWPORT), state);
}

// --- cursor --------------------------------------------------------------

test("starts the cursor on the first diff line, not the hunk header", () => {
  const state = makeState();

  assert.strictEqual(state.rows[state.cursor].kind, "pair");
});

test("moves the cursor down with j when the diff has focus", () => {
  const state = makeState();

  const next = reduce(state, "j", VIEWPORT);

  assert.strictEqual(next.cursor, state.cursor + 1);
});

test("j moves the cursor down the lines, never the file list", () => {
  // The two used to share j/k, with Tab deciding which. Nothing in the pane said
  // which it was on, and it was the one thing about this screen nobody could work out
  // by looking at it.
  const state = makeState();

  const next = reduce(state, "j", VIEWPORT);

  assert.notStrictEqual(next.cursor, state.cursor);
  assert.strictEqual(next.selectedIndex, state.selectedIndex);
});

test("n and p move the file list, never the cursor", () => {
  const files = [
    ...makeState().files,
    { ...makeState().files[0], newPath: "src/b.js", oldPath: "src/b.js" },
  ];
  const state = makeState({ files });

  assert.strictEqual(reduce(state, "n", VIEWPORT).selectedIndex, 1);
  assert.strictEqual(reduce(reduce(state, "n", VIEWPORT), "p", VIEWPORT).selectedIndex, 0);
});

test("does not move the cursor past the last row", () => {
  const state = makeState();

  const next = press(state, ["G", "j", "j"]);

  assert.strictEqual(next.cursor, state.rows.length - 1);
});

test("does not move the cursor above the first row", () => {
  const state = makeState();

  const next = press(state, ["k", "k", "k", "k"]);

  assert.strictEqual(next.cursor, 0);
});

test("scrolls to keep the cursor visible", () => {
  const state = makeState({ rows: rowsForSelection(parseUnifiedDiff(DIFF), 0, true) });

  const next = press(state, ["G"]);

  assert.ok(next.cursor >= next.scroll);
  assert.ok(next.cursor < next.scroll + VIEWPORT || next.scroll === 0);
});

// --- writing a comment ---------------------------------------------------

test("opens the comment input on the line under the cursor", () => {
  const state = makeState();

  const next = reduce(state, "c", VIEWPORT);

  assert.notStrictEqual(next.input, null);
  assert.strictEqual(next.input.file, "src/a.js");
  assert.strictEqual(next.input.text, "");
});

test("anchors the comment input to the diff lines under the cursor", () => {
  // The cursor starts on the first line of the hunk, so step onto the change
  const state = press(makeState(), ["j", "c"]);

  assert.deepStrictEqual(state.input.lines, ["-old line", "+new line"]);
});

test("anchors a comment on a context line to that line alone", () => {
  const state = reduce(makeState(), "c", VIEWPORT);

  assert.deepStrictEqual(state.input.lines, [" keep"]);
});

test("refuses to comment on a hunk header", () => {
  const state = makeState({ cursor: 0 });

  const next = reduce(state, "c", VIEWPORT);

  assert.strictEqual(next.input, null);
  assert.match(next.message, /cursor/);
});

test("types characters into the comment being written", () => {
  const state = press(makeState(), ["c", "h", "i"]);

  assert.strictEqual(state.input.text, "hi");
});

test("deletes the last character with backspace", () => {
  const state = press(makeState(), ["c", "a", "b", "backspace"]);

  assert.strictEqual(state.input.text, "a");
});

test("saves the comment on Enter", () => {
  const state = press(makeState(), ["c", "w", "h", "y", "enter"]);

  assert.strictEqual(state.input, null);
  assert.strictEqual(state.comments.length, 1);
  assert.strictEqual(state.comments[0].text, "why");
});

test("discards the comment on Escape", () => {
  const state = press(makeState(), ["c", "x", "escape"]);

  assert.strictEqual(state.input, null);
  assert.strictEqual(state.comments.length, 0);
});

test("discards a comment with no text", () => {
  const state = press(makeState(), ["c", "enter"]);

  assert.strictEqual(state.comments.length, 0);
  assert.match(state.message, /discarded/);
});

test("routes navigation keys into the text while writing", () => {
  // "j" must type a j, not move the cursor
  const state = press(makeState(), ["c", "j"]);

  assert.strictEqual(state.input.text, "j");
});

test("accepts multi-byte characters in a comment", () => {
  const state = press(makeState(), ["c", "日", "本", "enter"]);

  assert.strictEqual(state.comments[0].text, "日本");
});

// --- deleting a comment --------------------------------------------------

test("deletes the comment under the cursor with x", () => {
  const withComment = press(makeState(), ["c", "a", "enter"]);

  const next = reduce(withComment, "x", VIEWPORT);

  assert.strictEqual(next.comments.length, 0);
});

test("reports when there is no comment to delete", () => {
  const next = reduce(makeState(), "x", VIEWPORT);

  assert.match(next.message, /No comment/);
});

// --- sending -------------------------------------------------------------

test("S opens the batch for reading rather than sending it outright", () => {
  // What is about to be pasted into somebody else's editor is worth a look first,
  // and there was no way to leave one comment out — see lib/state/views/sheet.js
  const withComment = press(makeState(), ["c", "a", "enter"]);

  const opened = reduce(withComment, "S", VIEWPORT);

  assert.strictEqual(opened.view, "comments");
  assert.strictEqual(opened.effect, null);
  assert.deepStrictEqual(opened.sheet, { sending: true, excluded: [] });

  // And Enter there is the send
  assert.strictEqual(reduce(opened, "enter", VIEWPORT).effect.type, "send");
});

test("refuses to send with no comments", () => {
  const next = reduce(makeState(), "S", VIEWPORT);

  assert.strictEqual(next.effect, null);
  assert.match(next.message, /No comments/);
});

test("chooses an agent by number in the picker", () => {
  const agent = { pane_id: "w1:p3", agent: "codex", label: "codex" };
  const batch = { text: "### a.js:1\n\nwhy?\n", said: "Pasted 1 comment" };
  const state = makeState({ picker: { count: 1, agents: [agent], batch } });

  const next = reduce(state, "1", VIEWPORT);

  assert.strictEqual(next.picker, null);
  assert.deepStrictEqual(next.effect, { type: "send-to", agent, batch });
});

test("ignores an out-of-range choice in the picker", () => {
  const state = makeState({ picker: { count: 1, agents: [{ pane_id: "w1:p3" }] } });

  const next = reduce(state, "5", VIEWPORT);

  assert.notStrictEqual(next.picker, null);
  assert.strictEqual(next.effect, null);
});

test("cancels the picker with Escape", () => {
  const state = makeState({ picker: { count: 1, agents: [{ pane_id: "w1:p3" }] } });

  const next = reduce(state, "escape", VIEWPORT);

  assert.strictEqual(next.picker, null);
  assert.strictEqual(next.effect, null);
});

// --- screen model --------------------------------------------------------

test("reports the comment count per file in the screen model", () => {
  const withComment = press(makeState(), ["c", "a", "enter"]);

  const model = toScreenModel(withComment);

  assert.strictEqual(model.files[0].comments, 1);
});

test("marks the commented line for the renderer", () => {
  const withComment = press(makeState(), ["c", "a", "enter"]);

  const model = toScreenModel(withComment);

  assert.strictEqual(model.commentKeys.size, 1);
});

test("shows the total comment count in the subtitle", () => {
  const withComment = press(makeState(), ["c", "a", "enter"]);

  assert.match(toScreenModel(withComment).subtitle, /1 comment\b/);
});

test("uses the plural form for several comments", () => {
  const withComments = press(makeState(), ["c", "a", "enter", "j", "c", "b", "enter"]);

  assert.match(toScreenModel(withComments).subtitle, /2 comments/);
});

test("omits the comment count when there are none", () => {
  assert.doesNotMatch(toScreenModel(makeState()).subtitle, /comments/);
});

test("names the repository in the subtitle", () => {
  // Several review panes are told apart by this name
  const model = toScreenModel(makeState({ repoDir: "/work/my-project" }));

  assert.match(model.subtitle, /my-project/);
});

test("keeps the repository name once comments exist", () => {
  const withComment = press(makeState({ repoDir: "/work/my-project" }), ["c", "a", "enter"]);

  assert.match(toScreenModel(withComment).subtitle, /my-project/);
});

test("names the current branch in the title", () => {
  assert.match(toScreenModel(makeState({ branch: "feature/x" })).title, /feature\/x/);
});

test("names the whole path of the file being read, unabbreviated", () => {
  // The panel has 34 columns and drops directories to fit, so the header is the
  // one place the path is said in full
  const model = toScreenModel(makeState());

  assert.match(model.title, /src\/a\.js/);
});

test("keeps naming which diff it is, beside which file of it", () => {
  const model = toScreenModel(makeState({ title: "Staged changes" }));

  assert.match(model.title, /Staged changes/);
  assert.match(model.title, /src\/a\.js/);
});

test("follows the panel to the next file", () => {
  const files = [
    ...makeState().files,
    { ...makeState().files[0], newPath: "src/b.js", oldPath: "src/b.js" },
  ];
  const state = makeState({ files });

  assert.match(toScreenModel(state).title, /src\/a\.js/);
  assert.match(toScreenModel(reduce(state, "n", VIEWPORT)).title, /src\/b\.js/);
});

test("says only which diff it is when there is no file to name", () => {
  const empty = makeState({ files: [], title: "Working tree vs HEAD" });

  assert.strictEqual(toScreenModel(empty).title.endsWith("Working tree vs HEAD"), true);
});

test("reads the panel rows from the cached summaries", () => {
  // Recomputing per frame would walk every hunk of every file on each keystroke
  const state = makeState({
    fileSummaries: [
      { path: "src/a.js", label: "cached", status: "XY", added: 99, deleted: 98 },
    ],
  });

  const model = toScreenModel(state);

  assert.strictEqual(model.files[0].label, "cached");
  assert.strictEqual(model.files[0].added, 99);
});

test("still builds the summaries when none are cached", () => {
  const state = makeState();
  delete state.fileSummaries;

  assert.strictEqual(toScreenModel(state).files[0].label, "src/a.js");
});

test("shows the two-letter git status in the panel", () => {
  const model = toScreenModel(makeState());

  assert.strictEqual(model.files[0].status, " M");
});

test("falls back to the diff-derived letter when git status is missing", () => {
  const files = makeState().files.map((file) => ({ ...file, gitStatus: null }));

  assert.strictEqual(toScreenModel(makeState({ files })).files[0].status, "M");
});

// --- staging -------------------------------------------------------------

test("asks to stage the selected file from the panel", () => {
  const state = makeState({ focus: "panel" });

  const next = reduce(state, " ", VIEWPORT);

  assert.deepStrictEqual(next.effect, {
    type: "stage",
    paths: ["src/a.js"],
    label: "src/a.js",
    gitStatus: " M",
  });
});

test("stages both paths of a rename together", () => {
  // Staging only the new path would leave the old path's deletion unstaged
  const renamed = {
    ...parseUnifiedDiff(DIFF)[0],
    isRenamed: true,
    oldPath: "src/old.js",
    newPath: "src/new.js",
    gitStatus: "R ",
  };
  const state = makeState({ focus: "panel", files: [renamed] });

  const next = reduce(state, " ", VIEWPORT);

  assert.deepStrictEqual(next.effect.paths, ["src/new.js", "src/old.js"]);
  assert.strictEqual(next.effect.label, "src/new.js");
});

test("stages the file the panel points at, from anywhere in the diff", () => {
  // The panel always points at a file and n/p always move it, so there is no longer
  // a side of the screen this is the wrong key on
  const next = reduce(makeState(), " ", VIEWPORT);

  assert.strictEqual(next.effect.type, "stage");
});

test("asks to stage everything with A", () => {
  const next = reduce(makeState(), "A", VIEWPORT);

  assert.deepStrictEqual(next.effect, { type: "stage-all" });
});

// --- committing ----------------------------------------------------------

test("opens the commit message field with C", () => {
  const next = reduce(makeState(), "C", VIEWPORT);

  assert.strictEqual(next.input.kind, "commit");
  assert.strictEqual(next.input.text, "");
});

test("asks to commit the typed message on Enter", () => {
  const state = press(makeState(), ["C", "f", "i", "x", "enter"]);

  assert.deepStrictEqual(state.effect, { type: "commit", message: "fix" });
  assert.strictEqual(state.input, null);
});

test("cancels a commit with no message", () => {
  const state = press(makeState(), ["C", "enter"]);

  assert.strictEqual(state.effect, null);
  assert.match(state.message, /no message/);
});

test("cancels the commit message with Escape", () => {
  const state = press(makeState(), ["C", "a", "escape"]);

  assert.strictEqual(state.input, null);
  assert.strictEqual(state.effect, null);
});

test("does not treat the commit field as a comment", () => {
  const state = press(makeState(), ["C", "m", "s", "g", "enter"]);

  assert.strictEqual(state.comments.length, 0);
});

// --- contextual help -----------------------------------------------------

test("offers staging keys while the panel has focus", () => {
  const help = toScreenModel(makeState({ focus: "panel" })).help;

  assert.match(help, /stage/);
});

test("does not offer staging keys outside the review mode", () => {
  // Staging follows `git status`, which only matches the review mode's file list
  const help = toScreenModel(makeState({ focus: "panel", mode: "branch" })).help;

  assert.doesNotMatch(help, /stage/);
});

test("offers comment keys while the diff has focus", () => {
  const help = toScreenModel(makeState({ focus: "diff" })).help;

  assert.match(help, /comment/);
});

test("explains the commit field while it is open", () => {
  const state = reduce(makeState(), "C", VIEWPORT);

  assert.match(toScreenModel(state).help, /commit/);
});
