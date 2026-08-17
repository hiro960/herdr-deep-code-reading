"use strict";

// Nothing outside the repository may be read, however the path gets there.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { readFileLines } = require("../lib/file-view");

function makeDirs(t) {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "herdr-deep-code-reading-repo-"));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "herdr-deep-code-reading-outside-"));
  t.after(() => {
    fs.rmSync(repo, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  });

  fs.writeFileSync(path.join(outside, "secret.txt"), "SENSITIVE\n");
  fs.writeFileSync(path.join(repo, "inside.txt"), "ordinary\n");

  return { repo, outside };
}

test("reads an ordinary file inside the repository", (t) => {
  const { repo } = makeDirs(t);

  const result = readFileLines(repo, "inside.txt");

  assert.strictEqual(result.ok, true);
  assert.deepStrictEqual(result.lines, ["ordinary"]);
});

test("reads a file in a subdirectory of the repository", (t) => {
  const { repo } = makeDirs(t);
  fs.mkdirSync(path.join(repo, "lib"));
  fs.writeFileSync(path.join(repo, "lib", "a.js"), "const a = 1;\n");

  assert.strictEqual(readFileLines(repo, "lib/a.js").ok, true);
});

test("refuses a path that climbs out with ..", (t) => {
  const { repo, outside } = makeDirs(t);
  const escape = path.join("..", path.basename(outside), "secret.txt");

  const result = readFileLines(repo, escape);

  assert.strictEqual(result.ok, false);
  assert.match(result.reason, /outside the repository/);
});

test("refuses an absolute path", (t) => {
  const { repo, outside } = makeDirs(t);

  const result = readFileLines(repo, path.join(outside, "secret.txt"));

  assert.strictEqual(result.ok, false);
  assert.match(result.reason, /outside the repository/);
});

test("refuses a symlink that points outside the repository", (t) => {
  // git tracks symlinks, so one committed into a repository reaches the browser
  const { repo, outside } = makeDirs(t);
  fs.symlinkSync(path.join(outside, "secret.txt"), path.join(repo, "innocent.txt"));

  const result = readFileLines(repo, "innocent.txt");

  assert.strictEqual(result.ok, false);
  assert.match(result.reason, /outside the repository/);
});

test("refuses a symlinked directory that points outside", (t) => {
  const { repo, outside } = makeDirs(t);
  fs.symlinkSync(outside, path.join(repo, "elsewhere"));

  const result = readFileLines(repo, path.join("elsewhere", "secret.txt"));

  assert.strictEqual(result.ok, false);
  assert.match(result.reason, /outside the repository/);
});

test("allows a symlink that stays inside the repository", (t) => {
  const { repo } = makeDirs(t);
  fs.symlinkSync(path.join(repo, "inside.txt"), path.join(repo, "alias.txt"));

  const result = readFileLines(repo, "alias.txt");

  assert.strictEqual(result.ok, true);
  assert.deepStrictEqual(result.lines, ["ordinary"]);
});

test("reports a missing file without calling it an escape", (t) => {
  const { repo } = makeDirs(t);

  const result = readFileLines(repo, "gone.txt");

  assert.strictEqual(result.ok, false);
  assert.doesNotMatch(result.reason, /outside the repository/);
});

test("reports a broken symlink without throwing", (t) => {
  const { repo } = makeDirs(t);
  fs.symlinkSync(path.join(repo, "never-existed.txt"), path.join(repo, "broken.txt"));

  const result = readFileLines(repo, "broken.txt");

  assert.strictEqual(result.ok, false);
});
