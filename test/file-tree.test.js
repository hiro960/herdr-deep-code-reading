"use strict";

const test = require("node:test");
const assert = require("node:assert");

const { listDirectory, parentOf } = require("../lib/file-tree");

const PATHS = [
  "README.md",
  "package.json",
  "bin/open.js",
  "bin/review.js",
  "lib/ansi.js",
  "lib/app-state.js",
  "lib/deep/nested.js",
  "test/ansi.test.js",
];

test("lists the entries at the repository root", () => {
  // Arrange / Act
  const entries = listDirectory(PATHS, "");

  // Assert
  assert.deepStrictEqual(
    entries.map((entry) => entry.name),
    ["bin", "lib", "test", "README.md", "package.json"]
  );
});

test("puts directories before files", () => {
  const entries = listDirectory(PATHS, "");
  const firstFile = entries.findIndex((entry) => !entry.isDirectory);

  assert.ok(entries.slice(0, firstFile).every((entry) => entry.isDirectory));
  assert.ok(entries.slice(firstFile).every((entry) => !entry.isDirectory));
});

test("sorts each group by name", () => {
  const entries = listDirectory(PATHS, "");
  const dirs = entries.filter((entry) => entry.isDirectory).map((entry) => entry.name);

  assert.deepStrictEqual(dirs, [...dirs].sort());
});

test("lists the entries inside a directory", () => {
  const entries = listDirectory(PATHS, "bin");

  assert.deepStrictEqual(
    entries.map((entry) => entry.name),
    ["open.js", "review.js"]
  );
});

test("collapses a nested directory into one entry", () => {
  const entries = listDirectory(PATHS, "lib");

  assert.deepStrictEqual(
    entries.map((entry) => entry.name),
    ["deep", "ansi.js", "app-state.js"]
  );
});

test("gives each entry its full repository-relative path", () => {
  const entries = listDirectory(PATHS, "lib");
  const deep = entries.find((entry) => entry.name === "deep");
  const ansi = entries.find((entry) => entry.name === "ansi.js");

  assert.strictEqual(deep.path, "lib/deep");
  assert.strictEqual(ansi.path, "lib/ansi.js");
});

test("marks directories apart from files", () => {
  const entries = listDirectory(PATHS, "lib");

  assert.strictEqual(entries.find((entry) => entry.name === "deep").isDirectory, true);
  assert.strictEqual(entries.find((entry) => entry.name === "ansi.js").isDirectory, false);
});

test("does not list a directory whose name merely shares a prefix", () => {
  // "libexec/x" must not appear under "lib"
  const entries = listDirectory([...PATHS, "libexec/tool.js"], "lib");

  assert.ok(!entries.some((entry) => entry.name === "tool.js"));
  assert.ok(!entries.some((entry) => entry.name === "libexec"));
});

test("returns an empty list for a directory with nothing in it", () => {
  assert.deepStrictEqual(listDirectory(PATHS, "missing"), []);
});

test("returns an empty list when the repository has no files", () => {
  assert.deepStrictEqual(listDirectory([], ""), []);
});

// --- moving up -----------------------------------------------------------

test("moves from a nested directory to its parent", () => {
  assert.strictEqual(parentOf("lib/deep"), "lib");
});

test("moves from a top-level directory to the root", () => {
  assert.strictEqual(parentOf("lib"), "");
});

test("stays at the root", () => {
  assert.strictEqual(parentOf(""), "");
});
