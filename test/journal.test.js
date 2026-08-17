"use strict";

// Where the reading has been.
//
// ../lib/jump-history is the other half of this and answers a different question:
// where was I a moment ago. It is a stack, it empties as it is walked back, and it
// dies with the pane. This is the record of what was opened and in what order, kept
// so that tomorrow can be told what yesterday read.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const { createState, reduce, toScreenModel } = require("../lib/app-state");
const { persistJournal } = require("../lib/run/effects");
const {
  MAX_ENTRIES,
  STORE_FILENAME,
  appendEntry,
  loadJournal,
  saveJournal,
  storePath,
} = require("../lib/journal");

const COLUMNS = 120;
const VIEWPORT = 20;
const GIT_IDENTITY = ["-c", "user.email=t@t", "-c", "user.name=t"];

function makeRepo(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "herdr-deep-code-reading-journal-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: root, stdio: "ignore" });
  fs.writeFileSync(path.join(root, "a.js"), "const helper = 1;\nconst other = 2;\n");
  execFileSync("git", ["add", "-A"], { cwd: root, stdio: "ignore" });
  execFileSync("git", [...GIT_IDENTITY, "commit", "-qm", "first"], { cwd: root, stdio: "ignore" });

  fs.writeFileSync(path.join(root, "b.js"), "const second = helper;\n");
  execFileSync("git", ["add", "-A"], { cwd: root, stdio: "ignore" });
  execFileSync("git", [...GIT_IDENTITY, "commit", "-qm", "second"], { cwd: root, stdio: "ignore" });

  const state = fs.mkdtempSync(path.join(os.tmpdir(), "herdr-deep-code-reading-journal-store-"));
  t.after(() => fs.rmSync(state, { recursive: true, force: true }));

  return { root, store: path.join(state, STORE_FILENAME) };
}

function press(state, keys) {
  return keys.reduce((current, key) => reduce(current, key, VIEWPORT), state);
}

function open(t, mode) {
  const { root, store } = makeRepo(t);
  return { state: createState(root, mode || "files", COLUMNS, { journalFile: store }), root, store };
}

// --- the entries themselves -----------------------------------------------------------

test("an entry is what was opened, and what kind of thing it is", () => {
  const entries = appendEntry([], { kind: "file", path: "a.js" });

  assert.deepStrictEqual(entries, [{ kind: "file", path: "a.js" }]);
});

test("the same place twice in a row is one entry", () => {
  // `l` then `h` then `l` in the browser is one file read, not two
  const once = appendEntry([], { kind: "file", path: "a.js" });

  assert.strictEqual(appendEntry(once, { kind: "file", path: "a.js" }).length, 1);
});

test("the same place come back to later is worth recording again", () => {
  const there = appendEntry(appendEntry([], { kind: "file", path: "a.js" }), {
    kind: "file",
    path: "b.js",
  });

  assert.strictEqual(appendEntry(there, { kind: "file", path: "a.js" }).length, 3);
});

test("a commit and a file of the same name are not the same entry", () => {
  const entries = appendEntry(appendEntry([], { kind: "file", path: "a" }), {
    kind: "commit",
    sha: "a",
  });

  assert.strictEqual(entries.length, 2);
});

test("the oldest goes when the record is full", () => {
  let entries = [];
  for (let at = 0; at < MAX_ENTRIES + 5; at += 1) {
    entries = appendEntry(entries, { kind: "file", path: `f${at}.js` });
  }

  assert.strictEqual(entries.length, MAX_ENTRIES);
  assert.strictEqual(entries[0].path, "f5.js");
});

// --- the store --------------------------------------------------------------------------

test("anything that is not an entry is left out of a file somebody has edited", (t) => {
  const { root, store } = makeRepo(t);
  fs.writeFileSync(
    store,
    JSON.stringify({ [root]: [{ kind: "file", path: "a.js" }, { kind: "nonsense" }, 7, null] })
  );

  assert.deepStrictEqual(loadJournal(store, root), [{ kind: "file", path: "a.js" }]);
});

test("one repository's reading is not another's", (t) => {
  const { store } = makeRepo(t);

  saveJournal(store, "/repo/one", [{ kind: "file", path: "a.js" }]);
  saveJournal(store, "/repo/two", [{ kind: "file", path: "b.js" }]);

  assert.deepStrictEqual(loadJournal(store, "/repo/one"), [{ kind: "file", path: "a.js" }]);
});

test("the store lands beside the plugin's other state", () => {
  assert.strictEqual(
    storePath({ HERDR_PLUGIN_STATE_DIR: "/state" }),
    path.join("/state", STORE_FILENAME)
  );
});

// --- what gets recorded -------------------------------------------------------------------

test("opening a file from the browser is remembered", (t) => {
  const { state } = open(t);

  const opened = press(state, ["l"]);

  assert.strictEqual(opened.openPath, "a.js");
  assert.deepStrictEqual(opened.journal, [{ kind: "file", path: "a.js" }]);
  assert.deepStrictEqual(opened.effect, { type: "save-journal" });
});

test("opening a commit from the log is remembered", (t) => {
  const { state } = open(t, "log");

  const opened = reduce(state, "enter", VIEWPORT);

  assert.strictEqual(opened.journal.length, 1);
  assert.strictEqual(opened.journal[0].kind, "commit");
  assert.strictEqual(opened.journal[0].subject, "second");
});

test("stepping the graph is not opening anything", (t) => {
  // Moving loads the commit under the cursor, and ten steps down a graph is not ten
  // things read
  const { state } = open(t, "log");

  const moved = press(state, ["j", "j"]);

  assert.deepStrictEqual(moved.journal, []);
});

test("following a name to its definition is not recorded", (t) => {
  // The decision the reader made was to look at one thing, not to read a file. A
  // journal of every jump is a journal nobody reads back.
  const { state } = open(t);
  const reading = press(state, ["j", "l"]);
  assert.strictEqual(reading.openPath, "b.js");

  const jumped = press(reading, ["w", "w", "w", "enter"]);

  assert.strictEqual(jumped.journal.length, 1, "only the file that was opened");
});

test("opening a file by path is remembered", (t) => {
  // Regression: `P` is the fastest way to say "read this file", and it was the one way
  // in that left no trace — a session read entirely through it wrote out with no files
  // on it at all
  const { state } = open(t);

  const opened = press(state, ["P", "b", ".", "j", "s", "enter"]);

  assert.strictEqual(opened.openPath, "b.js");
  assert.deepStrictEqual(opened.journal, [{ kind: "file", path: "b.js" }]);
});

test("finding a definition by name is not opening a file", (t) => {
  // `@name` is following a name, which the record deliberately leaves out
  const { state } = open(t);

  const found = press(state, ["P", "@", "h", "e", "l", "p", "e", "r", "enter"]);

  assert.strictEqual(found.openPath, "a.js");
  assert.deepStrictEqual(found.journal, []);
});

// --- reading it back ------------------------------------------------------------------------

test("J lists where the reading has been", (t) => {
  const { state } = open(t);
  const read = press(state, ["l", "escape", "j", "l"]);

  const listed = reduce(read, "J", VIEWPORT);

  assert.match(toScreenModel(listed).title, /reading/);
  assert.deepStrictEqual(
    listed.hits.map((hit) => hit.path),
    ["a.js", "b.js"]
  );
});

test("Enter goes back to a place it lists", (t) => {
  const { state } = open(t);
  const read = press(state, ["l", "escape", "j", "l"]);

  const there = press(read, ["J", "enter"]);

  assert.strictEqual(there.openPath, "a.js");
});

test("nothing read yet is said rather than shown as an empty list", (t) => {
  const { state } = open(t);

  const nothing = reduce(state, "J", VIEWPORT);

  assert.strictEqual(nothing.view, state.view);
  assert.match(nothing.message, /nothing/i);
});

// --- reaching the disk -----------------------------------------------------------------------

test("an entry is stamped with when it happened, on the way to disk", (t) => {
  const { state, root, store } = open(t);
  const opened = press(state, ["l"]);

  const done = persistJournal(opened, () => 1234);

  assert.strictEqual(done.effect, null);
  assert.strictEqual(done.journal[0].at, 1234);
  assert.deepStrictEqual(loadJournal(store, root), [{ kind: "file", path: "a.js", at: 1234 }]);
});

test("an entry already stamped keeps the time it happened", (t) => {
  const { state } = open(t);
  const opened = press(state, ["l"]);

  const twice = persistJournal(persistJournal(opened, () => 1), () => 2);

  assert.strictEqual(twice.journal[0].at, 1);
});

test("it comes back on the next pane", (t) => {
  const { state, root, store } = open(t);
  persistJournal(press(state, ["l"]), () => 1234);

  const reopened = createState(root, "files", COLUMNS, { journalFile: store });

  assert.strictEqual(reopened.journal.length, 1);
});

test("a store that cannot be written says so and keeps the record on screen", (t) => {
  const { state, root } = open(t);
  const opened = press(state, ["l"]);

  const failed = persistJournal({ ...opened, journalFile: path.join(root, "a.js", "j.json") });

  assert.match(failed.message, /could not be saved/i);
  assert.strictEqual(failed.journal.length, 1);
});
