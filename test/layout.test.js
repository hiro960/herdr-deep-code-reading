"use strict";

const test = require("node:test");
const assert = require("node:assert");

const {
  BROWSE_TWO_COLUMN_MIN,
  PANEL_WIDTH,
  resolveBrowseLayout,
  resolveLayout,
} = require("../lib/layout");

test("enables both the file panel and the two-column diff on a wide screen", () => {
  const layout = resolveLayout(179);

  assert.strictEqual(layout.showPanel, true);
  assert.strictEqual(layout.sideBySide, true);
  assert.strictEqual(layout.diffWidth, 179 - PANEL_WIDTH);
});

test("falls back to unified when the diff area is too narrow", () => {
  const layout = resolveLayout(120);

  assert.strictEqual(layout.showPanel, true);
  assert.strictEqual(layout.sideBySide, false);
});

test("hides the file panel on a narrow screen", () => {
  const layout = resolveLayout(88);

  assert.strictEqual(layout.showPanel, false);
  assert.strictEqual(layout.panelWidth, 0);
  assert.strictEqual(layout.diffWidth, 88);
});

test("enables the two-column diff exactly at its threshold", () => {
  const exact = resolveLayout(160);

  assert.strictEqual(exact.diffWidth, 160 - PANEL_WIDTH);
  assert.strictEqual(exact.sideBySide, true);
});

test("disables the two-column diff one column below the threshold", () => {
  assert.strictEqual(resolveLayout(159).sideBySide, false);
});

test("shows the panel exactly at its threshold", () => {
  assert.strictEqual(resolveLayout(100).showPanel, true);
  assert.strictEqual(resolveLayout(99).showPanel, false);
});

test("never reports a non-positive diff width on a tiny screen", () => {
  const layout = resolveLayout(10);

  assert.strictEqual(layout.showPanel, false);
  assert.ok(layout.diffWidth > 0);
});

// --- browse layout -------------------------------------------------------

test("splits a wide screen into parent, current, and preview", () => {
  const browse = resolveBrowseLayout(179);

  assert.ok(browse.parentWidth > 0);
  assert.ok(browse.currentWidth > 0);
  assert.ok(browse.previewWidth > 0);
});

test("gives the current directory more room than the parent", () => {
  const browse = resolveBrowseLayout(179);

  assert.ok(browse.currentWidth > browse.parentWidth);
});

test("fills the terminal exactly, separators included", () => {
  for (const columns of [70, 100, 120, 179, 240]) {
    const browse = resolveBrowseLayout(columns);
    const separators = [browse.parentWidth, browse.previewWidth].filter((w) => w > 0).length;
    const total = browse.parentWidth + browse.currentWidth + browse.previewWidth + separators;

    assert.strictEqual(total, columns, `at ${columns} columns`);
  }
});

test("drops the parent column before the preview", () => {
  const browse = resolveBrowseLayout(100);

  assert.strictEqual(browse.parentWidth, 0);
  assert.ok(browse.previewWidth > 0);
});

test("keeps only the current directory on a narrow screen", () => {
  const browse = resolveBrowseLayout(BROWSE_TWO_COLUMN_MIN - 1);

  assert.strictEqual(browse.parentWidth, 0);
  assert.strictEqual(browse.previewWidth, 0);
  assert.strictEqual(browse.currentWidth, BROWSE_TWO_COLUMN_MIN - 1);
});
