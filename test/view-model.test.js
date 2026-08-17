"use strict";

const test = require("node:test");
const assert = require("node:assert");

const {
  buildFileRows,
  countChanges,
  fileLabel,
  fileStatus,
} = require("../lib/view-model");
const { parseUnifiedDiff } = require("../lib/diff-parser");

const DIFF = [
  "diff --git a/f.txt b/f.txt",
  "--- a/f.txt",
  "+++ b/f.txt",
  "@@ -1,3 +1,4 @@ section",
  " a",
  "-b",
  "+B!",
  " c",
  "+d",
].join("\n");

test("emits a hunk header row followed by the paired lines", () => {
  // Arrange
  const [file] = parseUnifiedDiff(DIFF);

  // Act
  const rows = buildFileRows(file);

  // Assert
  assert.strictEqual(rows[0].kind, "hunk");
  assert.deepStrictEqual(
    rows.slice(1).map((row) => row.kind),
    ["pair", "pair", "pair", "pair"]
  );
});

test("includes the range and the section heading in the hunk header", () => {
  const [file] = parseUnifiedDiff(DIFF);

  const rows = buildFileRows(file);

  assert.match(rows[0].text, /-1,3 \+1,4/);
  assert.match(rows[0].text, /section/);
});

test("emits only a note for a binary file", () => {
  const [file] = parseUnifiedDiff(
    [
      "diff --git a/i.png b/i.png",
      "Binary files a/i.png and b/i.png differ",
    ].join("\n")
  );

  const rows = buildFileRows(file);

  assert.deepStrictEqual(
    rows.map((row) => row.kind),
    ["note"]
  );
});

test("emits a no-changes note for a file with no hunks", () => {
  const [file] = parseUnifiedDiff(
    ["diff --git a/e.txt b/e.txt", "--- a/e.txt", "+++ b/e.txt"].join("\n")
  );

  const rows = buildFileRows(file);

  assert.deepStrictEqual(
    rows.map((row) => row.kind),
    ["note"]
  );
});

test("emits one row per line in the unified layout", () => {
  // The two-column layout collapses these into one row; unified must not
  const [file] = parseUnifiedDiff(DIFF);

  const rows = buildFileRows(file, false);

  assert.deepStrictEqual(
    rows.slice(1).map((row) => row.kind),
    ["line", "line", "line", "line", "line"]
  );
});

test("keeps the deleted line in the unified layout", () => {
  const [file] = parseUnifiedDiff(DIFF);

  const rows = buildFileRows(file, false);

  assert.ok(rows.some((row) => row.kind === "line" && row.cell.text === "b"));
});

test("reports a new file with status A", () => {
  const [file] = parseUnifiedDiff(
    [
      "diff --git a/n.txt b/n.txt",
      "new file mode 100644",
      "--- /dev/null",
      "+++ b/n.txt",
      "@@ -0,0 +1 @@",
      "+x",
    ].join("\n")
  );

  assert.strictEqual(fileStatus(file), "A");
});

test("reports a deleted file with status D", () => {
  const [file] = parseUnifiedDiff(
    [
      "diff --git a/d.txt b/d.txt",
      "deleted file mode 100644",
      "--- a/d.txt",
      "+++ /dev/null",
      "@@ -1 +0,0 @@",
      "-x",
    ].join("\n")
  );

  assert.strictEqual(fileStatus(file), "D");
});

test("reports a modified file with status M", () => {
  const [file] = parseUnifiedDiff(DIFF);

  assert.strictEqual(fileStatus(file), "M");
});

test("labels a rename as old path to new path", () => {
  const [file] = parseUnifiedDiff(
    [
      "diff --git a/old.txt b/new.txt",
      "rename from old.txt",
      "rename to new.txt",
      "--- a/old.txt",
      "+++ b/new.txt",
      "@@ -1 +1 @@",
      "-x",
      "+y",
    ].join("\n")
  );

  assert.strictEqual(fileStatus(file), "R");
  assert.strictEqual(fileLabel(file), "old.txt → new.txt");
});

test("labels a deleted file with its old path", () => {
  const [file] = parseUnifiedDiff(
    [
      "diff --git a/d.txt b/d.txt",
      "deleted file mode 100644",
      "--- a/d.txt",
      "+++ /dev/null",
      "@@ -1 +0,0 @@",
      "-x",
    ].join("\n")
  );

  assert.strictEqual(fileLabel(file), "d.txt");
});

test("counts added and deleted lines", () => {
  const [file] = parseUnifiedDiff(DIFF);

  assert.deepStrictEqual(countChanges(file), { added: 2, deleted: 1 });
});

test("sums counts across multiple hunks", () => {
  const [file] = parseUnifiedDiff(
    [
      "diff --git a/m.txt b/m.txt",
      "--- a/m.txt",
      "+++ b/m.txt",
      "@@ -1,2 +1,2 @@",
      "-a",
      "+A",
      " b",
      "@@ -10,1 +10,2 @@",
      "+new1",
      "+new2",
    ].join("\n")
  );

  assert.deepStrictEqual(countChanges(file), { added: 3, deleted: 1 });
});
