"use strict";

// Reading the two sides git left in a file it could not merge.
//
// The markers are only markers inside an open conflict, which is most of what is worth
// checking here: `=======` under a line of prose is a markdown heading, and a file two
// people edited at once is exactly the kind of file that has one.

const test = require("node:test");
const assert = require("node:assert");

const {
  CONFLICT_BASE,
  CONFLICT_BASE_START,
  CONFLICT_END,
  CONFLICT_MIDDLE,
  CONFLICT_OURS,
  CONFLICT_START,
  CONFLICT_THEIRS,
  conflictRows,
  countConflicts,
  firstConflictLine,
  hasConflictMarkers,
  sideOfLines,
  withConflictSides,
} = require("../lib/conflict");

/** A file with one conflict in it, as git writes one. */
function conflicted() {
  return [
    "before",
    "<<<<<<< HEAD",
    "ours",
    "=======",
    "theirs",
    ">>>>>>> origin/main",
    "after",
  ];
}

function line(num, text) {
  return { kind: "line", cell: { num, text, type: "context" } };
}

// --- which side each line is on -------------------------------------------------------

test("each line of a conflict is on the side its markers put it", () => {
  // Arrange
  const lines = conflicted();

  // Act
  const sides = sideOfLines(lines);

  // Assert
  assert.deepStrictEqual(sides, [
    null,
    CONFLICT_START,
    CONFLICT_OURS,
    CONFLICT_MIDDLE,
    CONFLICT_THEIRS,
    CONFLICT_END,
    null,
  ]);
});

test("the file git could not merge is mostly not a conflict at all", () => {
  const sides = sideOfLines(["one", "two", "three"]);

  assert.deepStrictEqual(sides, [null, null, null]);
});

test("a heading underlined in markdown is not the middle of anything", () => {
  // Arrange: setext underlines, which are seven or more equals signs on their own line
  const lines = ["A heading", "=========", "prose", "Another", "======="];

  // Act
  const sides = sideOfLines(lines);

  // Assert
  assert.deepStrictEqual(sides, [null, null, null, null, null]);
});

test("the third part of a diff3 conflict is read as what both sides started from", () => {
  // Arrange
  const lines = [
    "<<<<<<< HEAD",
    "ours",
    "||||||| merged common ancestors",
    "base",
    "=======",
    "theirs",
    ">>>>>>> other",
  ];

  // Act
  const sides = sideOfLines(lines);

  // Assert
  assert.deepStrictEqual(sides, [
    CONFLICT_START,
    CONFLICT_OURS,
    CONFLICT_BASE_START,
    CONFLICT_BASE,
    CONFLICT_MIDDLE,
    CONFLICT_THEIRS,
    CONFLICT_END,
  ]);
});

test("markers longer than seven are still markers", () => {
  // merge.conflictMarkerSize makes them longer, and a file that uses them is a file
  // whose own lines might otherwise have looked like the short ones
  const lines = ["<<<<<<<<<< HEAD", "ours", "==========", "theirs", ">>>>>>>>>> other"];

  assert.deepStrictEqual(sideOfLines(lines), [
    CONFLICT_START,
    CONFLICT_OURS,
    CONFLICT_MIDDLE,
    CONFLICT_THEIRS,
    CONFLICT_END,
  ]);
});

test("a conflict nobody closed keeps its side to the end of the file", () => {
  // What the file says is what is read: a half-written resolution is still half-written
  const sides = sideOfLines(["<<<<<<< HEAD", "ours", "still ours"]);

  assert.deepStrictEqual(sides, [CONFLICT_START, CONFLICT_OURS, CONFLICT_OURS]);
});

test("a closing marker outside a conflict is a line of the file", () => {
  assert.deepStrictEqual(sideOfLines([">>>>>>> not a marker here"]), [null]);
});

// --- whether there is one at all ------------------------------------------------------

test("a file still holding a conflict says so, and a settled one does not", () => {
  assert.strictEqual(hasConflictMarkers(conflicted()), true);
  assert.strictEqual(hasConflictMarkers(["one", "two"]), false);
});

test("a stray divider is not evidence of anything", () => {
  // Which is the whole reason the opening marker is what is looked for
  assert.strictEqual(hasConflictMarkers(["Heading", "======="]), false);
});

test("how many conflicts a file holds, and where the first of them opens", () => {
  // Arrange
  const lines = [...conflicted(), ...conflicted()];

  // Act & Assert
  assert.strictEqual(countConflicts(lines), 2);
  assert.strictEqual(firstConflictLine(lines), 2);
  assert.strictEqual(countConflicts(["one"]), 0);
  assert.strictEqual(firstConflictLine(["one"]), 1);
});

// --- what the rows carry ---------------------------------------------------------------

test("every row of a conflicted file carries the side its line is on", () => {
  // Arrange
  const rows = conflicted().map((text, index) => line(index + 1, text));

  // Act
  const marked = withConflictSides(rows, sideOfLines(conflicted()));

  // Assert
  assert.deepStrictEqual(
    marked.map((row) => row.cell.conflict),
    [
      undefined,
      CONFLICT_START,
      CONFLICT_OURS,
      CONFLICT_MIDDLE,
      CONFLICT_THEIRS,
      CONFLICT_END,
      undefined,
    ]
  );
});

test("marking a row leaves the row it was built from alone", () => {
  // Arrange
  const rows = [line(1, "<<<<<<< HEAD")];

  // Act
  const marked = withConflictSides(rows, [CONFLICT_START]);

  // Assert
  assert.strictEqual(rows[0].cell.conflict, undefined, "the row given was written to");
  assert.strictEqual(marked[0].cell.conflict, CONFLICT_START);
});

test("a row that is not a line is passed over rather than marked", () => {
  const rows = [{ kind: "note", text: "Empty file" }];

  assert.deepStrictEqual(withConflictSides(rows, [CONFLICT_START]), rows);
});

test("every row of a wrapped line is on the same side, because it is the same line", () => {
  // Arrange: one line of the file, three rows of the screen
  const wrapped = [
    { kind: "line", cell: { num: 3, text: "ou", continues: false } },
    { kind: "line", cell: { num: 3, text: "rs", continues: true } },
  ];

  // Act
  const marked = withConflictSides(wrapped, [null, null, CONFLICT_OURS]);

  // Assert
  assert.deepStrictEqual(
    marked.map((row) => row.cell.conflict),
    [CONFLICT_OURS, CONFLICT_OURS]
  );
});

test("the rows each conflict opens on are where the stepping keys go", () => {
  // Arrange: two conflicts, so there is a second place to step to
  const lines = [...conflicted(), ...conflicted()];
  const rows = withConflictSides(
    lines.map((text, index) => line(index + 1, text)),
    sideOfLines(lines)
  );

  // Act & Assert
  assert.deepStrictEqual(conflictRows(rows), [1, 8]);
  assert.deepStrictEqual(conflictRows([line(1, "plain")]), []);
});
