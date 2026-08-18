"use strict";

// The order the review file list is in, and what staging does to it.
//
// Regression: untracked files were appended to whatever `git diff HEAD` reported, so a
// new file sat at the bottom until it was staged — and then it became part of the diff
// and moved into path order, which for a name early in the alphabet is the top. The
// reload follows the file by path, correctly, so the reader's selection went with it:
// `n`, space, `n`, space walked the list from the beginning again instead of forward.
//
// The list is in path order now, whatever state a file is in. Nothing a reader stages
// moves, because staging does not change a path.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const git = require("../lib/git");
const { createState, reduce } = require("../lib/app-state");
const { performEffect } = require("../lib/run/effects");

const COLUMNS = 200;
const VIEWPORT = 40;

/** A tracked change in the middle of the alphabet, with new files either side. */
function makeRepo(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "herdr-deep-code-reading-order-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: root, stdio: "ignore" });
  fs.writeFileSync(path.join(root, "middle.txt"), "one\n");
  execFileSync("git", ["add", "-A"], { cwd: root, stdio: "ignore" });
  execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "base"], {
    cwd: root,
    stdio: "ignore",
  });

  fs.writeFileSync(path.join(root, "middle.txt"), "one\ntwo\n");
  fs.writeFileSync(path.join(root, "aaa_new.txt"), "new\n");
  fs.writeFileSync(path.join(root, "zzz_new.txt"), "new\n");
  return root;
}

function press(state, key) {
  return performEffect(reduce(state, key, VIEWPORT), null);
}

function listed(state) {
  return state.files.map((file) => git.diffPath(file));
}

function selected(state) {
  return git.diffPath(state.files[state.selectedIndex]);
}

test("the list is in path order, whatever state a file is in", (t) => {
  const root = makeRepo(t);

  assert.deepStrictEqual(listed(createState(root, "review", COLUMNS)), [
    "aaa_new.txt",
    "middle.txt",
    "zzz_new.txt",
  ]);
});

test("staging a file does not move it", (t) => {
  const root = makeRepo(t);
  const state = createState(root, "review", COLUMNS);
  assert.strictEqual(selected(state), "aaa_new.txt");

  const staged = press(state, " ");

  assert.match(staged.message, /^Staged /);
  assert.deepStrictEqual(listed(staged), listed(state));
  assert.strictEqual(selected(staged), "aaa_new.txt");
});

test("space then n walks forward, staging each file once", (t) => {
  // The whole complaint: the selection used to be carried to the top by the file it
  // had just staged, so the next `n` started the list again
  const root = makeRepo(t);
  let state = createState(root, "review", COLUMNS);
  const visited = [];

  for (let step = 0; step < 3; step += 1) {
    visited.push(selected(state));
    state = press(state, " ");
    assert.match(state.message, /^Staged /, `step ${step} did not stage`);
    state = press(state, "n");
  }

  assert.deepStrictEqual(visited, ["aaa_new.txt", "middle.txt", "zzz_new.txt"]);
});

test("everything ends up staged, and nothing twice", (t) => {
  const root = makeRepo(t);
  let state = createState(root, "review", COLUMNS);
  for (let step = 0; step < 3; step += 1) {
    state = press(press(state, " "), "n");
  }

  const status = execFileSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" });

  assert.deepStrictEqual(
    status.trim().split("\n").map((line) => line.slice(0, 2)),
    ["A ", "M ", "A "]
  );
});

test("unstaging leaves a file where it was too", (t) => {
  const root = makeRepo(t);
  const staged = press(createState(root, "review", COLUMNS), " ");

  const back = press(staged, " ");

  assert.match(back.message, /^Unstaged /);
  assert.strictEqual(selected(back), "aaa_new.txt");
  assert.deepStrictEqual(listed(back), ["aaa_new.txt", "middle.txt", "zzz_new.txt"]);
});
