"use strict";

// A long line in the diff is wrapped, in both layouts.
//
// Regression: only the reading view wrapped. A two-column diff gives each side about
// half the terminal, which is some thirty Japanese characters — so the layout that
// cut the most off was the one a wide terminal chose.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const { parseUnifiedDiff } = require("../lib/diff-parser");
const { buildFileRows } = require("../lib/view-model");
const { anchorFromRow, formatBatch } = require("../lib/comments");
const { diffTextWidths, resolveLayout } = require("../lib/layout");
const { createState, reduce, toScreenModel, withLayout } = require("../lib/app-state");
const { renderScreen } = require("../lib/render");
const { displayWidth, prepareLine } = require("../lib/text");

const VIEWPORT = 20;

const ESC = "";
const CURSOR = new RegExp(ESC + "\\[\\d+;\\d+H", "g");
const HOME = new RegExp(ESC + "\\[H", "g");
const ERASE = new RegExp(ESC + "\\[0K", "g");
const SGR = new RegExp(ESC + "\\[[0-9;]*m", "g");

const BEFORE =
  "希望時期を自由記述で持つのは、表示ラベルと内部用の代表日の両方を同じ入力から導出できない" +
  "ため、将来の絞り込みにも使えません。会員から見た曖昧さも失われます。";
const AFTER =
  "希望時期を自由記述ではなく構造化して持つのは、表示ラベルと内部用の代表日の両方を同じ" +
  "入力から導出でき、将来の絞り込みにも使えるためである。会員から見た曖昧さは保たれる。";

const DIFF = [
  "diff --git a/notes.md b/notes.md",
  "--- a/notes.md",
  "+++ b/notes.md",
  "@@ -1,3 +1,3 @@",
  " # 見出し",
  `-${BEFORE}`,
  `+${AFTER}`,
  " 短い行",
].join("\n");

const FILE = parseUnifiedDiff(DIFF)[0];

function toPlainLines(frame) {
  return frame
    .replace(HOME, "")
    .replace(ERASE, "")
    .replace(CURSOR, "\n")
    .replace(SGR, "")
    .replace(/^\n/, "")
    .split("\n");
}

// --- the unified layout ------------------------------------------------------

test("wraps a unified row into the rows it needs", () => {
  const rows = buildFileRows(FILE, false, { unified: 40 });
  const deleted = rows.filter((row) => row.kind === "line" && row.cell.type === "del");

  assert.ok(deleted.length > 1, "the deleted line still fits on one row");
  assert.strictEqual(deleted.map((row) => row.cell.text).join(""), prepareLine(BEFORE));
});

test("only the first row of a wrapped diff line is numbered and signed", () => {
  const rows = buildFileRows(FILE, false, { unified: 40 });
  const added = rows.filter((row) => row.kind === "line" && row.cell.type === "add");

  assert.strictEqual(added[0].cell.continues, false);
  for (const row of added.slice(1)) {
    assert.strictEqual(row.cell.continues, true);
  }
});

test("leaves the lines uncut when no width is given", () => {
  // Which is what a preview column wants, and what a hand-built test state gets
  const rows = buildFileRows(FILE, false);
  const added = rows.filter((row) => row.kind === "line" && row.cell.type === "add");

  assert.strictEqual(added.length, 1);
});

// --- the two-column layout ---------------------------------------------------

test("wraps each side of a two-column row to its own column", () => {
  const rows = buildFileRows(FILE, true, { left: 30, right: 40 });
  const paired = rows.filter((row) => row.kind === "pair");

  const left = paired.map((row) => (row.left ? row.left.text : "")).join("");
  const right = paired.map((row) => (row.right ? row.right.text : "")).join("");

  assert.ok(left.includes(prepareLine(BEFORE)), "the old side lost something");
  assert.ok(right.includes(prepareLine(AFTER)), "the new side lost something");
});

test("the side that runs out first leaves the filler an absent side shows", () => {
  // The old line is shorter and its column is narrower, so the two runs are
  // different lengths and one of them has to end first
  const rows = buildFileRows(FILE, true, { left: 60, right: 20 });
  const paired = rows.filter((row) => row.kind === "pair");

  assert.ok(
    paired.some((row) => row.left === null || row.right === null),
    "neither side ever ran out, so this proves nothing"
  );
});

test("no piece is wider than the column it was wrapped to", () => {
  for (const columns of [160, 179, 200, 240]) {
    const layout = resolveLayout(columns);
    const widths = diffTextWidths(layout.diffWidth, layout.sideBySide);
    const rows = buildFileRows(FILE, layout.sideBySide, widths);

    for (const row of rows.filter((entry) => entry.kind === "pair")) {
      if (row.left) {
        assert.ok(displayWidth(row.left.text) <= widths.left, `left at ${columns}`);
      }
      if (row.right) {
        assert.ok(displayWidth(row.right.text) <= widths.right, `right at ${columns}`);
      }
    }
  }
});

// --- a wrapped line is still one line to a comment ---------------------------

test("every row of a wrapped unified line answers with the same anchor", () => {
  const rows = buildFileRows(FILE, false, { unified: 40 });
  const added = rows.filter((row) => row.kind === "line" && row.cell.type === "add");

  for (const row of added.slice(1)) {
    assert.deepStrictEqual(anchorFromRow(row), anchorFromRow(added[0]));
  }
});

test("every row of a wrapped two-column line answers with the same anchor", () => {
  // The one the whole design hangs on: a continuation whose old side has run out
  // must not start answering as a comment on the old side
  const rows = buildFileRows(FILE, true, { left: 30, right: 40 });
  const paired = rows.filter((row) => row.kind === "pair" && row.anchor.start === 2);

  assert.ok(paired.length > 1, "the changed line was not wrapped");
  for (const row of paired.slice(1)) {
    assert.deepStrictEqual(anchorFromRow(row), anchorFromRow(paired[0]));
  }
});

test("the quote is the line as the file has it, not as the screen cut it", () => {
  const rows = buildFileRows(FILE, false, { unified: 30 });
  const added = rows.filter((row) => row.kind === "line" && row.cell.type === "add");

  assert.deepStrictEqual(anchorFromRow(added[2]).lines, [`+${AFTER}`]);
});

test("a tab is still a tab in the quote, though it is spaces on screen", () => {
  const tabbed = parseUnifiedDiff(
    ["diff --git a/a.js b/a.js", "--- a/a.js", "+++ b/a.js", "@@ -1 +1 @@", "+\tconst a = 1;"].join("\n")
  )[0];

  const [row] = buildFileRows(tabbed, false, { unified: 8 }).filter((r) => r.kind === "line");

  assert.deepStrictEqual(anchorFromRow(row).lines, ["+\tconst a = 1;"]);
});

// --- through the pane --------------------------------------------------------

function run(cwd, args) {
  execFileSync("git", args, { cwd, stdio: "ignore" });
}

function makeRepo(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "herdr-deep-code-reading-dwrap-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  run(root, ["init", "-q"]);
  fs.writeFileSync(path.join(root, "notes.md"), ["# 見出し", BEFORE, "短い行", ""].join("\n"));
  run(root, ["add", "-A"]);
  run(root, ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init"]);
  fs.writeFileSync(path.join(root, "notes.md"), ["# 見出し", AFTER, "短い行", ""].join("\n"));

  return root;
}

function press(state, keys) {
  return keys.reduce((current, key) => reduce(current, key, VIEWPORT), state);
}

test("the diff view wraps at the width it is drawn at", (t) => {
  const root = makeRepo(t);

  for (const columns of [100, 179]) {
    const state = createState(root, "review", columns);
    const changed = state.rows.filter(
      (row) => row.anchor !== undefined && row.anchor.start === 2
    );

    assert.ok(changed.length > 1, `nothing wrapped at ${columns} columns`);
  }
});

test("every row still fills the terminal exactly", (t) => {
  const root = makeRepo(t);

  for (let columns = 100; columns <= 240; columns += 1) {
    const state = withLayout(createState(root, "review", columns), columns);
    const lines = toPlainLines(renderScreen(toScreenModel(state), { columns, rows: 14 }));

    for (const [index, line] of lines.entries()) {
      assert.strictEqual(
        displayWidth(line),
        columns,
        `line ${index + 1} is ${displayWidth(line)} columns at width ${columns}`
      );
    }
  }
});

test("a comment written on a continuation quotes the whole line", (t) => {
  const root = makeRepo(t);
  const state = createState(root, "review", 179);
  const changed = state.rows
    .map((row, index) => ({ row, index }))
    .filter(({ row }) => row.anchor !== undefined && row.anchor.start === 2);
  assert.ok(changed.length > 1, "the changed line was not wrapped");

  const onSecondPiece = { ...state, focus: "diff", cursor: changed[1].index };
  const written = press(onSecondPiece, ["c", "n", "o", "enter"]);

  assert.strictEqual(written.comments.length, 1);
  assert.strictEqual(written.comments[0].start, 2);
  assert.match(formatBatch(written.comments), /notes\.md:2/);
  // The whole of both sides, once each
  assert.deepStrictEqual(written.comments[0].lines, [`-${BEFORE}`, `+${AFTER}`]);
});

test("x deletes that comment from any row of the wrapped line", (t) => {
  const root = makeRepo(t);
  const state = createState(root, "review", 179);
  const changed = state.rows
    .map((row, index) => ({ row, index }))
    .filter(({ row }) => row.anchor !== undefined && row.anchor.start === 2);

  const written = press({ ...state, focus: "diff", cursor: changed[0].index }, [
    "c", "n", "o", "enter",
  ]);
  assert.strictEqual(written.comments.length, 1);

  const deleted = reduce({ ...written, cursor: changed[1].index }, "x", VIEWPORT);

  assert.strictEqual(deleted.comments.length, 0);
});

// --- following the terminal --------------------------------------------------

test("a resize rewraps the diff and keeps the cursor on its line", (t) => {
  const root = makeRepo(t);
  const wide = createState(root, "review", 240);
  const changed = wide.rows.findIndex(
    (row) => row.anchor !== undefined && row.anchor.start === 2
  );
  const onIt = { ...wide, focus: "diff", cursor: changed };
  const anchor = anchorFromRow(onIt.rows[onIt.cursor]);

  const narrowed = withLayout(onIt, 200);

  assert.deepStrictEqual(anchorFromRow(narrowed.rows[narrowed.cursor]), anchor);
});

test("crossing the two-column boundary starts the diff again rather than throwing", (t) => {
  // A deleted line read on the old side in one layout is read on the new side in
  // the other, so there is nothing to hold on to across the flip
  const root = makeRepo(t);
  const wide = createState(root, "review", 179);

  const narrow = withLayout({ ...wide, focus: "diff", cursor: wide.rows.length - 1 }, 120);

  assert.ok(narrow.cursor >= 0);
  assert.ok(narrow.cursor < narrow.rows.length);
});
