"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { MAX_FILE_BYTES, buildContentRows, readFileLines } = require("../lib/file-view");

function withTempFile(t, name, contents) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "herdr-deep-code-reading-view-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, name);
  fs.writeFileSync(file, contents);
  return { dir, file };
}

// --- reading -------------------------------------------------------------

test("reads a text file into its lines", (t) => {
  const { dir } = withTempFile(t, "a.txt", "one\ntwo\nthree\n");

  const result = readFileLines(dir, "a.txt");

  assert.strictEqual(result.ok, true);
  assert.deepStrictEqual(result.lines, ["one", "two", "three"]);
});

test("keeps a file with no trailing newline intact", (t) => {
  const { dir } = withTempFile(t, "a.txt", "one\ntwo");

  assert.deepStrictEqual(readFileLines(dir, "a.txt").lines, ["one", "two"]);
});

test("reads an empty file as no lines", (t) => {
  const { dir } = withTempFile(t, "empty.txt", "");

  const result = readFileLines(dir, "empty.txt");

  assert.strictEqual(result.ok, true);
  assert.deepStrictEqual(result.lines, []);
});

test("handles CRLF line endings", (t) => {
  const { dir } = withTempFile(t, "a.txt", "one\r\ntwo\r\n");

  assert.deepStrictEqual(readFileLines(dir, "a.txt").lines, ["one", "two"]);
});

test("refuses a binary file", (t) => {
  // A NUL byte near the start is the usual signal
  const { dir } = withTempFile(t, "b.bin", Buffer.from([0x41, 0x00, 0x42, 0x43]));

  const result = readFileLines(dir, "b.bin");

  assert.strictEqual(result.ok, false);
  assert.match(result.reason, /[Bb]inary/);
});

test("refuses a file above the size limit", (t) => {
  const { dir } = withTempFile(t, "big.txt", "x".repeat(MAX_FILE_BYTES + 1));

  const result = readFileLines(dir, "big.txt");

  assert.strictEqual(result.ok, false);
  assert.match(result.reason, /too large/i);
});

test("reports a missing file rather than throwing", (t) => {
  const { dir } = withTempFile(t, "a.txt", "x\n");

  const result = readFileLines(dir, "gone.txt");

  assert.strictEqual(result.ok, false);
  assert.ok(result.reason.length > 0);
});

test("refuses a directory", (t) => {
  const { dir } = withTempFile(t, "a.txt", "x\n");
  fs.mkdirSync(path.join(dir, "sub"));

  assert.strictEqual(readFileLines(dir, "sub").ok, false);
});

// --- display rows --------------------------------------------------------

test("numbers each line from one", () => {
  const rows = buildContentRows({ ok: true, lines: ["a", "b"] });

  assert.deepStrictEqual(
    rows.map((row) => [row.cell.num, row.cell.text]),
    [
      [1, "a"],
      [2, "b"],
    ]
  );
});

test("marks every line as context so it renders without diff colours", () => {
  const rows = buildContentRows({ ok: true, lines: ["a"] });

  assert.strictEqual(rows[0].kind, "line");
  assert.strictEqual(rows[0].cell.type, "context");
});

test("shows a note instead of content when the file cannot be read", () => {
  const rows = buildContentRows({ ok: false, reason: "binary file" });

  assert.deepStrictEqual(rows, [{ kind: "note", text: "binary file" }]);
});

test("shows a note for an empty file", () => {
  const rows = buildContentRows({ ok: true, lines: [] });

  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].kind, "note");
});
