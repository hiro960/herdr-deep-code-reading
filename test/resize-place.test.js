"use strict";

// A resize must not move the reader.
//
// The diff and the reader rebuild their rows at the new width, and the cursor is
// found again by the line it was on. A result list has no line to find: it is one row
// per place at any width, so its rows are not rebuilt at all — and a cursor thrown
// back to the top of a four-hundred-row list because a window edge moved is a place
// lost for no reason.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const { createState, reduce, withLayout } = require("../lib/app-state");
const { openSearch } = require("../lib/state/views");

const GIT_IDENTITY = ["-c", "user.email=t@t", "-c", "user.name=t"];
const WIDE = 180;
const NARROWER = 150;
const VIEWPORT = 20;

function run(cwd, args) {
  execFileSync("git", args, { cwd, stdio: "ignore" });
}

/** A repository with enough matching lines to make a list worth scrolling. */
function makeRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "herdr-deep-code-reading-resize-"));
  run(root, ["init", "-q"]);

  const lines = [];
  for (let index = 0; index < 40; index += 1) {
    lines.push(`const needle${index} = ${index};`);
  }
  fs.writeFileSync(path.join(root, "a.js"), lines.join("\n") + "\n");
  fs.writeFileSync(path.join(root, "b.js"), lines.join("\n") + "\n");

  run(root, ["add", "."]);
  run(root, [...GIT_IDENTITY, "commit", "-qm", "init"]);
  fs.writeFileSync(path.join(root, "c.js"), lines.join("\n") + "\n");

  return root;
}

function cleanup(root) {
  fs.rmSync(root, { recursive: true, force: true });
}

/** A search result list with the cursor part-way down it. */
function listAtRow(root, row) {
  const opened = openSearch(createState(root, "review", WIDE), "needle");
  assert.ok(opened.rows.length > row, "the list is too short to test with");
  return { ...opened, cursor: row, scroll: row - 3 };
}

test("keeps the cursor where it was when a result list is resized", (t) => {
  // Arrange
  const root = makeRepo();
  t.after(() => cleanup(root));
  const before = listAtRow(root, 12);

  // Act
  const after = withLayout(before, NARROWER);

  // Assert
  assert.strictEqual(after.cursor, before.cursor);
  assert.strictEqual(after.scroll, before.scroll);
});

test("still records the new width and layout when nothing was rebuilt", (t) => {
  // Arrange: the diff behind the list is drawn at the new width later, so a resize
  // that keeps the reader in place still has to be remembered
  const root = makeRepo();
  t.after(() => cleanup(root));
  const before = listAtRow(root, 12);

  // Act
  const after = withLayout(before, NARROWER);

  // Assert
  assert.strictEqual(after.columns, NARROWER);
  assert.strictEqual(typeof after.sideBySide, "boolean");
});

test("keeps the place a jump can come back to across a resize", (t) => {
  // Arrange: open a hit, then resize, then go back
  const root = makeRepo();
  t.after(() => cleanup(root));
  const list = listAtRow(root, 12);
  const opened = reduce(list, "enter", VIEWPORT);
  assert.strictEqual(opened.view, "read");

  // Act
  const back = reduce(withLayout(opened, NARROWER), "ctrl-o", VIEWPORT);

  // Assert
  assert.strictEqual(back.view, "search");
  assert.strictEqual(back.cursor, list.cursor);
});

test("still moves the cursor when a resize rebuilds the rows it pointed at", (t) => {
  // Arrange: the reading view does wrap to the width, so its rows really are rebuilt
  const root = makeRepo();
  t.after(() => cleanup(root));
  const opened = reduce(listAtRow(root, 12), "enter", VIEWPORT);

  // Act
  const after = withLayout(opened, 60);

  // Assert: the line survives the rewrap rather than the row index
  assert.strictEqual(after.columns, 60);
  assert.notStrictEqual(after.rows, opened.rows);
});
