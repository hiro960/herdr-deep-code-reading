"use strict";

// The browser moves a selection rather than a row cursor, so its movement keys used
// to be written out a second time. They now go through the one table every list
// shares, which only holds while the clamping agrees — including at both ends, and in
// a listing a filter has narrowed to nothing.

const test = require("node:test");
const assert = require("node:assert");

const { reduce } = require("../lib/app-state");
const { createBrowse, withFilter } = require("../lib/browse-state");

const PATHS = ["a.js", "b.js", "c.js", "d.js", "e.js"];
const LAST = PATHS.length - 1;
const VIEWPORT = 20;

function browsing(browse) {
  return {
    view: "browse",
    browse,
    repoPaths: PATHS,
    repoDir: process.cwd(),
    rows: [],
    cursor: 0,
    scroll: 0,
    columns: 100,
    files: [],
    selectedIndex: 0,
    readMode: "content",
    comments: [],
    history: [],
    input: null,
    picker: null,
    message: null,
    effect: null,
    pendingQuit: false,
    quit: false,
  };
}

function atRoot() {
  return browsing(createBrowse(PATHS, ""));
}

test("G goes to the last entry of the listing", () => {
  // Arrange
  const state = atRoot();

  // Act
  const moved = reduce(state, "G", VIEWPORT);

  // Assert
  assert.strictEqual(moved.browse.index, LAST);
});

test("g comes back to the first", () => {
  // Arrange
  const atEnd = reduce(atRoot(), "G", VIEWPORT);

  // Act
  const moved = reduce(atEnd, "g", VIEWPORT);

  // Assert
  assert.strictEqual(moved.browse.index, 0);
});

test("j and k step one entry, stopping at the ends", () => {
  // Arrange
  const state = atRoot();

  // Act
  const down = reduce(state, "j", VIEWPORT);
  const backUp = reduce(reduce(down, "k", VIEWPORT), "k", VIEWPORT);

  // Assert
  assert.strictEqual(down.browse.index, 1);
  assert.strictEqual(backUp.browse.index, 0);
});

test("a page longer than the listing stops at the last entry", () => {
  // Arrange: half of a twenty-row viewport is ten, and there are five entries
  const state = atRoot();

  // Act
  const moved = reduce(state, "d", VIEWPORT);

  // Assert
  assert.strictEqual(moved.browse.index, LAST);
});

test("the movement keys do nothing in a listing narrowed to nothing", () => {
  // Arrange
  const state = browsing(withFilter(createBrowse(PATHS, ""), "zzzz"));
  assert.strictEqual(state.browse.entries.length, 0);

  // Act
  const jumped = reduce(state, "G", VIEWPORT);
  const stepped = reduce(state, "j", VIEWPORT);

  // Assert
  assert.strictEqual(jumped.browse.index, 0);
  assert.strictEqual(stepped.browse.index, 0);
});

test("the browser's own keys still beat the movement table", () => {
  // Arrange: `d` pages, but `e` and `h` are the browser's and must not be read as
  // movement keys just because the table sees every key it does not answer
  const state = atRoot();

  // Act
  const left = reduce(state, "h", VIEWPORT);

  // Assert: h at the root ascends to the root, which changes nothing
  assert.strictEqual(left.view, "browse");
  assert.strictEqual(left.browse.dir, "");
});
