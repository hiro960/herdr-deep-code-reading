"use strict";

const test = require("node:test");
const assert = require("node:assert");

const { buildSideBySideRows } = require("../lib/side-by-side");

/** Build a hunk for testing. */
function makeHunk(lines, overrides) {
  return Object.assign(
    { oldStart: 1, oldCount: 0, newStart: 1, newCount: 0, header: "", lines },
    overrides
  );
}

test("puts a context line on both sides with the same content", () => {
  // Arrange
  const hunk = makeHunk([{ type: "context", text: "a" }]);

  // Act
  const rows = buildSideBySideRows(hunk);

  // Assert
  assert.deepStrictEqual(rows, [
    {
      left: { num: 1, text: "a", type: "context" },
      right: { num: 1, text: "a", type: "context" },
    },
  ]);
});

test("pairs one deleted line with one added line", () => {
  const hunk = makeHunk([
    { type: "del", text: "b" },
    { type: "add", text: "B" },
  ]);

  const rows = buildSideBySideRows(hunk);

  assert.deepStrictEqual(rows, [
    {
      left: { num: 1, text: "b", type: "del" },
      right: { num: 1, text: "B", type: "add" },
    },
  ]);
});

test("pads the left side with null when there are more added lines", () => {
  const hunk = makeHunk([
    { type: "del", text: "b" },
    { type: "add", text: "B1" },
    { type: "add", text: "B2" },
  ]);

  const rows = buildSideBySideRows(hunk);

  assert.deepStrictEqual(rows, [
    {
      left: { num: 1, text: "b", type: "del" },
      right: { num: 1, text: "B1", type: "add" },
    },
    { left: null, right: { num: 2, text: "B2", type: "add" } },
  ]);
});

test("pads the right side with null when there are more deleted lines", () => {
  const hunk = makeHunk([
    { type: "del", text: "a1" },
    { type: "del", text: "a2" },
    { type: "add", text: "A" },
  ]);

  const rows = buildSideBySideRows(hunk);

  assert.deepStrictEqual(rows, [
    {
      left: { num: 1, text: "a1", type: "del" },
      right: { num: 1, text: "A", type: "add" },
    },
    { left: { num: 2, text: "a2", type: "del" }, right: null },
  ]);
});

test("leaves the left side empty for a hunk of pure additions", () => {
  const hunk = makeHunk([
    { type: "add", text: "x" },
    { type: "add", text: "y" },
  ]);

  const rows = buildSideBySideRows(hunk);

  assert.deepStrictEqual(
    rows.map((row) => row.left),
    [null, null]
  );
  assert.deepStrictEqual(
    rows.map((row) => row.right.text),
    ["x", "y"]
  );
});

test("numbers the old and the new side independently", () => {
  // The hunk starts at line 10 in the old file and line 20 in the new one
  const hunk = makeHunk(
    [
      { type: "context", text: "keep" },
      { type: "del", text: "gone" },
      { type: "add", text: "added1" },
      { type: "add", text: "added2" },
      { type: "context", text: "tail" },
    ],
    { oldStart: 10, newStart: 20 }
  );

  const rows = buildSideBySideRows(hunk);

  assert.deepStrictEqual(
    rows.map((row) => [row.left && row.left.num, row.right && row.right.num]),
    [
      [10, 20],
      [11, 21],
      [null, 22],
      [12, 23],
    ]
  );
});

test("pairs runs separately when a context line splits them", () => {
  const hunk = makeHunk([
    { type: "del", text: "a" },
    { type: "add", text: "A" },
    { type: "context", text: "-" },
    { type: "del", text: "b" },
    { type: "add", text: "B" },
  ]);

  const rows = buildSideBySideRows(hunk);

  assert.deepStrictEqual(
    rows.map((row) => [
      row.left && row.left.text,
      row.right && row.right.text,
    ]),
    [
      ["a", "A"],
      ["-", "-"],
      ["b", "B"],
    ]
  );
});

test("pairs a run even when the added line comes first", () => {
  // git normally emits - before +, but the result must not depend on the order
  const hunk = makeHunk([
    { type: "add", text: "A" },
    { type: "del", text: "a" },
  ]);

  const rows = buildSideBySideRows(hunk);

  assert.deepStrictEqual(rows, [
    {
      left: { num: 1, text: "a", type: "del" },
      right: { num: 1, text: "A", type: "add" },
    },
  ]);
});

test("returns an empty array for an empty hunk", () => {
  assert.deepStrictEqual(buildSideBySideRows(makeHunk([])), []);
});
