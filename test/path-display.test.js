"use strict";

const test = require("node:test");
const assert = require("node:assert");

const { abbreviatePath } = require("../lib/path-display");
const { displayWidth } = require("../lib/text");

test("returns a path that already fits unchanged", () => {
  assert.strictEqual(abbreviatePath("lib/git.js", 20), "lib/git.js");
});

test("drops leading directories before touching the file name", () => {
  // The file name is what identifies the row, so it is the last thing to go
  const result = abbreviatePath("src/lib/deep/parser.js", 16);

  assert.ok(result.endsWith("parser.js"), `got ${result}`);
  assert.ok(displayWidth(result) <= 16);
});

test("keeps as many trailing directories as fit", () => {
  const result = abbreviatePath("a/b/c/d/file.js", 14);

  assert.strictEqual(result, "…/c/d/file.js");
});

test("keeps only the file name when nothing else fits", () => {
  const result = abbreviatePath("very/long/directory/name/file.js", 12);

  assert.strictEqual(result, "…/file.js");
});

test("elides the middle of a file name that does not fit on its own", () => {
  const result = abbreviatePath("lib/extremely-long-file-name.js", 12);

  assert.strictEqual(displayWidth(result), 12);
  assert.match(result, /…/);
  // Both ends of the name survive, which is what makes it recognisable
  assert.ok(result.startsWith("ex"));
  assert.ok(result.endsWith(".js"));
});

test("never exceeds the requested width", () => {
  const paths = [
    "lib/git.js",
    "src/lib/deep/parser.js",
    "very/long/directory/name/file.js",
    "日本語/ディレクトリ/ファイル.js",
  ];

  for (const path of paths) {
    for (const width of [8, 12, 20, 34]) {
      assert.ok(
        displayWidth(abbreviatePath(path, width)) <= width,
        `${path} at ${width} produced ${abbreviatePath(path, width)}`
      );
    }
  }
});

test("measures full-width characters by display width", () => {
  const result = abbreviatePath("日本語/ファイル.js", 12);

  assert.ok(displayWidth(result) <= 12);
});

test("handles a bare file name with no directory", () => {
  assert.strictEqual(abbreviatePath("README.md", 20), "README.md");
});

test("abbreviates both sides of a rename to their file names", () => {
  const result = abbreviatePath("old/dir/a.txt → new/dir/b.txt", 20);

  assert.ok(result.includes("→"), `got ${result}`);
  assert.ok(result.includes("b.txt"), `got ${result}`);
});

test("returns an empty string for zero width", () => {
  assert.strictEqual(abbreviatePath("lib/git.js", 0), "");
});

test("returns the input unchanged when it is empty", () => {
  assert.strictEqual(abbreviatePath("", 10), "");
});
