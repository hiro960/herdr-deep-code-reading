"use strict";

// A file git has never seen is read rather than diffed, so these check that reading
// it produces the same shape `git diff --no-index` did. The expected shapes were
// taken from git's own output for each case.

const test = require("node:test");
const assert = require("node:assert");

const { buildUntrackedFile } = require("../lib/untracked");
const { buildFileRows } = require("../lib/view-model");

test("reads every line of the file as an added line", () => {
  // Arrange
  const result = { ok: true, lines: ["const a = 1;", "const b = 2;"] };

  // Act
  const file = buildUntrackedFile("lib/a.js", result);

  // Assert
  assert.deepStrictEqual(
    file.hunks[0].lines,
    [
      { type: "add", text: "const a = 1;" },
      { type: "add", text: "const b = 2;" },
    ]
  );
});

test("presents the file as an addition, with no old side", () => {
  // Arrange
  const result = { ok: true, lines: ["one"] };

  // Act
  const file = buildUntrackedFile("top.txt", result);

  // Assert
  assert.strictEqual(file.isNew, true);
  assert.strictEqual(file.oldPath, null);
  assert.strictEqual(file.newPath, "top.txt");
  assert.strictEqual(file.isDeleted, false);
  assert.strictEqual(file.isRenamed, false);
  assert.strictEqual(file.isBinary, false);
});

test("numbers the hunk from the first line of the new file", () => {
  // Arrange
  const result = { ok: true, lines: ["a", "b", "c"] };

  // Act
  const [hunk] = buildUntrackedFile("a.txt", result).hunks;

  // Assert: git writes "@@ -0,0 +1,3 @@" for a whole new file
  assert.strictEqual(hunk.oldStart, 0);
  assert.strictEqual(hunk.oldCount, 0);
  assert.strictEqual(hunk.newStart, 1);
  assert.strictEqual(hunk.newCount, 3);
});

test("gives an empty file no hunk at all", () => {
  // Arrange: git prints the header and stops — there is nothing to show
  const result = { ok: true, lines: [] };

  // Act
  const file = buildUntrackedFile("empty.txt", result);

  // Assert
  assert.deepStrictEqual(file.hunks, []);
  assert.strictEqual(file.isBinary, false);
});

test("marks a binary file binary rather than reading it as lines", () => {
  // Arrange
  const result = { ok: false, reason: "Binary file — nothing to read here", isBinary: true };

  // Act
  const file = buildUntrackedFile("bin.dat", result);

  // Assert
  assert.strictEqual(file.isBinary, true);
  assert.deepStrictEqual(file.hunks, []);
});

test("carries the reason a file could not be read", () => {
  // Arrange: too large, unreadable, or outside the repository
  const result = { ok: false, reason: "File is too large to show (over 2MB)" };

  // Act
  const file = buildUntrackedFile("huge.log", result);

  // Assert: the file still appears in the list, saying why it is not shown
  assert.strictEqual(file.note, "File is too large to show (over 2MB)");
  assert.strictEqual(file.isBinary, false);
  assert.deepStrictEqual(file.hunks, []);
});

test("shows the reason on screen instead of claiming there are no changes", () => {
  // Arrange
  const file = buildUntrackedFile("huge.log", {
    ok: false,
    reason: "File is too large to show (over 2MB)",
  });

  // Act
  const rows = buildFileRows(file, false);

  // Assert
  assert.deepStrictEqual(rows, [
    { kind: "note", text: "File is too large to show (over 2MB)" },
  ]);
});
