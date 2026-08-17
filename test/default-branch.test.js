"use strict";

// Regression: origin/HEAD names a remote-tracking branch, and stripping "origin/"
// off it without checking produced a base ref that a single-branch clone does not
// have. Branch mode then failed at startup on a repository git could diff perfectly
// well against `origin/main`.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const git = require("../lib/git");

const GIT_IDENTITY = ["-c", "user.email=test@example.com", "-c", "user.name=herdr-deep-code-reading test"];

function run(cwd, args) {
  execFileSync("git", args, { cwd, stdio: "ignore" });
}

/** An "origin" with one commit on main, and a clone of it. */
function makeClone(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "herdr-deep-code-reading-branch-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const origin = path.join(root, "origin");
  fs.mkdirSync(origin);
  run(origin, ["init", "-q", "-b", "main"]);
  fs.writeFileSync(path.join(origin, "a.txt"), "one\n");
  run(origin, ["add", "-A"]);
  run(origin, [...GIT_IDENTITY, "commit", "-qm", "init"]);

  const clone = path.join(root, "clone");
  run(root, ["clone", "-q", origin, clone]);
  run(clone, ["remote", "set-head", "origin", "main"]);

  return clone;
}

test("prefers the local branch origin/HEAD points at", (t) => {
  const clone = makeClone(t);

  assert.strictEqual(git.resolveDefaultBranch(clone), "main");
});

test("falls back to the remote-tracking ref when no local branch matches", (t) => {
  const clone = makeClone(t);
  // A detached checkout with the local branch gone still has origin/main
  run(clone, ["checkout", "-q", "--detach", "HEAD"]);
  run(clone, ["branch", "-q", "-D", "main"]);

  assert.strictEqual(git.resolveDefaultBranch(clone), "origin/main");
});

test("diffs a whole branch against a base with no local branch", (t) => {
  const clone = makeClone(t);
  run(clone, ["checkout", "-q", "--detach", "HEAD"]);
  run(clone, ["branch", "-q", "-D", "main"]);
  fs.writeFileSync(path.join(clone, "a.txt"), "one\ntwo\n");
  run(clone, ["add", "-A"]);
  run(clone, [...GIT_IDENTITY, "commit", "-qm", "second"]);

  const { files } = git.loadDiff(clone, "branch");

  assert.deepStrictEqual(
    files.map((file) => file.newPath),
    ["a.txt"]
  );
});
