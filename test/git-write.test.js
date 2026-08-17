"use strict";

// Repository-changing operations, exercised against real repositories.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const gitWrite = require("../lib/git-write");

const GIT_IDENTITY = [
  "-c",
  "user.email=test@example.com",
  "-c",
  "user.name=herdr-deep-code-reading test",
];

function makeRepo({ withCommit } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "herdr-deep-code-reading-write-"));
  execFileSync("git", ["init", "-q"], { cwd: root, stdio: "ignore" });
  execFileSync("git", ["config", "commit.gpgsign", "false"], { cwd: root, stdio: "ignore" });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: root, stdio: "ignore" });
  execFileSync("git", ["config", "user.name", "herdr-deep-code-reading test"], { cwd: root, stdio: "ignore" });

  if (withCommit) {
    fs.writeFileSync(path.join(root, "base.txt"), "base\n");
    execFileSync("git", ["add", "base.txt"], { cwd: root, stdio: "ignore" });
    execFileSync("git", [...GIT_IDENTITY, "commit", "-qm", "init"], { cwd: root, stdio: "ignore" });
  }

  return root;
}

function cleanup(root) {
  fs.rmSync(root, { recursive: true, force: true });
}

// --- staging -------------------------------------------------------------

test("stages a single path", (t) => {
  const root = makeRepo();
  t.after(() => cleanup(root));
  fs.writeFileSync(path.join(root, "a.txt"), "a\n");

  assert.strictEqual(gitWrite.stagePath(root, "a.txt").ok, true);
  assert.strictEqual(gitWrite.hasStagedChanges(root).staged, true);
});

test("stages several paths in one call so a rename is not half staged", (t) => {
  // Arrange: a rename leaves the old path deleted and the new path untracked
  const root = makeRepo({ withCommit: true });
  t.after(() => cleanup(root));
  fs.renameSync(path.join(root, "base.txt"), path.join(root, "renamed.txt"));

  // Act
  const result = gitWrite.stagePath(root, ["renamed.txt", "base.txt"]);

  // Assert: git sees a rename rather than an unstaged deletion
  assert.strictEqual(result.ok, true);
  const status = execFileSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" });
  assert.match(status, /^R/m, `unexpected status: ${status}`);
});

test("unstages a path after the first commit", (t) => {
  const root = makeRepo({ withCommit: true });
  t.after(() => cleanup(root));
  fs.writeFileSync(path.join(root, "base.txt"), "changed\n");
  gitWrite.stagePath(root, "base.txt");

  assert.strictEqual(gitWrite.unstagePath(root, "base.txt").ok, true);
  assert.strictEqual(gitWrite.hasStagedChanges(root).staged, false);
});

test("unstages a path in a repository with no commits", (t) => {
  // `git restore --staged` needs a HEAD that does not exist yet
  const root = makeRepo();
  t.after(() => cleanup(root));
  fs.writeFileSync(path.join(root, "a.txt"), "a\n");
  gitWrite.stagePath(root, "a.txt");

  assert.strictEqual(gitWrite.unstagePath(root, "a.txt").ok, true);
  assert.strictEqual(gitWrite.hasStagedChanges(root).staged, false);
});

// --- staged detection ----------------------------------------------------

test("reports nothing staged in a clean repository", (t) => {
  const root = makeRepo({ withCommit: true });
  t.after(() => cleanup(root));

  assert.deepStrictEqual(gitWrite.hasStagedChanges(root), {
    ok: true,
    staged: false,
    error: null,
  });
});

test("reports an error rather than an empty index outside a repository", (t) => {
  // Silently answering "nothing staged" would hide the real failure
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "herdr-deep-code-reading-none-"));
  t.after(() => cleanup(outside));

  const result = gitWrite.hasStagedChanges(outside);

  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.staged, false);
  assert.ok(result.error);
});

// --- committing ----------------------------------------------------------

test("commits what is staged", (t) => {
  const root = makeRepo();
  t.after(() => cleanup(root));
  fs.writeFileSync(path.join(root, "a.txt"), "a\n");
  gitWrite.stagePath(root, "a.txt");

  assert.strictEqual(gitWrite.commit(root, "feat: first").ok, true);
  const log = execFileSync("git", ["log", "--oneline"], { cwd: root, encoding: "utf8" });
  assert.match(log, /feat: first/);
});

test("reports git's own error when a commit is refused", (t) => {
  const root = makeRepo({ withCommit: true });
  t.after(() => cleanup(root));

  const result = gitWrite.commit(root, "nothing to do");

  assert.strictEqual(result.ok, false);
  assert.ok(result.error.length > 0);
});

test("does not hang when a hook reads stdin", (t) => {
  // The pane is in raw mode; a hook inheriting stdin would swallow every keypress
  const root = makeRepo();
  t.after(() => cleanup(root));

  const hooks = path.join(root, ".git", "hooks");
  fs.mkdirSync(hooks, { recursive: true });
  const hook = path.join(hooks, "pre-commit");
  fs.writeFileSync(hook, "#!/bin/sh\nread answer\nexit 0\n");
  fs.chmodSync(hook, 0o755);

  fs.writeFileSync(path.join(root, "a.txt"), "a\n");
  gitWrite.stagePath(root, "a.txt");

  const result = gitWrite.commit(root, "feat: with hook");

  // Either outcome is fine; hanging is not
  assert.strictEqual(typeof result.ok, "boolean");
});

test("commits a message that begins with a dash", (t) => {
  const root = makeRepo();
  t.after(() => cleanup(root));
  fs.writeFileSync(path.join(root, "a.txt"), "a\n");
  gitWrite.stagePath(root, "a.txt");

  assert.strictEqual(gitWrite.commit(root, "--not-an-option").ok, true);
});
