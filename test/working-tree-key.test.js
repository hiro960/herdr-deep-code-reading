"use strict";

// The key that goes back to the working tree.
//
// Every other diff the pane can show — the index, the branch, a commit — withholds the
// staging keys, and until this key there was no way out of one: `r` reloads whatever is
// already loaded, and Ctrl+O only unwinds a jump that was made. A pane opened on the
// branch diff was a pane that could not stage a file at all.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const { createState, reduce } = require("../lib/app-state");

const VIEWPORT = 20;
const COLUMNS = 179;
const WORKING_TREE_KEY = "D";
const REVIEW_TITLE = "Working tree vs HEAD";
const GIT_IDENTITY = ["-c", "user.email=test@example.com", "-c", "user.name=herdr-deep-code-reading test"];

function run(cwd, args) {
  execFileSync("git", args, { cwd, stdio: "ignore" });
}

/**
 * A repository with a default branch, a feature branch on top of it, and one file
 * changed but not staged — so that every mode has something to show and the working
 * tree has something to stage.
 */
function makeRepo(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "herdr-deep-code-reading-worktree-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  run(root, ["init", "-q"]);
  fs.mkdirSync(path.join(root, "lib"), { recursive: true });
  fs.writeFileSync(path.join(root, "lib", "a.js"), "one\ntwo\n");
  fs.writeFileSync(path.join(root, "lib", "b.js"), "three\nfour\n");
  run(root, ["add", "-A"]);
  run(root, [...GIT_IDENTITY, "commit", "-qm", "init"]);
  // Named rather than assumed: `git init` picks master or main from the user's own
  // config, and the branch mode needs one of the two to resolve.
  run(root, ["branch", "-M", "main"]);

  run(root, ["checkout", "-q", "-b", "feature"]);
  fs.writeFileSync(path.join(root, "lib", "b.js"), "three\nfour\nfive\n");
  run(root, ["add", "-A"]);
  run(root, [...GIT_IDENTITY, "commit", "-qm", "on the branch"]);

  // The uncommitted change the whole key exists to get back to
  fs.writeFileSync(path.join(root, "lib", "a.js"), "one\nchanged\n");

  return root;
}

function settled(state) {
  return state.effect === null ? state : { ...state, effect: null };
}

function press(state, keys) {
  return keys.reduce((current, key) => settled(reduce(current, key, VIEWPORT)), state);
}

/** The effect the staging key asks for, or null when it is not bound here. */
function stageEffectOf(state) {
  return reduce(state, " ", VIEWPORT).effect;
}

// --- getting there ----------------------------------------------------------

test("D turns the branch diff into the working tree's, staging keys and all", (t) => {
  const root = makeRepo(t);
  const branch = createState(root, "branch", COLUMNS);
  assert.strictEqual(branch.mode, "branch");
  assert.strictEqual(stageEffectOf(branch), null, "the branch mode withholds the staging keys");

  const home = reduce(branch, WORKING_TREE_KEY, VIEWPORT);

  assert.strictEqual(home.mode, "review");
  assert.strictEqual(home.view, "diff");
  assert.strictEqual(home.title, REVIEW_TITLE);
  assert.deepStrictEqual(
    home.files.map((file) => file.newPath),
    ["lib/a.js"],
    "the files are the working tree's, not the branch's"
  );
  assert.strictEqual(stageEffectOf(home).type, "stage");
});

test("D leaves the index's diff the same way", (t) => {
  const root = makeRepo(t);
  const staged = createState(root, "staged", COLUMNS);
  assert.strictEqual(stageEffectOf(staged), null);

  const home = reduce(staged, WORKING_TREE_KEY, VIEWPORT);

  assert.strictEqual(home.mode, "review");
  assert.strictEqual(stageEffectOf(home).type, "stage");
});

test("D reaches the working tree from the log, where no diff of it is on screen", (t) => {
  const root = makeRepo(t);
  const log = createState(root, "log", COLUMNS);
  assert.strictEqual(log.view, "log");
  assert.strictEqual(log.mode, "commit");

  const home = reduce(log, WORKING_TREE_KEY, VIEWPORT);

  assert.strictEqual(home.view, "diff");
  assert.strictEqual(home.mode, "review");
  assert.strictEqual(home.commit, null, "a commit left loaded would be what r reloads");
  assert.strictEqual(stageEffectOf(home).type, "stage");
});

test("D reaches it from a commit's diff opened in the whole pane", (t) => {
  const root = makeRepo(t);
  const commitDiff = press(createState(root, "log", COLUMNS), ["e"]);
  assert.strictEqual(commitDiff.view, "diff");
  assert.strictEqual(commitDiff.mode, "commit");

  const home = reduce(commitDiff, WORKING_TREE_KEY, VIEWPORT);

  assert.strictEqual(home.mode, "review");
  assert.strictEqual(stageEffectOf(home).type, "stage");
});

test("D reaches it from the file browser, whichever diff was behind it", (t) => {
  const root = makeRepo(t);
  const browse = press(createState(root, "branch", COLUMNS), ["e"]);
  assert.strictEqual(browse.view, "browse");
  assert.strictEqual(browse.mode, "branch");

  const home = reduce(browse, WORKING_TREE_KEY, VIEWPORT);

  assert.strictEqual(home.view, "diff");
  assert.strictEqual(home.mode, "review");
  assert.notStrictEqual(home.browse, null, "e still has a directory to go back to");
});

// --- coming back ------------------------------------------------------------

test("Ctrl+O after D gives the diff that was on screen back", (t) => {
  const root = makeRepo(t);
  const branch = createState(root, "branch", COLUMNS);

  const back = press(branch, [WORKING_TREE_KEY, "ctrl-o"]);

  assert.strictEqual(back.mode, "branch");
  assert.strictEqual(back.title, branch.title);
  assert.deepStrictEqual(
    back.files.map((file) => file.newPath),
    branch.files.map((file) => file.newPath)
  );
});

test("Ctrl+O after D from the log gives the graph back, on its commit", (t) => {
  const root = makeRepo(t);
  const log = createState(root, "log", COLUMNS);

  const back = press(log, [WORKING_TREE_KEY, "ctrl-o"]);

  assert.strictEqual(back.view, "log");
  assert.strictEqual(back.mode, "commit");
  assert.strictEqual(back.log.cursor, log.log.cursor);
});

// --- where it has nothing to do --------------------------------------------

test("D on the working tree's own diff says so and changes nothing", (t) => {
  const root = makeRepo(t);
  const review = createState(root, "review", COLUMNS);

  const same = reduce(review, WORKING_TREE_KEY, VIEWPORT);

  assert.ok(same.message !== null, "a key that refuses has to say why");
  assert.strictEqual(same.mode, "review");
  assert.strictEqual(same.files, review.files, "no second read of the same diff");
  assert.strictEqual(same.history.length, 0, "nothing to come back from");
});

test("D that git cannot answer keeps the diff that is on screen", (t) => {
  const root = makeRepo(t);
  const branch = createState(root, "branch", COLUMNS);
  // The repository read out from under the pane, which is the one way this load fails
  fs.rmSync(path.join(root, ".git"), { recursive: true, force: true });

  const refused = reduce(branch, WORKING_TREE_KEY, VIEWPORT);

  assert.match(refused.message, /working tree/i);
  assert.strictEqual(refused.mode, "branch", "a failed load must not leave half a mode");
  assert.strictEqual(refused.files, branch.files);
  assert.strictEqual(refused.history.length, 0, "nothing was jumped away from");
});
