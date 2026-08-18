"use strict";

// Which commits the reader has been through.
//
// lib/viewed answers this about the files of one change and has to work for its
// answer, because a working tree moves under it. A commit does not move, so a mark
// here is a sha and nothing else — and the question it answers is the one a reader
// working through somebody else's week opens with: how much of this is left.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const { createState, reduce, toScreenModel } = require("../lib/app-state");
const { performEffect } = require("../lib/run/effects");
const { renderCommitRow } = require("../lib/render/log");
const { VIEWED_MARK } = require("../lib/render/panel");
const { displayWidth } = require("../lib/text");
const {
  MAX_MARKS,
  STORE_FILENAME,
  isRead,
  loadReadCommits,
  readCount,
  saveReadCommits,
  storePath,
  toggleRead,
} = require("../lib/read-commits");

const COLUMNS = 200;
const VIEWPORT = 40;
const SGR_ALL = /\[[0-9;]*m/g;
const GIT_IDENTITY = ["-c", "user.email=t@t", "-c", "user.name=t"];

// --- the marks themselves ------------------------------------------------------------

test("a mark is a sha, because a commit is the one thing here that does not move", () => {
  const { marks, read } = toggleRead([], "abc");

  assert.deepStrictEqual(marks, [{ sha: "abc" }]);
  assert.strictEqual(read, true);
  assert.ok(isRead(marks, "abc"));
  assert.ok(!isRead(marks, "def"));
});

test("the same key takes it away again", () => {
  const once = toggleRead([], "abc").marks;

  const { marks, read } = toggleRead(once, "abc");

  assert.deepStrictEqual(marks, []);
  assert.strictEqual(read, false);
});

test("the oldest goes when the list is full", () => {
  let marks = [];
  for (let at = 0; at < MAX_MARKS + 5; at += 1) {
    marks = toggleRead(marks, `sha${at}`).marks;
  }

  assert.strictEqual(marks.length, MAX_MARKS);
  assert.ok(!isRead(marks, "sha0"), "the first one read is the first one forgotten");
  assert.ok(isRead(marks, `sha${MAX_MARKS + 4}`));
});

test("how many of the commits on screen have been read", () => {
  const rows = [
    { commit: { sha: "a" } },
    { commit: null },
    { commit: { sha: "b" } },
    { commit: { sha: "c" } },
  ];

  assert.strictEqual(readCount([{ sha: "a" }, { sha: "c" }], rows), 2);
  assert.strictEqual(readCount([{ sha: "elsewhere" }], rows), 0);
});

// --- the store -----------------------------------------------------------------------

function storeFile(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "herdr-deep-code-reading-read-store-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return path.join(dir, STORE_FILENAME);
}

test("anything that is not a mark is left out of a file somebody has edited", (t) => {
  const file = storeFile(t);
  fs.writeFileSync(file, JSON.stringify({ "/repo": [{ sha: "a" }, { sha: "" }, 7, null, {}] }));

  assert.deepStrictEqual(loadReadCommits(file, "/repo"), [{ sha: "a" }]);
});

test("one repository's marks leave every other repository's alone", (t) => {
  const file = storeFile(t);

  saveReadCommits(file, "/repo/one", [{ sha: "a" }]);
  saveReadCommits(file, "/repo/two", [{ sha: "b" }]);

  assert.deepStrictEqual(loadReadCommits(file, "/repo/one"), [{ sha: "a" }]);
  assert.deepStrictEqual(loadReadCommits(file, "/repo/two"), [{ sha: "b" }]);
});

test("the store lands beside the plugin's other state", () => {
  assert.strictEqual(
    storePath({ HERDR_PLUGIN_STATE_DIR: "/state" }),
    path.join("/state", STORE_FILENAME)
  );
});

// --- pressing the key -----------------------------------------------------------------

function makeRepo(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "herdr-deep-code-reading-read-keys-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: root, stdio: "ignore" });
  for (const subject of ["one", "two", "three"]) {
    fs.writeFileSync(path.join(root, `${subject}.txt`), `${subject}\n`);
    execFileSync("git", ["add", "-A"], { cwd: root, stdio: "ignore" });
    execFileSync("git", [...GIT_IDENTITY, "commit", "-qm", subject], { cwd: root, stdio: "ignore" });
  }

  // Outside the repository, where the reader's own store lives. Kept inside it, the
  // store is an untracked file of the repository under test — it turned up in the
  // review list, and in path order a dotfile turns up first.
  const stores = fs.mkdtempSync(path.join(os.tmpdir(), "herdr-deep-code-reading-store-"));
  t.after(() => fs.rmSync(stores, { recursive: true, force: true }));

  return { root, store: path.join(stores, "read-commits.json") };
}

function open(t) {
  const { root, store } = makeRepo(t);
  return { state: createState(root, "log", COLUMNS, { readCommitsFile: store }), root, store };
}

test("V marks the commit the graph is on", (t) => {
  const { state } = open(t);

  const marked = reduce(state, "V", VIEWPORT);

  assert.deepStrictEqual(marked.readCommits.map((mark) => mark.sha), [
    state.log.rows[state.log.cursor].commit.sha,
  ]);
  assert.match(marked.message, /^Read: /);
  assert.deepStrictEqual(marked.effect, { type: "save-read-commits" });
});

test("V again takes the mark away", (t) => {
  const { state } = open(t);

  const back = reduce(reduce(state, "V", VIEWPORT), "V", VIEWPORT);

  assert.deepStrictEqual(back.readCommits, []);
  assert.match(back.message, /^Unread: /);
});

test("it is the graph's commit whichever pane has the focus", (t) => {
  // The lower half is that commit's own diff, so there is one commit on this screen to
  // be read and it is the same one from all four panes
  const { state } = open(t);

  const marked = reduce(reduce(state, "tab", VIEWPORT), "V", VIEWPORT);

  assert.strictEqual(marked.readCommits.length, 1);
  assert.strictEqual(marked.readCommits[0].sha, state.log.rows[state.log.cursor].commit.sha);
});

test("the header says how much of what is on screen is left", (t) => {
  const { state } = open(t);

  // The count itself, not the word: the pane's own name carries a `read` of its own
  assert.doesNotMatch(toScreenModel(state).title, /\d+\/\d+ read/);
  assert.match(toScreenModel(reduce(state, "V", VIEWPORT)).title, /1\/3 read/);
});

test("the marks reach the disk and come back on the next pane", (t) => {
  const { state, root, store } = open(t);

  const done = performEffect(reduce(state, "V", VIEWPORT), null);
  assert.strictEqual(done.effect, null);
  assert.match(done.message, /^Read: /);

  const reopened = createState(root, "log", COLUMNS, { readCommitsFile: store });
  assert.strictEqual(reopened.readCommits.length, 1);
  assert.match(toScreenModel(reopened).title, /1\/3 read/);
});

test("a store that cannot be written says so and keeps the mark on screen", (t) => {
  const { state, root } = open(t);
  const marked = reduce(state, "V", VIEWPORT);

  // A directory that cannot be made, because a file of that name is already there
  const under = path.join(root, "one.txt", "read-commits.json");
  const failed = performEffect({ ...marked, readCommitsFile: under }, null);

  assert.match(failed.message, /could not be saved/i);
  assert.strictEqual(failed.readCommits.length, 1);
});

// --- how a read commit is drawn ---------------------------------------------------------

function commit(fields) {
  return {
    sha: "0123456789abcdef",
    shortSha: "0123456",
    parents: [],
    date: "2026-08-15",
    author: "A Reader",
    refs: [],
    subject: "do the thing",
    ...fields,
  };
}

function plain(text) {
  return text.replace(SGR_ALL, "");
}

test("a read commit carries the mark the file panel uses", () => {
  const read = plain(renderCommitRow(commit({}), 100, false, true));
  const unread = plain(renderCommitRow(commit({}), 100, false, false));

  assert.ok(read.includes(VIEWED_MARK), "the mark is not on the row");
  assert.ok(!unread.includes(VIEWED_MARK));
});

test("the mark costs the row none of its width", () => {
  for (const width of [1, 3, 20, 63, 80, 200]) {
    assert.strictEqual(displayWidth(plain(renderCommitRow(commit({}), width, false, true))), width);
    assert.strictEqual(displayWidth(plain(renderCommitRow(commit({}), width, true, true))), width);
  }
});
