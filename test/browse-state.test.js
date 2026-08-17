"use strict";

const test = require("node:test");
const assert = require("node:assert");

const {
  createBrowse,
  descend,
  moveBrowse,
  selectedEntry,
  withFilter,
} = require("../lib/browse-state");

const PATHS = [
  "README.md",
  "package.json",
  "bin/open.js",
  "bin/review.js",
  "lib/ansi.js",
  "lib/deep/nested.js",
];

test("opens at the repository root", () => {
  const browse = createBrowse(PATHS, "");

  assert.strictEqual(browse.dir, "");
  assert.strictEqual(browse.index, 0);
  assert.strictEqual(browse.filter, "");
});

test("lists the entries of the directory it opened at", () => {
  const browse = createBrowse(PATHS, "bin");

  assert.deepStrictEqual(
    browse.entries.map((entry) => entry.name),
    ["open.js", "review.js"]
  );
});

// --- moving --------------------------------------------------------------

test("moves the selection down", () => {
  const browse = moveBrowse(createBrowse(PATHS, ""), 1);

  assert.strictEqual(browse.index, 1);
});

test("stops at the last entry", () => {
  const browse = createBrowse(PATHS, "");

  const moved = moveBrowse(browse, browse.entries.length + 5);

  assert.strictEqual(moved.index, browse.entries.length - 1);
});

test("stops at the first entry", () => {
  const moved = moveBrowse(createBrowse(PATHS, ""), -5);

  assert.strictEqual(moved.index, 0);
});

test("reports the entry under the selection", () => {
  const browse = moveBrowse(createBrowse(PATHS, ""), 1);

  assert.strictEqual(selectedEntry(browse).name, "lib");
});

test("reports nothing when the directory is empty", () => {
  assert.strictEqual(selectedEntry(createBrowse(PATHS, "missing")), null);
});

// --- descending and rising ----------------------------------------------

test("descends into the selected directory", () => {
  const browse = createBrowse(PATHS, "");

  const result = descend(browse, PATHS);

  assert.strictEqual(result.browse.dir, "bin");
  assert.strictEqual(result.openPath, null);
});

test("resets the selection when it descends", () => {
  const browse = moveBrowse(createBrowse(PATHS, ""), 1);

  assert.strictEqual(descend(browse, PATHS).browse.index, 0);
});

test("reports the file to open when the selection is a file", () => {
  // Root order is bin, lib, README.md, package.json
  const browse = moveBrowse(createBrowse(PATHS, ""), 2);

  const result = descend(browse, PATHS);

  assert.strictEqual(result.openPath, "README.md");
  assert.strictEqual(result.browse.dir, "");
});

test("does nothing in an empty directory", () => {
  const browse = createBrowse(PATHS, "missing");

  const result = descend(browse, PATHS);

  assert.strictEqual(result.openPath, null);
  assert.strictEqual(result.browse.dir, "missing");
});

// --- filtering -----------------------------------------------------------

test("narrows the listing to the matching entries", () => {
  const browse = withFilter(createBrowse(PATHS, ""), "read", PATHS);

  assert.deepStrictEqual(
    browse.entries.map((entry) => entry.name),
    ["README.md"]
  );
});

test("keeps the filter text on the browse state", () => {
  assert.strictEqual(withFilter(createBrowse(PATHS, ""), "re", PATHS).filter, "re");
});

test("restores the full listing when the filter is cleared", () => {
  const filtered = withFilter(createBrowse(PATHS, ""), "read", PATHS);

  const cleared = withFilter(filtered, "", PATHS);

  assert.strictEqual(cleared.entries.length, createBrowse(PATHS, "").entries.length);
});

test("moves the selection back into range when filtering shortens the list", () => {
  const browse = moveBrowse(createBrowse(PATHS, ""), 3);

  const filtered = withFilter(browse, "read", PATHS);

  assert.strictEqual(filtered.index, 0);
});

test("selects the best match rather than whatever sits at the old index", () => {
  // Regression: the filter ranks its results, so leaving the index where it was put
  // the highlight — and the preview beside it — on an entry nobody had chosen.
  // Two matches are the minimum that can tell the two behaviours apart.
  const browse = moveBrowse(createBrowse(PATHS, ""), 3);
  assert.notStrictEqual(browse.index, 0, "the old index has to differ from the top");

  const filtered = withFilter(browse, "e");

  assert.ok(filtered.entries.length > 1, "the filter has to leave a choice to get wrong");
  assert.strictEqual(filtered.index, 0);
  assert.strictEqual(selectedEntry(filtered), filtered.entries[0]);
});

test("keeps an empty listing when nothing matches", () => {
  const filtered = withFilter(createBrowse(PATHS, ""), "zzzz", PATHS);

  assert.deepStrictEqual(filtered.entries, []);
  assert.strictEqual(selectedEntry(filtered), null);
});
