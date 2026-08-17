"use strict";

// How the log screen divides the terminal: branches beside the graph, and the diff
// of whatever the graph is pointing at underneath both.

const test = require("node:test");
const assert = require("node:assert");

const {
  BRANCH_MIN_COLUMNS,
  BRANCH_WIDTH,
  DIFF_MIN_HEIGHT,
  DIVIDER_ROWS,
  LOG_MIN_HEIGHT,
  resolveLogLayout,
} = require("../lib/log-layout");
const { SEPARATOR_WIDTH } = require("../lib/layout");

const TALL = 40;
const WIDE = 200;

// --- across the width -----------------------------------------------------------------

test("a wide terminal keeps the branch column beside the graph", () => {
  const layout = resolveLogLayout(WIDE, TALL);

  assert.strictEqual(layout.showBranches, true);
  assert.strictEqual(layout.branchWidth, BRANCH_WIDTH);
  assert.strictEqual(layout.graphWidth, WIDE - BRANCH_WIDTH - SEPARATOR_WIDTH);
});

test("the branch column is the first thing a narrow terminal gives up", () => {
  const layout = resolveLogLayout(BRANCH_MIN_COLUMNS - 1, TALL);

  assert.strictEqual(layout.showBranches, false);
  assert.strictEqual(layout.branchWidth, 0);
  assert.strictEqual(layout.graphWidth, BRANCH_MIN_COLUMNS - 1);
});

test("the two halves of every row add up to the terminal's width", () => {
  for (const columns of [60, 99, 100, 119, 120, 160, 200]) {
    const layout = resolveLogLayout(columns, TALL);
    const separators = layout.showBranches ? SEPARATOR_WIDTH : 0;

    assert.strictEqual(
      layout.branchWidth + separators + layout.graphWidth,
      columns,
      `${columns} columns`
    );
  }
});

test("the diff underneath is laid out the way the diff view lays itself out", () => {
  const layout = resolveLogLayout(WIDE, TALL);

  assert.strictEqual(layout.showPanel, true);
  assert.strictEqual(layout.panelWidth + layout.diffWidth, WIDE);
  assert.strictEqual(layout.sideBySide, true, "200 columns has room for two");
});

test("a chosen diff layout is honoured under the graph as it is anywhere else", () => {
  assert.strictEqual(resolveLogLayout(WIDE, TALL, "stacked").sideBySide, false);
});

// --- down the height --------------------------------------------------------------------

test("the graph takes the smaller share, and the diff the rest", () => {
  const layout = resolveLogLayout(WIDE, TALL);

  assert.ok(layout.logHeight >= LOG_MIN_HEIGHT);
  assert.ok(layout.diffHeight >= DIFF_MIN_HEIGHT);
  assert.ok(layout.logHeight < layout.diffHeight, "the diff is what is being read");
  assert.strictEqual(layout.logHeight + DIVIDER_ROWS + layout.diffHeight, TALL);
});

test("every height is accounted for, at any height", () => {
  for (let rows = 1; rows <= 60; rows += 1) {
    const layout = resolveLogLayout(WIDE, rows);
    const divider = layout.showDiff ? DIVIDER_ROWS : 0;

    assert.strictEqual(
      layout.logHeight + divider + layout.diffHeight,
      rows,
      `${rows} rows`
    );
    assert.ok(layout.logHeight >= 1, `${rows} rows leaves a graph`);
  }
});

test("a short terminal gives the whole body to the graph rather than two unreadable halves", () => {
  const layout = resolveLogLayout(WIDE, LOG_MIN_HEIGHT + DIFF_MIN_HEIGHT);

  assert.strictEqual(layout.showDiff, false);
  assert.strictEqual(layout.diffHeight, 0);
  assert.strictEqual(layout.logHeight, LOG_MIN_HEIGHT + DIFF_MIN_HEIGHT);
});

test("one more row than that is enough for both", () => {
  const layout = resolveLogLayout(WIDE, LOG_MIN_HEIGHT + DIFF_MIN_HEIGHT + DIVIDER_ROWS);

  assert.strictEqual(layout.showDiff, true);
  assert.strictEqual(layout.logHeight, LOG_MIN_HEIGHT);
  assert.strictEqual(layout.diffHeight, DIFF_MIN_HEIGHT);
});
