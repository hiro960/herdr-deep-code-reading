"use strict";

const test = require("node:test");
const assert = require("node:assert");

const { isStaged, isUnstaged, isUntracked, parseStatus, statusLabel } = require("../lib/status");

const NUL = "\u0000";

/** Build a `git status --porcelain=v1 -z` payload. */
function payload(...records) {
  return records.join(NUL) + NUL;
}

test("parses a staged modification", () => {
  // Arrange / Act
  const entries = parseStatus(payload("M  src/a.js"));

  // Assert
  assert.deepStrictEqual(entries, [
    { index: "M", worktree: " ", path: "src/a.js", origPath: null },
  ]);
});

test("parses an unstaged modification", () => {
  const [entry] = parseStatus(payload(" M src/a.js"));

  assert.strictEqual(entry.index, " ");
  assert.strictEqual(entry.worktree, "M");
});

test("parses a file that is both staged and modified again", () => {
  const [entry] = parseStatus(payload("MM src/a.js"));

  assert.strictEqual(entry.index, "M");
  assert.strictEqual(entry.worktree, "M");
});

test("parses an untracked file", () => {
  const [entry] = parseStatus(payload("?? new.txt"));

  assert.strictEqual(entry.index, "?");
  assert.strictEqual(entry.worktree, "?");
  assert.strictEqual(entry.path, "new.txt");
});

test("parses several entries", () => {
  const entries = parseStatus(payload("M  a.txt", " D b.txt", "?? c.txt"));

  assert.deepStrictEqual(
    entries.map((entry) => entry.path),
    ["a.txt", "b.txt", "c.txt"]
  );
});

test("consumes the original path of a rename as a second record", () => {
  // A rename emits "R  <new>\\0<old>\\0", so the old path must not become its own entry
  const entries = parseStatus(payload("R  new/name.txt", "old/name.txt", "?? other.txt"));

  assert.strictEqual(entries.length, 2);
  assert.deepStrictEqual(entries[0], {
    index: "R",
    worktree: " ",
    path: "new/name.txt",
    origPath: "old/name.txt",
  });
  assert.strictEqual(entries[1].path, "other.txt");
});

test("consumes the original path of a copy the same way", () => {
  const entries = parseStatus(payload("C  copy.txt", "source.txt"));

  assert.strictEqual(entries.length, 1);
  assert.strictEqual(entries[0].origPath, "source.txt");
});

test("keeps a path that contains spaces", () => {
  const [entry] = parseStatus(payload("M  my dir/a b.txt"));

  assert.strictEqual(entry.path, "my dir/a b.txt");
});

test("returns an empty array for a clean tree", () => {
  assert.deepStrictEqual(parseStatus(""), []);
});

test("ignores a trailing empty record", () => {
  assert.strictEqual(parseStatus("M  a.txt" + NUL + NUL).length, 1);
});

test("parses a merge conflict entry", () => {
  const [entry] = parseStatus(payload("UU conflict.txt"));

  assert.strictEqual(entry.index, "U");
  assert.strictEqual(entry.worktree, "U");
});

// --- derived flags -------------------------------------------------------

test("treats an index letter as staged", () => {
  assert.strictEqual(isStaged({ index: "M", worktree: " " }), true);
  assert.strictEqual(isStaged({ index: "A", worktree: " " }), true);
});

test("does not treat a clean index as staged", () => {
  assert.strictEqual(isStaged({ index: " ", worktree: "M" }), false);
});

test("does not treat an untracked file as staged", () => {
  assert.strictEqual(isStaged({ index: "?", worktree: "?" }), false);
});

test("treats a worktree letter as unstaged", () => {
  assert.strictEqual(isUnstaged({ index: " ", worktree: "M" }), true);
});

test("does not treat an untracked file as unstaged", () => {
  assert.strictEqual(isUnstaged({ index: "?", worktree: "?" }), false);
});

test("recognises an untracked file", () => {
  assert.strictEqual(isUntracked({ index: "?", worktree: "?" }), true);
  assert.strictEqual(isUntracked({ index: "M", worktree: " " }), false);
});

test("labels an entry with both status letters", () => {
  assert.strictEqual(statusLabel({ index: "M", worktree: " " }), "M ");
  assert.strictEqual(statusLabel({ index: " ", worktree: "M" }), " M");
  assert.strictEqual(statusLabel({ index: "?", worktree: "?" }), "??");
});
