"use strict";

const test = require("node:test");
const assert = require("node:assert");

const { parseUnifiedDiff } = require("../lib/diff-parser");
const { renderScreen } = require("../lib/render");
const {
  INPUT_COMMIT,
  INPUT_FILTER,
  INPUT_FIND,
  INPUT_OPEN,
  INPUT_SEARCH,
} = require("../lib/view-names");
const { buildFileRows, countChanges, fileLabel, fileStatus } = require("../lib/view-model");
const { displayWidth } = require("../lib/text");

const SGR = /\u001b\[[0-9;]*m/g;
const CURSOR = /\u001b\[\d+;\d+H/g;
const ERASE = /\u001b\[0K/g;
const HOME = /\u001b\[H/g;

const DIFF = [
  "diff --git a/a.txt b/a.txt",
  "--- a/a.txt",
  "+++ b/a.txt",
  "@@ -1,3 +1,3 @@",
  " keep",
  "-削除された日本語の行",
  "+追加された日本語の行",
  " tail",
].join("\n");

/** Strip ANSI and split a frame into plain lines. */
function toPlainLines(frame) {
  return frame
    .replace(HOME, "")
    .replace(ERASE, "")
    .replace(CURSOR, "\n")
    .replace(SGR, "")
    .replace(/^\n/, "")
    .split("\n");
}

function makeModel(isSideBySide) {
  const files = parseUnifiedDiff(DIFF);
  return {
    title: "test",
    subtitle: "repo",
    files: files.map((file) => ({
      label: fileLabel(file),
      status: fileStatus(file),
      ...countChanges(file),
    })),
    selectedIndex: 0,
    rows: buildFileRows(files[0], isSideBySide),
    scroll: 0,
    focus: "panel",
    help: "help",
    message: null,
  };
}

test("renders every line at exactly the terminal width", () => {
  // Arrange
  const columns = 179;
  const model = makeModel(true);

  // Act
  const lines = toPlainLines(renderScreen(model, { columns, rows: 20 }));

  // Assert
  for (const [index, line] of lines.entries()) {
    assert.strictEqual(
      displayWidth(line),
      columns,
      `line ${index + 1} is ${displayWidth(line)} columns wide`
    );
  }
});

test("keeps the width exact for diffs containing full-width characters", () => {
  const columns = 120;
  const lines = toPlainLines(renderScreen(makeModel(false), { columns, rows: 16 }));

  for (const line of lines) {
    assert.strictEqual(displayWidth(line), columns);
  }
});

test("emits exactly as many lines as the terminal has rows", () => {
  const lines = toPlainLines(renderScreen(makeModel(true), { columns: 179, rows: 24 }));

  assert.strictEqual(lines.length, 24);
});

test("places the deleted and added line on one row in the two-column layout", () => {
  const lines = toPlainLines(renderScreen(makeModel(true), { columns: 179, rows: 20 }));
  const changed = lines.find((line) => line.includes("削除された日本語の行"));

  assert.ok(changed, "the deleted line is missing");
  assert.ok(changed.includes("追加された日本語の行"), "the added line is not beside it");
});

test("does not lose the deleted line in the unified layout", () => {
  // Regression: collapsing a pair when the terminal is narrow used to drop the deleted line
  const lines = toPlainLines(renderScreen(makeModel(false), { columns: 120, rows: 20 }));

  assert.ok(
    lines.some((line) => line.includes("削除された日本語の行")),
    "the deleted line was lost in the unified layout"
  );
  assert.ok(
    lines.some((line) => line.includes("追加された日本語の行")),
    "the added line was lost in the unified layout"
  );
});

test("puts the deleted and added line on separate rows in the unified layout", () => {
  const lines = toPlainLines(renderScreen(makeModel(false), { columns: 120, rows: 20 }));
  const deletedRow = lines.findIndex((line) => line.includes("削除された日本語の行"));
  const addedRow = lines.findIndex((line) => line.includes("追加された日本語の行"));

  assert.notStrictEqual(deletedRow, addedRow);
});

test("hides the file panel on a narrow screen", () => {
  const lines = toPlainLines(renderScreen(makeModel(false), { columns: 88, rows: 12 }));

  assert.ok(!lines[1].includes("a.txt"), "the panel was not hidden");
});

test("shows file names in the panel on a wide screen", () => {
  const lines = toPlainLines(renderScreen(makeModel(true), { columns: 179, rows: 12 }));

  assert.ok(lines.some((line) => line.includes("a.txt")));
});

test("draws a markdown heading in bold, and ordinary text without it", () => {
  // Differential, because the frame is bold in other places too — the panel's status
  // letters, a hunk header — and the question is only whether this token adds one.
  const withType = (type) => ({
    ...makeModel(false),
    rows: [{ kind: "line", cell: { num: 1, text: "# Title", tokens: [{ text: "# Title", type }] } }],
  });
  const boldRuns = (frame) => (frame.match(/\[[0-9;]*1m/g) || []).length;

  const heading = renderScreen(withType("heading"), { columns: 100, rows: 8 });
  const plain = renderScreen(withType("plain"), { columns: 100, rows: 8 });

  assert.ok(boldRuns(heading) > boldRuns(plain), "the heading was drawn like ordinary text");
});

test("every kind of text field names itself", () => {
  // Regression: a kind missing from the renderer's label table fell back to the
  // comment's label, and the quick find asked "comment undefined:undefined >".
  // The comment is the one kind that builds its label from the lines it is about.
  const kinds = [INPUT_COMMIT, INPUT_FILTER, INPUT_FIND, INPUT_OPEN, INPUT_SEARCH];

  for (const kind of kinds) {
    const model = { ...makeModel(false), input: { kind, text: "typed" } };
    const lines = toPlainLines(renderScreen(model, { columns: 100, rows: 8 }));
    const field = lines[lines.length - 1];

    assert.doesNotMatch(field, /undefined/, `${kind}: the field has no label of its own`);
    assert.match(field, /typed/, `${kind}: the field did not show what was typed`);
  }
});

test("draws the layout the rows were built for, not the one the width would pick", () => {
  // A wide terminal picks two columns on its own, and the reader can have asked for
  // one list of lines instead. Deciding that from the width a second time here put a
  // column separator down the middle of rows that have no second column.
  const size = { columns: 179, rows: 20 };
  const separators = (line) => (line.match(/│/g) || []).length;

  const split = toPlainLines(renderScreen({ ...makeModel(true), sideBySide: true }, size));
  const stacked = toPlainLines(renderScreen({ ...makeModel(false), sideBySide: false }, size));

  // The panel keeps its own separator either way; the second one is the diff's
  assert.ok(split.some((line) => separators(line) === 2), "the two-column diff lost its separator");
  assert.ok(stacked.every((line) => separators(line) <= 1), "a stacked diff was drawn in two columns");
});
