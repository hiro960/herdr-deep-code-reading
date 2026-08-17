"use strict";

// Finding typed text in the rows on screen.
//
// The rows are the file as the reader sees it, so these are about where a jump
// lands: which row, which column, and what happens at either end of the file.

const test = require("node:test");
const assert = require("node:assert");

const { findMatch } = require("../lib/find");

const line = (num, text) => ({ kind: "line", cell: { num, text, type: "context" } });

const ROWS = [
  line(1, "const alpha = 1;"),
  line(2, "function beta() {"),
  line(3, "  return alpha;"),
  line(4, "}"),
];

const at = (row, column) => ({ row, column });

test("finds the next match later on the same row", () => {
  const found = findMatch([line(1, "alpha and alpha")], "alpha", at(0, 0), 1);

  assert.deepStrictEqual(found, { row: 0, column: 10, wrapped: false });
});

test("moves on to a later row when the rest of the row has none", () => {
  const found = findMatch(ROWS, "alpha", at(0, 6), 1);

  assert.strictEqual(found.row, 2);
  assert.strictEqual(found.column, 9);
  assert.strictEqual(found.wrapped, false);
});

test("wraps to the top and says that it did", () => {
  const found = findMatch(ROWS, "alpha", at(2, 9), 1);

  assert.deepStrictEqual(found, { row: 0, column: 6, wrapped: true });
});

test("finds the match under the cursor again when it is the only one", () => {
  const rows = [line(1, "only alpha here"), line(2, "nothing")];

  const found = findMatch(rows, "alpha", at(0, 5), 1);

  assert.deepStrictEqual(found, { row: 0, column: 5, wrapped: true });
});

test("steps back to an earlier match on the same row", () => {
  const found = findMatch([line(1, "alpha and alpha")], "alpha", at(0, 10), -1);

  assert.deepStrictEqual(found, { row: 0, column: 0, wrapped: false });
});

test("steps back to an earlier row", () => {
  const found = findMatch(ROWS, "alpha", at(2, 9), -1);

  assert.deepStrictEqual(found, { row: 0, column: 6, wrapped: false });
});

test("wraps to the bottom searching backwards", () => {
  const found = findMatch(ROWS, "alpha", at(0, 6), -1);

  assert.deepStrictEqual(found, { row: 2, column: 9, wrapped: true });
});

test("answers nothing when the text is in none of the rows", () => {
  assert.strictEqual(findMatch(ROWS, "omega", at(0, 0), 1), null);
  assert.strictEqual(findMatch(ROWS, "omega", at(0, 0), -1), null);
});

test("answers nothing for an empty query", () => {
  assert.strictEqual(findMatch(ROWS, "", at(0, 0), 1), null);
});

test("matches the case that was typed", () => {
  const rows = [line(1, "Alpha"), line(2, "alpha")];

  assert.deepStrictEqual(findMatch(rows, "alpha", at(0, 0), 1), {
    row: 1,
    column: 0,
    wrapped: false,
  });
});

test("skips rows that carry no line", () => {
  const rows = [
    { kind: "hunk", text: "@@ -1,2 +1,2 @@ alpha" },
    { kind: "note", text: "alpha" },
    line(1, "const alpha = 1;"),
  ];

  const found = findMatch(rows, "alpha", at(0, 0), 1);

  assert.strictEqual(found.row, 2);
});

test("searches the side of a paired row the cursor can reach", () => {
  // The column cursor lands on the new side of a two-column row, so that is the
  // side a jump can put it on. A match only the old side has is left to the
  // stacked layout, where the deleted line is a row of its own.
  const rows = [
    {
      kind: "pair",
      left: { num: 1, text: "const alpha = 1;", type: "del" },
      right: { num: 1, text: "const omega = 1;", type: "add" },
    },
    line(2, "  return alpha;"),
  ];

  const found = findMatch(rows, "alpha", at(0, 0), 1);

  assert.strictEqual(found.row, 1, "the jump landed on a side the cursor cannot reach");
});

test("finds a match on a row of its own from the very start", () => {
  const found = findMatch(ROWS, "const", at(0, 0), 1);

  assert.deepStrictEqual(found, { row: 0, column: 0, wrapped: true });
});

test("stays inside the rows when the cursor is past the end", () => {
  const found = findMatch(ROWS, "alpha", at(99, 0), 1);

  assert.ok(found !== null);
  assert.ok(found.row >= 0 && found.row < ROWS.length);
});
