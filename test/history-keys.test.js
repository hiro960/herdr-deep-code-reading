"use strict";

// Reaching the repository's past from the pane: the log, one file's history, one
// run of lines', and what opening a commit does to the diff on screen.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const { createState, reduce, toScreenModel } = require("../lib/app-state");

const VIEWPORT = 20;
const COLUMNS = 179;
const GIT_IDENTITY = ["-c", "user.email=test@example.com", "-c", "user.name=herdr-deep-code-reading test"];

function run(cwd, args) {
  execFileSync("git", args, { cwd, stdio: "ignore" });
}

/** Three commits, so a file's history and a line's history differ. */
function makeRepo(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "herdr-deep-code-reading-log-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  run(root, ["init", "-q"]);
  fs.mkdirSync(path.join(root, "lib"), { recursive: true });
  fs.writeFileSync(path.join(root, "lib", "a.js"), "one\ntwo\nthree\n");
  fs.writeFileSync(path.join(root, "lib", "b.js"), "untouched\n");
  run(root, ["add", "-A"]);
  run(root, [...GIT_IDENTITY, "commit", "-qm", "first commit"]);

  fs.writeFileSync(path.join(root, "lib", "a.js"), "one\nsecond version\nthree\n");
  run(root, ["add", "-A"]);
  run(root, [...GIT_IDENTITY, "commit", "-qm", "second commit"]);

  // An uncommitted change, so the working-tree diff has something in it
  fs.writeFileSync(path.join(root, "lib", "a.js"), "one\nnot committed\nthree\n");

  return root;
}

function press(state, keys) {
  return keys.reduce((current, key) => reduce(current, key, VIEWPORT), state);
}

// --- the log ------------------------------------------------------------------

test("L opens the log on the repository's commits", (t) => {
  const root = makeRepo(t);

  const listed = reduce(createState(root, "review", COLUMNS), "L", VIEWPORT);

  assert.strictEqual(listed.view, "log");
  assert.deepStrictEqual(
    listed.log.rows.filter((row) => row.commit !== null).map((row) => row.commit.subject),
    ["second commit", "first commit"]
  );
});

test("L works from every view", (t) => {
  const root = makeRepo(t);
  const browse = createState(root, "files", COLUMNS);

  for (const [label, state] of [
    ["browse", browse],
    ["read", press(browse, ["l", "l"])],
    ["diff", createState(root, "review", COLUMNS)],
  ]) {
    assert.strictEqual(reduce(state, "L", VIEWPORT).view, "log", label);
  }
});

test("L in the log is not a second log", (t) => {
  const root = makeRepo(t);
  const listed = reduce(createState(root, "review", COLUMNS), "L", VIEWPORT);

  const again = reduce(listed, "L", VIEWPORT);

  assert.strictEqual(again.history.length, listed.history.length);
});

test("every footer names it", (t) => {
  const root = makeRepo(t);
  const browse = createState(root, "files", COLUMNS);

  assert.match(toScreenModel(browse).help, /L log/);
  assert.match(toScreenModel(createState(root, "review", COLUMNS)).help, /L log/);
  assert.match(toScreenModel(press(browse, ["l", "l"])).help, /L log/);
});

test("the log's header says how much of the repository it is showing", (t) => {
  const root = makeRepo(t);

  const listed = reduce(createState(root, "review", COLUMNS), "L", VIEWPORT);

  assert.match(toScreenModel(listed).title, /log: all branches\s+\(2\)/);
});

// --- one file's history, and one run of lines' -------------------------------

test("H lists the commits that touched the open file", (t) => {
  const root = makeRepo(t);
  const reading = press(createState(root, "files", COLUMNS), ["l", "l"]);
  assert.strictEqual(reading.openPath, "lib/a.js");

  const listed = reduce(reading, "H", VIEWPORT);

  assert.match(listed.listTitle, /history: lib\/a\.js/);
  assert.strictEqual(listed.hits.length, 2);
});

test("a file nothing has happened to has a shorter history", (t) => {
  const root = makeRepo(t);
  const reading = press(createState(root, "files", COLUMNS), ["l", "j", "l"]);
  assert.strictEqual(reading.openPath, "lib/b.js");

  assert.strictEqual(reduce(reading, "H", VIEWPORT).hits.length, 1);
});

test("a marked run narrows it to the history of those lines", (t) => {
  // Which is the blame question, answered with every commit rather than the last
  const root = makeRepo(t);
  const onLineThree = press(createState(root, "files", COLUMNS), ["l", "l", "j", "j"]);
  assert.strictEqual(onLineThree.rows[onLineThree.cursor].cell.num, 3);

  const listed = press(onLineThree, ["v", "H"]);

  assert.match(listed.listTitle, /history: lib\/a\.js:3/);
  assert.deepStrictEqual(
    listed.hits.map((hit) => hit.commit.subject),
    ["first commit"]
  );
});

test("the line that has changed carries both commits", (t) => {
  const root = makeRepo(t);
  const onLineTwo = press(createState(root, "files", COLUMNS), ["l", "l", "j"]);

  const listed = press(onLineTwo, ["v", "H"]);

  assert.strictEqual(listed.hits.length, 2);
});

test("H is not bound where no file is open", (t) => {
  const root = makeRepo(t);
  const browse = createState(root, "files", COLUMNS);

  assert.strictEqual(reduce(browse, "H", VIEWPORT), browse);
});

// --- opening a commit -----------------------------------------------------------

test("Enter on a commit shows its diff in the whole pane", (t) => {
  const root = makeRepo(t);
  const listed = reduce(createState(root, "review", COLUMNS), "L", VIEWPORT);
  const newest = listed.log.rows.find((row) => row.commit !== null).commit;

  const shown = reduce(listed, "enter", VIEWPORT);

  assert.strictEqual(shown.view, "diff");
  assert.strictEqual(shown.mode, "commit");
  assert.strictEqual(shown.commit.sha, newest.sha);
  assert.strictEqual(shown.files.length, 1);
  assert.strictEqual(shown.files[0].newPath, "lib/a.js");
  assert.match(shown.title, /second commit/);
});

test("the very first commit has a diff too", (t) => {
  // It has no parent to be compared against, which plain `git diff` has nothing
  // to say about
  const root = makeRepo(t);
  const listed = reduce(createState(root, "review", COLUMNS), "L", VIEWPORT);

  const shown = press(listed, ["j", "enter"]);

  assert.match(shown.title, /first commit/);
  assert.strictEqual(shown.files.length, 2, "the root commit adds both files");
});

test("a commit's diff withholds the staging keys", (t) => {
  // `git add` has nothing to say about a commit that has already landed
  const root = makeRepo(t);
  const shown = press(createState(root, "review", COLUMNS), ["L", "enter"]);

  assert.doesNotMatch(toScreenModel(shown).help, /stage|commit message/);
  for (const key of [" ", "A", "C"]) {
    assert.strictEqual(reduce(shown, key, VIEWPORT), shown, JSON.stringify(key));
  }
});

test("a commit's files are not labelled with today's working-tree status", (t) => {
  const root = makeRepo(t);
  const shown = press(createState(root, "review", COLUMNS), ["L", "enter"]);

  assert.strictEqual(shown.files[0].gitStatus, undefined);
});

test("reloading a commit's diff rebuilds the same commit", (t) => {
  const root = makeRepo(t);
  const shown = press(createState(root, "review", COLUMNS), ["L", "enter"]);

  const again = reduce(shown, "r", VIEWPORT);

  assert.strictEqual(again.mode, "commit");
  assert.match(again.title, /second commit/);
  assert.strictEqual(again.files.length, 1);
});

// --- and back again ---------------------------------------------------------------

test("Ctrl+O brings back the diff the commit replaced", (t) => {
  const root = makeRepo(t);
  const working = createState(root, "review", COLUMNS);
  assert.strictEqual(working.mode, "review");
  assert.strictEqual(working.files.length, 1);

  const shown = press(working, ["L", "enter"]);
  const backToList = reduce(shown, "ctrl-o", VIEWPORT);
  const backToDiff = reduce(backToList, "ctrl-o", VIEWPORT);

  assert.strictEqual(backToList.view, "log", "the log is the step between");
  assert.strictEqual(backToDiff.view, "diff");
  assert.strictEqual(backToDiff.mode, "review");
  assert.strictEqual(backToDiff.commit, null);
  assert.match(backToDiff.title, /Working tree/);
});

test("the staging keys come back with the working tree", (t) => {
  const root = makeRepo(t);
  const working = createState(root, "review", COLUMNS);

  const back = press(working, ["L", "enter", "ctrl-o", "ctrl-o"]);

  assert.match(toScreenModel(back).help, /stage/);
});

test("a repository with no commits offers an empty log, not an error", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "herdr-deep-code-reading-log-empty-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  run(root, ["init", "-q"]);
  fs.writeFileSync(path.join(root, "a.js"), "one\n");

  const listed = reduce(createState(root, "review", COLUMNS), "L", VIEWPORT);

  assert.strictEqual(listed.view, "log");
  assert.deepStrictEqual(listed.log.rows, []);
});
