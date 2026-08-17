"use strict";

// Tests that need a real repository. Unit tests cannot catch a wrong `git` argument,
// which is exactly how untracked directories went missing.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const git = require("../lib/git");

const GIT_IDENTITY = [
  "-c",
  "user.email=test@example.com",
  "-c",
  "user.name=herdr-deep-code-reading test",
];

function run(cwd, args) {
  execFileSync("git", args, { cwd, stdio: "ignore" });
}

/** Create a repository with one commit and a nested tree of untracked files. */
function makeRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "herdr-deep-code-reading-"));

  run(root, ["init", "-q"]);
  fs.writeFileSync(path.join(root, "tracked.txt"), "one\n");
  run(root, ["add", "tracked.txt"]);
  run(root, [...GIT_IDENTITY, "commit", "-qm", "init"]);

  fs.mkdirSync(path.join(root, "lib"), { recursive: true });
  fs.mkdirSync(path.join(root, "lib", "deep"), { recursive: true });
  fs.writeFileSync(path.join(root, "lib", "a.js"), "const a = 1;\n");
  fs.writeFileSync(path.join(root, "lib", "b.js"), "const b = 2;\n");
  fs.writeFileSync(path.join(root, "lib", "deep", "c.js"), "const c = 3;\n");
  fs.writeFileSync(path.join(root, "top.txt"), "top\n");

  return root;
}

function cleanup(root) {
  fs.rmSync(root, { recursive: true, force: true });
}

test("lists every untracked file inside an untracked directory", (t) => {
  // Regression: git collapses an untracked directory into one "lib/" entry by
  // default, which hid every file under it and could not be diffed.
  const root = makeRepo();
  t.after(() => cleanup(root));

  const paths = git.loadStatus(root).map((entry) => entry.path);

  assert.ok(paths.includes("lib/a.js"), "lib/a.js is missing");
  assert.ok(paths.includes("lib/b.js"), "lib/b.js is missing");
  assert.ok(paths.includes("lib/deep/c.js"), "a nested file is missing");
  assert.ok(!paths.includes("lib/"), "the directory itself must not be listed");
});

test("shows every untracked file in the review file list", (t) => {
  const root = makeRepo();
  t.after(() => cleanup(root));

  const { files } = git.loadDiff(root, "review");
  const paths = files.map((file) => git.diffPath(file));

  assert.ok(paths.includes("lib/a.js"));
  assert.ok(paths.includes("lib/deep/c.js"));
  assert.ok(paths.includes("top.txt"));
});

test("diffs an untracked file as an addition", (t) => {
  const root = makeRepo();
  t.after(() => cleanup(root));

  const file = git.untrackedFileDiff(root, "lib/a.js");

  assert.notStrictEqual(file, null);
  assert.strictEqual(file.isNew, true);
  assert.deepStrictEqual(
    file.hunks[0].lines.map((line) => [line.type, line.text]),
    [["add", "const a = 1;"]]
  );
});

test("marks untracked files with the ?? status", (t) => {
  const root = makeRepo();
  t.after(() => cleanup(root));

  const { files } = git.loadDiff(root, "review");
  const entry = files.find((file) => git.diffPath(file) === "lib/a.js");

  assert.strictEqual(entry.gitStatus, "??");
});

test("reports the current branch", (t) => {
  const root = makeRepo();
  t.after(() => cleanup(root));

  assert.strictEqual(typeof git.loadDiff(root, "review").branch, "string");
});

test("shows a tracked modification alongside untracked files", (t) => {
  const root = makeRepo();
  t.after(() => cleanup(root));
  fs.writeFileSync(path.join(root, "tracked.txt"), "one\ntwo\n");

  const { files } = git.loadDiff(root, "review");
  const tracked = files.find((file) => git.diffPath(file) === "tracked.txt");

  assert.notStrictEqual(tracked, undefined);
  assert.strictEqual(tracked.gitStatus, " M");
});
