"use strict";

const test = require("node:test");
const assert = require("node:assert");

const { buildUnifiedRows } = require("../lib/unified");

function makeHunk(lines, overrides) {
  return Object.assign(
    { oldStart: 1, oldCount: 0, newStart: 1, newCount: 0, header: "", lines },
    overrides
  );
}

test("keeps both the deleted and the added line", () => {
  // Arrange: a pair the two-column layout would collapse into one row
  const hunk = makeHunk([
    { type: "del", text: "old" },
    { type: "add", text: "new" },
  ]);

  // Act
  const rows = buildUnifiedRows(hunk);

  // Assert: unified must keep them as two rows
  assert.deepStrictEqual(
    rows.map((row) => [row.type, row.text]),
    [
      ["del", "old"],
      ["add", "new"],
    ]
  );
});

test("numbers a deleted line from the old file", () => {
  const hunk = makeHunk([{ type: "del", text: "x" }], { oldStart: 7, newStart: 20 });

  assert.strictEqual(buildUnifiedRows(hunk)[0].num, 7);
});

test("numbers an added line from the new file", () => {
  const hunk = makeHunk([{ type: "add", text: "x" }], { oldStart: 7, newStart: 20 });

  assert.strictEqual(buildUnifiedRows(hunk)[0].num, 20);
});

test("advances both counters across a context line", () => {
  const hunk = makeHunk(
    [
      { type: "context", text: "a" },
      { type: "del", text: "b" },
      { type: "add", text: "B" },
      { type: "context", text: "c" },
    ],
    { oldStart: 10, newStart: 10 }
  );

  const rows = buildUnifiedRows(hunk);

  assert.deepStrictEqual(
    rows.map((row) => [row.type, row.num]),
    [
      ["context", 10],
      ["del", 11],
      ["add", 11],
      ["context", 12],
    ]
  );
});

test("preserves the original line order", () => {
  const hunk = makeHunk([
    { type: "context", text: "1" },
    { type: "del", text: "2" },
    { type: "del", text: "3" },
    { type: "add", text: "4" },
    { type: "context", text: "5" },
  ]);

  assert.deepStrictEqual(
    buildUnifiedRows(hunk).map((row) => row.text),
    ["1", "2", "3", "4", "5"]
  );
});

test("returns an empty array for an empty hunk", () => {
  assert.deepStrictEqual(buildUnifiedRows(makeHunk([])), []);
});
