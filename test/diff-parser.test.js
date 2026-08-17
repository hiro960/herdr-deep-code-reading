"use strict";

const test = require("node:test");
const assert = require("node:assert");

const { parseUnifiedDiff } = require("../lib/diff-parser");

const SIMPLE_DIFF = [
  "diff --git a/f.txt b/f.txt",
  "index 0f2f4f1..b6a2b7c 100644",
  "--- a/f.txt",
  "+++ b/f.txt",
  "@@ -1,3 +1,4 @@",
  " a",
  "-b",
  "+B!",
  " c",
  "+d",
  "",
].join("\n");

test("parses a single changed file as one entry", () => {
  // Arrange / Act
  const files = parseUnifiedDiff(SIMPLE_DIFF);

  // Assert
  assert.strictEqual(files.length, 1);
  assert.strictEqual(files[0].oldPath, "f.txt");
  assert.strictEqual(files[0].newPath, "f.txt");
  assert.strictEqual(files[0].isBinary, false);
});

test("reads the start line and line count from the hunk header", () => {
  const [file] = parseUnifiedDiff(SIMPLE_DIFF);

  assert.strictEqual(file.hunks.length, 1);
  assert.deepStrictEqual(
    {
      oldStart: file.hunks[0].oldStart,
      oldCount: file.hunks[0].oldCount,
      newStart: file.hunks[0].newStart,
      newCount: file.hunks[0].newCount,
    },
    { oldStart: 1, oldCount: 3, newStart: 1, newCount: 4 }
  );
});

test("classifies each line as context, del, or add", () => {
  const [file] = parseUnifiedDiff(SIMPLE_DIFF);

  assert.deepStrictEqual(
    file.hunks[0].lines.map((line) => [line.type, line.text]),
    [
      ["context", "a"],
      ["del", "b"],
      ["add", "B!"],
      ["context", "c"],
      ["add", "d"],
    ]
  );
});

test("treats a hunk header with an omitted count as one line", () => {
  const diff = [
    "diff --git a/x.txt b/x.txt",
    "--- a/x.txt",
    "+++ b/x.txt",
    "@@ -3 +3 @@",
    "-old",
    "+new",
  ].join("\n");

  const [file] = parseUnifiedDiff(diff);

  assert.deepStrictEqual(
    {
      oldStart: file.hunks[0].oldStart,
      oldCount: file.hunks[0].oldCount,
      newStart: file.hunks[0].newStart,
      newCount: file.hunks[0].newCount,
    },
    { oldStart: 3, oldCount: 1, newStart: 3, newCount: 1 }
  );
});

test("splits a multi-file diff into one entry per file", () => {
  const diff = [
    "diff --git a/one.txt b/one.txt",
    "--- a/one.txt",
    "+++ b/one.txt",
    "@@ -1 +1 @@",
    "-one",
    "+ONE",
    "diff --git a/two.txt b/two.txt",
    "--- a/two.txt",
    "+++ b/two.txt",
    "@@ -1 +1 @@",
    "-two",
    "+TWO",
  ].join("\n");

  const files = parseUnifiedDiff(diff);

  assert.deepStrictEqual(
    files.map((file) => file.newPath),
    ["one.txt", "two.txt"]
  );
});

test("keeps multiple hunks of one file separate", () => {
  const diff = [
    "diff --git a/m.txt b/m.txt",
    "--- a/m.txt",
    "+++ b/m.txt",
    "@@ -1,2 +1,2 @@",
    "-a",
    "+A",
    " b",
    "@@ -10,2 +10,2 @@",
    " j",
    "-k",
    "+K",
  ].join("\n");

  const [file] = parseUnifiedDiff(diff);

  assert.strictEqual(file.hunks.length, 2);
  assert.strictEqual(file.hunks[1].oldStart, 10);
});

test("marks a new file and takes its path from the new side", () => {
  const diff = [
    "diff --git a/new.txt b/new.txt",
    "new file mode 100644",
    "--- /dev/null",
    "+++ b/new.txt",
    "@@ -0,0 +1,2 @@",
    "+hello",
    "+world",
  ].join("\n");

  const [file] = parseUnifiedDiff(diff);

  assert.strictEqual(file.isNew, true);
  assert.strictEqual(file.isDeleted, false);
  assert.strictEqual(file.newPath, "new.txt");
  assert.strictEqual(file.oldPath, null);
});

test("marks a deleted file", () => {
  const diff = [
    "diff --git a/gone.txt b/gone.txt",
    "deleted file mode 100644",
    "--- a/gone.txt",
    "+++ /dev/null",
    "@@ -1,2 +0,0 @@",
    "-hello",
    "-world",
  ].join("\n");

  const [file] = parseUnifiedDiff(diff);

  assert.strictEqual(file.isDeleted, true);
  assert.strictEqual(file.oldPath, "gone.txt");
  assert.strictEqual(file.newPath, null);
});

test("keeps both the old and the new path of a rename", () => {
  const diff = [
    "diff --git a/old/name.txt b/new/name.txt",
    "similarity index 95%",
    "rename from old/name.txt",
    "rename to new/name.txt",
    "--- a/old/name.txt",
    "+++ b/new/name.txt",
    "@@ -1 +1 @@",
    "-x",
    "+y",
  ].join("\n");

  const [file] = parseUnifiedDiff(diff);

  assert.strictEqual(file.isRenamed, true);
  assert.strictEqual(file.oldPath, "old/name.txt");
  assert.strictEqual(file.newPath, "new/name.txt");
});

test("marks a binary file and gives it no hunks", () => {
  const diff = [
    "diff --git a/img.png b/img.png",
    "index 1234567..89abcde 100644",
    "Binary files a/img.png and b/img.png differ",
  ].join("\n");

  const [file] = parseUnifiedDiff(diff);

  assert.strictEqual(file.isBinary, true);
  assert.deepStrictEqual(file.hunks, []);
});

test("does not treat the no-newline marker as a diff line", () => {
  const diff = [
    "diff --git a/n.txt b/n.txt",
    "--- a/n.txt",
    "+++ b/n.txt",
    "@@ -1 +1 @@",
    "-a",
    "\\ No newline at end of file",
    "+b",
    "\\ No newline at end of file",
  ].join("\n");

  const [file] = parseUnifiedDiff(diff);

  assert.deepStrictEqual(
    file.hunks[0].lines.map((line) => line.type),
    ["del", "add"]
  );
});

test("returns an empty array for empty input", () => {
  assert.deepStrictEqual(parseUnifiedDiff(""), []);
});

test("keeps an empty context line that is just a space", () => {
  const diff = [
    "diff --git a/s.txt b/s.txt",
    "--- a/s.txt",
    "+++ b/s.txt",
    "@@ -1,3 +1,3 @@",
    " first",
    " ",
    "-third",
    "+THIRD",
  ].join("\n");

  const [file] = parseUnifiedDiff(diff);

  assert.deepStrictEqual(
    file.hunks[0].lines.map((line) => [line.type, line.text]),
    [
      ["context", "first"],
      ["context", ""],
      ["del", "third"],
      ["add", "THIRD"],
    ]
  );
});

test("extracts a path that contains spaces", () => {
  const diff = [
    "diff --git a/my dir/a b.txt b/my dir/a b.txt",
    "--- a/my dir/a b.txt",
    "+++ b/my dir/a b.txt",
    "@@ -1 +1 @@",
    "-x",
    "+y",
  ].join("\n");

  const [file] = parseUnifiedDiff(diff);

  assert.strictEqual(file.newPath, "my dir/a b.txt");
});
