"use strict";

// How wide the frame believes the terminal is.
//
// Regression: a Herdr pane reported 152 columns through the pty and drew 151 of them,
// so every row the frame filled to the width it was told lost its last cell on the way
// to the screen — and a wrapped line lost the character the wrap had just moved to the
// next row. Nothing inside a pane can see that happen, so the frame gives the last
// column up rather than trusting it. Auto-wrap wants the same margin for its own
// reasons: a character in the last cell leaves a pending wrap behind it.

const test = require("node:test");
const assert = require("node:assert");

const { LAST_COLUMN_MARGIN, terminalSize } = require("../lib/run/terminal");
const { FALLBACK_COLUMNS } = require("../lib/layout");

/** Run with process.stdout reporting a size, and put back whatever it had. */
function reporting(size, run) {
  const columns = Object.getOwnPropertyDescriptor(process.stdout, "columns");
  const rows = Object.getOwnPropertyDescriptor(process.stdout, "rows");

  Object.defineProperty(process.stdout, "columns", { value: size.columns, configurable: true });
  Object.defineProperty(process.stdout, "rows", { value: size.rows, configurable: true });
  try {
    return run();
  } finally {
    restore("columns", columns);
    restore("rows", rows);
  }
}

function restore(name, descriptor) {
  if (descriptor === undefined) {
    delete process.stdout[name];
    return;
  }
  Object.defineProperty(process.stdout, name, descriptor);
}

test("the last column is not drawn into", () => {
  assert.strictEqual(reporting({ columns: 152, rows: 45 }, terminalSize).columns, 151);
});

test("the rows are taken as they come", () => {
  assert.strictEqual(reporting({ columns: 152, rows: 45 }, terminalSize).rows, 45);
});

test("a terminal that reports no width falls back, and gives the column up there too", () => {
  const size = reporting({ columns: undefined, rows: undefined }, terminalSize);

  assert.strictEqual(size.columns, FALLBACK_COLUMNS - LAST_COLUMN_MARGIN);
});

test("a terminal one column wide still has one to draw in", () => {
  // Nothing can be drawn in none, and a width of zero would divide the layout by it
  assert.strictEqual(reporting({ columns: 1, rows: 24 }, terminalSize).columns, 1);
});
