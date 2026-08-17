"use strict";

// The footer carries every key a view binds, so it wraps rather than truncating.

const test = require("node:test");
const assert = require("node:assert");

const { MAX_HELP_ROWS, OVERFLOW, helpRowCount, wrapHelp } = require("../lib/help-layout");

const HELP = "j/k move  Tab panel  c comment  x delete  q quit";

test("keeps a footer that fits on one row", () => {
  assert.deepStrictEqual(wrapHelp(HELP, 200), [HELP]);
});

test("breaks between items rather than inside one", () => {
  const rows = wrapHelp(HELP, 24);

  assert.ok(rows.length > 1);
  for (const row of rows) {
    assert.doesNotMatch(row, /^ | $/, `"${row}" was broken mid-item`);
  }
});

test("loses no item to the wrap", () => {
  const rows = wrapHelp(HELP, 24);

  assert.strictEqual(rows.join("  "), HELP);
});

test("keeps every row inside the width it was given", () => {
  for (const columns of [20, 24, 30, 48, 60, 79, 120]) {
    for (const row of wrapHelp(HELP, columns)) {
      // The one exception is an item longer than the width, which cannot be split
      const itemsFit = row.split("  ").every((item) => item.length <= columns);
      assert.ok(
        row.length <= columns || !itemsFit,
        `at ${columns} columns: "${row}" is ${row.length} long`
      );
    }
  }
});

test("gives an item too long for the width a row of its own", () => {
  const rows = wrapHelp("a b  an-item-far-longer-than-the-width  c d", 12);

  assert.ok(rows.includes("an-item-far-longer-than-the-width"));
});

test("never uses more rows than it is allowed", () => {
  const long = Array.from({ length: 40 }, (_, index) => `k${index} does thing ${index}`).join("  ");

  assert.ok(wrapHelp(long, 40).length <= MAX_HELP_ROWS);
  assert.strictEqual(wrapHelp(long, 40, 2).length, 2);
});

test("the row that says there is more never cuts a key in half", () => {
  // Arrange: more items than the rows allowed can hold, so the last row overflows
  const items = Array.from({ length: 40 }, (_, index) => `k${index} does thing ${index}`);

  // Act
  const rows = wrapHelp(items.join("  "), 40, 2);

  // Assert: the last row ends with the marker, and everything before it is a whole item
  const last = rows[rows.length - 1];
  assert.ok(last.endsWith(OVERFLOW), "the last row does not say there is more");
  for (const item of last.slice(0, -OVERFLOW.length).split("  ").filter((part) => part !== "")) {
    assert.ok(items.includes(item), `${JSON.stringify(item)} is not a whole item`);
  }
});

test("always gives at least one row, even for nothing", () => {
  assert.deepStrictEqual(wrapHelp("", 80), [""]);
  assert.strictEqual(helpRowCount("", 80), 1);
});

test("survives a width of zero", () => {
  assert.ok(wrapHelp(HELP, 0).length >= 1);
});

test("counts the rows it would use", () => {
  for (const columns of [20, 40, 80, 200]) {
    assert.strictEqual(helpRowCount(HELP, columns), wrapHelp(HELP, columns).length);
  }
});
