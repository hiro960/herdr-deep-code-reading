"use strict";

// Listing a directory git knows nothing about.
//
// The browser, the quick find and the tree are all built from one flat list of paths
// relative to the root. git hands that list over for a repository — `ls-files` already
// leaves out `.git` and everything `.gitignore` names. A plain directory has nobody to
// ask, so it is walked, under rules a reader can hold in their head: `.git` is never
// source, a directory symlink is not followed, and a walk that would never end is
// stopped and says so.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { MAX_WALKED_FILES, walkFiles } = require("../lib/walk");

/** A directory tree from a map of relative path to contents. */
function makeTree(t, files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "herdr-deep-code-reading-walk-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  for (const [name, body] of Object.entries(files)) {
    const full = path.join(root, name);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, body);
  }
  return root;
}

test("lists every file, relative to the root, in one flat sorted list", (t) => {
  const root = makeTree(t, { "b.js": "", "a.js": "", "lib/deep/c.js": "", "lib/a.js": "" });

  assert.deepStrictEqual(walkFiles(root).paths, ["a.js", "b.js", "lib/a.js", "lib/deep/c.js"]);
});

test("a directory with nothing in it is not a path", (t) => {
  const root = makeTree(t, { "a.js": "" });
  fs.mkdirSync(path.join(root, "empty"));

  assert.deepStrictEqual(walkFiles(root).paths, ["a.js"]);
});

test("dotfiles are files like any other", (t) => {
  // The browser lists `.github/` and `.gitignore` in a repository, and a directory
  // without one is not a different place
  const root = makeTree(t, { ".gitignore": "", ".github/workflows/test.yml": "" });

  assert.deepStrictEqual(walkFiles(root).paths, [".github/workflows/test.yml", ".gitignore"]);
});

test("`.git` is never source, at any depth", (t) => {
  const root = makeTree(t, {
    "a.js": "",
    ".git/config": "",
    ".git/objects/ab/cdef": "",
    "vendor/thing/.git/config": "",
    "vendor/thing/b.js": "",
  });

  assert.deepStrictEqual(walkFiles(root).paths, ["a.js", "vendor/thing/b.js"]);
});

test("a symlink to a directory is not followed", (t) => {
  // A walk that follows one either loops for ever or leaves the root without saying so
  const root = makeTree(t, { "a.js": "", "lib/b.js": "" });
  fs.symlinkSync(root, path.join(root, "loop"));
  fs.symlinkSync(path.join(root, "lib"), path.join(root, "elsewhere"));

  assert.deepStrictEqual(walkFiles(root).paths, ["a.js", "lib/b.js"]);
});

test("a symlink to a file is listed, because it reads as one", (t) => {
  const root = makeTree(t, { "a.js": "const a = 1;\n" });
  fs.symlinkSync(path.join(root, "a.js"), path.join(root, "b.js"));

  assert.deepStrictEqual(walkFiles(root).paths, ["a.js", "b.js"]);
});

test("a directory too big to list is cut, and says so", (t) => {
  const files = {};
  for (let at = 0; at < MAX_WALKED_FILES + 10; at += 1) {
    files[`f${String(at).padStart(6, "0")}.txt`] = "";
  }
  const root = makeTree(t, files);

  const walked = walkFiles(root);

  assert.strictEqual(walked.paths.length, MAX_WALKED_FILES);
  assert.strictEqual(walked.truncated, true);
});

test("a directory that fits is not said to be cut", (t) => {
  assert.strictEqual(walkFiles(makeTree(t, { "a.js": "" })).truncated, false);
});

test("a directory that cannot be read is an empty listing rather than a throw", () => {
  const walked = walkFiles(path.join(os.tmpdir(), "herdr-deep-code-reading-no-such-directory"));

  assert.deepStrictEqual(walked.paths, []);
  assert.strictEqual(walked.truncated, false);
});
