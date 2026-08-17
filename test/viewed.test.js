"use strict";

// Which files of a change the reader has already been through.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  STORE_FILENAME,
  digestOf,
  isViewed,
  prunedTo,
  storePath,
  toggleViewed,
  viewedCount,
} = require("../lib/viewed");
const { loadEntries, saveEntries } = require("../lib/store");
const { execFileSync } = require("node:child_process");
const { createState, reduce, toScreenModel } = require("../lib/app-state");
const { performEffect } = require("../lib/run/effects");
const { VIEWED_MARK, renderPanelRow } = require("../lib/render/panel");

const COLUMNS = 120;
const VIEWPORT = 20;
const SGR_ALL = /\u001b\[[0-9;]*m/g;

/** A file the way parseUnifiedDiff hands one over. */
function file(newPath, lines) {
  return {
    oldPath: newPath,
    newPath,
    hunks: [{ lines: (lines || [["add", "x"]]).map(([type, text]) => ({ type, text })) }],
  };
}

// --- what a mark records ---------------------------------------------------------

test("two readings of the same change agree", () => {
  assert.strictEqual(digestOf(file("a.js")), digestOf(file("a.js")));
});

test("a file whose diff changed is a different thing to read", () => {
  const before = file("a.js", [["add", "const x = 1;"]]);
  const after = file("a.js", [["add", "const x = 2;"]]);

  assert.notStrictEqual(digestOf(before), digestOf(after));
});

test("a line that changed type changed", () => {
  const added = file("a.js", [["add", "same"]]);
  const removed = file("a.js", [["del", "same"]]);

  assert.notStrictEqual(digestOf(added), digestOf(removed));
});

test("two files with the same change are still two files", () => {
  assert.notStrictEqual(digestOf(file("a.js")), digestOf(file("b.js")));
});

test("the same lines split differently are not a different change", () => {
  // A hunk boundary moves when something above it does, and the reader has not been
  // shown anything new by that
  const oneHunk = { ...file("a.js"), hunks: [{ lines: [{ type: "add", text: "x" }, { type: "add", text: "y" }] }] };
  const twoHunks = {
    ...file("a.js"),
    hunks: [{ lines: [{ type: "add", text: "x" }] }, { lines: [{ type: "add", text: "y" }] }],
  };

  assert.strictEqual(digestOf(oneHunk), digestOf(twoHunks));
});

test("a file with no hunks has a digest like any other", () => {
  assert.strictEqual(typeof digestOf({ newPath: "empty.js" }), "string");
});

// --- marking ------------------------------------------------------------------------

test("nothing is read to begin with", () => {
  assert.strictEqual(isViewed([], file("a.js")), false);
});

test("marking a file read makes it read", () => {
  const { marks, viewed } = toggleViewed([], file("a.js"));

  assert.strictEqual(viewed, true);
  assert.strictEqual(isViewed(marks, file("a.js")), true);
});

test("marking it again makes it unread", () => {
  const { marks } = toggleViewed([], file("a.js"));
  const { marks: after, viewed } = toggleViewed(marks, file("a.js"));

  assert.strictEqual(viewed, false);
  assert.deepStrictEqual(after, []);
});

test("a file that changed after it was read is unread again", () => {
  // The whole reason a mark records what was read rather than only that something was
  const { marks } = toggleViewed([], file("a.js", [["add", "const x = 1;"]]));

  assert.strictEqual(isViewed(marks, file("a.js", [["add", "const x = 2;"]])), false);
});

test("reading it again leaves one mark, not a history of them", () => {
  const first = toggleViewed([], file("a.js", [["add", "one"]])).marks;
  const second = toggleViewed(first, file("a.js", [["add", "two"]])).marks;

  assert.strictEqual(second.length, 1);
  assert.strictEqual(isViewed(second, file("a.js", [["add", "two"]])), true);
});

test("marking one file leaves the others alone", () => {
  const { marks } = toggleViewed([], file("a.js"));

  assert.strictEqual(isViewed(marks, file("b.js")), false);
});

test("the count is what the header says", () => {
  const files = [file("a.js"), file("b.js"), file("c.js")];
  const marks = toggleViewed(toggleViewed([], files[0]).marks, files[2]).marks;

  assert.strictEqual(viewedCount(marks, files), 2);
  assert.strictEqual(viewedCount([], files), 0);
});

// --- keeping the store from growing forever ------------------------------------------

test("a mark for a file the change no longer has is dropped", () => {
  // A branch reviewed and then rebased leaves marks for paths nobody will see again
  const marks = toggleViewed(toggleViewed([], file("a.js")).marks, file("gone.js")).marks;

  assert.deepStrictEqual(
    prunedTo(marks, [file("a.js")]).map((mark) => mark.path),
    ["a.js"]
  );
});

test("pruning against the same files keeps all of them", () => {
  const files = [file("a.js"), file("b.js")];
  const marks = toggleViewed(toggleViewed([], files[0]).marks, files[1]).marks;

  assert.strictEqual(prunedTo(marks, files).length, 2);
});

// --- on disk ---------------------------------------------------------------------------

test("marks survive the pane, one repository at a time", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "herdr-deep-code-reading-viewed-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const store = storePath({ HERDR_PLUGIN_STATE_DIR: directory });

  const mine = toggleViewed([], file("a.js")).marks;
  saveEntries(store, "/repo/one", mine);
  saveEntries(store, "/repo/two", toggleViewed([], file("b.js")).marks);

  assert.deepStrictEqual(loadEntries(store, "/repo/one", () => true), mine);
  assert.strictEqual(loadEntries(store, "/repo/two", () => true)[0].path, "b.js");
});

test("the store lands beside the plugin's other state", () => {
  assert.strictEqual(
    storePath({ HERDR_PLUGIN_STATE_DIR: "/state" }),
    path.join("/state", STORE_FILENAME)
  );
});

// --- pressing the key ---------------------------------------------------------------

function makeRepo(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "herdr-deep-code-reading-viewed-keys-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  execFileSync("git", ["init", "-q"], { cwd: root, stdio: "ignore" });
  for (const name of ["a.js", "b.js"]) {
    fs.writeFileSync(path.join(root, name), "const x = 1;\n");
  }
  execFileSync("git", ["add", "-A"], { cwd: root, stdio: "ignore" });
  execFileSync(
    "git",
    ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init"],
    { cwd: root, stdio: "ignore" }
  );
  for (const name of ["a.js", "b.js"]) {
    fs.writeFileSync(path.join(root, name), "const x = 2;\n");
  }

  return { root, store: path.join(root, ".viewed.json") };
}

function open(t) {
  const { root, store } = makeRepo(t);
  return { state: createState(root, "review", COLUMNS, { viewedFile: store }), root, store };
}

test("V marks the file the panel points at", (t) => {
  const { state } = open(t);

  const marked = reduce(state, "V", VIEWPORT);

  assert.strictEqual(marked.viewed.length, 1);
  assert.match(marked.message, /^Read: a\.js/);
  assert.deepStrictEqual(marked.effect, { type: "save-viewed" });
});

test("V again takes the mark away", (t) => {
  const { state } = open(t);
  const back = reduce(reduce(state, "V", VIEWPORT), "V", VIEWPORT);

  assert.deepStrictEqual(back.viewed, []);
  assert.match(back.message, /^Unread: a\.js/);
});

test("the panel says which files have been read", (t) => {
  const { state } = open(t);
  const marked = reduce(state, "V", VIEWPORT);
  const [first, second] = toScreenModel(marked).files;

  assert.strictEqual(first.viewed, true);
  assert.strictEqual(second.viewed, false);
});

test("the header says how far through the change the reader is", (t) => {
  const { state } = open(t);

  assert.match(toScreenModel(state).subtitle, /2 files/);
  assert.match(toScreenModel(reduce(state, "V", VIEWPORT)).subtitle, /1\/2 read/);
});

test("a read file shows the mark instead of its line counts", (t) => {
  const { state } = open(t);
  const [entry] = toScreenModel(reduce(state, "V", VIEWPORT)).files;
  const drawn = renderPanelRow(entry, 40, false, true).replace(SGR_ALL, "");

  assert.ok(drawn.includes(VIEWED_MARK), "the mark is not on the row");
  assert.doesNotMatch(drawn, /\+\d+ -\d+/, "the line counts are still there");
});

test("the marks reach the disk and come back on the next pane", (t) => {
  const { state, root, store } = open(t);

  const done = performEffect(reduce(state, "V", VIEWPORT), null);
  assert.strictEqual(done.effect, null);
  // The message the key set stays: the save is what the key promised, and saying so
  // twice would be noise. Only a failure has something of its own to add.
  assert.match(done.message, /^Read: /);

  const reopened = createState(root, "review", COLUMNS, { viewedFile: store });
  assert.strictEqual(toScreenModel(reopened).files[0].viewed, true);
});

test("a file edited after it was read comes back unread", (t) => {
  // The point of hashing the diff rather than listing the path
  const { state, root, store } = open(t);
  performEffect(reduce(state, "V", VIEWPORT), null);

  fs.writeFileSync(path.join(root, "a.js"), "const x = 3;\n");
  const reopened = createState(root, "review", COLUMNS, { viewedFile: store });

  assert.strictEqual(toScreenModel(reopened).files[0].viewed, false);
});
