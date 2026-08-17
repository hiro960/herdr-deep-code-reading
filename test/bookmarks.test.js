"use strict";

// Places worth coming back to after the pane has closed.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  MAX_BOOKMARKS,
  STORE_FILENAME,
  bookmarkLine,
  loadBookmarks,
  saveBookmarks,
  storePath,
  toggleBookmark,
} = require("../lib/bookmarks");

function tempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "herdr-deep-code-reading-marks-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function place(filePath, line, text) {
  return { path: filePath, line, text };
}

// --- where the store lives ---------------------------------------------------

test("the store sits in the plugin's own state directory", () => {
  assert.strictEqual(
    storePath({ HERDR_PLUGIN_STATE_DIR: "/state" }),
    path.join("/state", STORE_FILENAME)
  );
});

test("falls back to a directory of the plugin's own when the pane was given none", () => {
  // Not the temporary directory itself: it is shared with every other account on a
  // Linux host, and a bookmark names a path inside the reader's repository —
  // see test/state-dir.test.js
  const fallback = storePath({});

  assert.strictEqual(path.basename(fallback), STORE_FILENAME);
  assert.strictEqual(path.dirname(path.dirname(fallback)), os.tmpdir());
});

// --- reading and writing ------------------------------------------------------

test("a repository with no store yet has no bookmarks", (t) => {
  const file = path.join(tempDir(t), STORE_FILENAME);

  assert.deepStrictEqual(loadBookmarks(file, "/repo"), []);
});

test("what was saved is what comes back", (t) => {
  const file = path.join(tempDir(t), STORE_FILENAME);
  const saved = [place("lib/a.js", 12, "const x = 1;")];

  assert.deepStrictEqual(saveBookmarks(file, "/repo", saved), { ok: true });
  assert.deepStrictEqual(loadBookmarks(file, "/repo"), saved);
});

test("one repository's bookmarks are not another's", (t) => {
  const file = path.join(tempDir(t), STORE_FILENAME);
  saveBookmarks(file, "/one", [place("a.js", 1, "one")]);
  saveBookmarks(file, "/two", [place("b.js", 2, "two")]);

  assert.deepStrictEqual(loadBookmarks(file, "/one"), [place("a.js", 1, "one")]);
  assert.deepStrictEqual(loadBookmarks(file, "/two"), [place("b.js", 2, "two")]);
});

test("saving one repository leaves the others in the file", (t) => {
  // Two panes on two repositories share the store, and the second must not wipe
  // out what the first wrote
  const file = path.join(tempDir(t), STORE_FILENAME);
  saveBookmarks(file, "/one", [place("a.js", 1, "one")]);

  saveBookmarks(file, "/two", []);

  assert.strictEqual(loadBookmarks(file, "/one").length, 1);
});

test("a corrupt store reads as empty rather than throwing", (t) => {
  const file = path.join(tempDir(t), STORE_FILENAME);
  fs.writeFileSync(file, "{not json at all");

  assert.deepStrictEqual(loadBookmarks(file, "/repo"), []);
});

test("a corrupt store is replaced rather than refusing the save", (t) => {
  const file = path.join(tempDir(t), STORE_FILENAME);
  fs.writeFileSync(file, "{not json at all");

  assert.deepStrictEqual(saveBookmarks(file, "/repo", [place("a.js", 1, "x")]), { ok: true });
  assert.strictEqual(loadBookmarks(file, "/repo").length, 1);
});

test("an entry that is not a bookmark is left out", (t) => {
  // The file is plain JSON on disk and may have been edited by hand
  const file = path.join(tempDir(t), STORE_FILENAME);
  fs.writeFileSync(
    file,
    JSON.stringify({
      "/repo": [
        place("ok.js", 1, "kept"),
        { path: "no-line.js" },
        { path: "bad-line.js", line: 0, text: "" },
        { line: 3, text: "no path" },
        null,
        "not an object",
      ],
    })
  );

  assert.deepStrictEqual(loadBookmarks(file, "/repo"), [place("ok.js", 1, "kept")]);
});

test("a directory that does not exist yet is created for the store", (t) => {
  const file = path.join(tempDir(t), "nested", "deeper", STORE_FILENAME);

  assert.deepStrictEqual(saveBookmarks(file, "/repo", [place("a.js", 1, "x")]), { ok: true });
  assert.strictEqual(loadBookmarks(file, "/repo").length, 1);
});

// --- adding and removing ------------------------------------------------------

test("a place that is not saved yet is added", () => {
  const { bookmarks, added } = toggleBookmark([], place("a.js", 5, "line"));

  assert.strictEqual(added, true);
  assert.deepStrictEqual(bookmarks, [place("a.js", 5, "line")]);
});

test("the same place again takes it away", () => {
  const saved = [place("a.js", 5, "line")];

  const { bookmarks, added } = toggleBookmark(saved, place("a.js", 5, "line"));

  assert.strictEqual(added, false);
  assert.deepStrictEqual(bookmarks, []);
});

test("the same line of another file is another place", () => {
  const saved = [place("a.js", 5, "line")];

  assert.strictEqual(toggleBookmark(saved, place("b.js", 5, "line")).bookmarks.length, 2);
});

test("nothing is mutated", () => {
  const saved = [place("a.js", 5, "line")];

  toggleBookmark(saved, place("b.js", 1, "other"));

  assert.deepStrictEqual(saved, [place("a.js", 5, "line")]);
});

test("the oldest goes when the list is full", () => {
  const full = Array.from({ length: MAX_BOOKMARKS }, (_, index) =>
    place("a.js", index + 1, `line ${index}`)
  );

  const { bookmarks } = toggleBookmark(full, place("b.js", 1, "newest"));

  assert.strictEqual(bookmarks.length, MAX_BOOKMARKS);
  assert.deepStrictEqual(bookmarks[bookmarks.length - 1], place("b.js", 1, "newest"));
  assert.strictEqual(bookmarks[0].text, "line 1", "the oldest was not the one dropped");
});

// --- following one into a file that has moved on ------------------------------

test("an untouched file answers with the line that was saved", () => {
  const lines = ["one", "two", "three"];

  assert.strictEqual(bookmarkLine(place("a.js", 2, "two"), lines), 2);
});

test("a line pushed down by an edit above it is followed", () => {
  // The whole point of anchoring by text: a header added at the top must not send
  // the reader to whatever now sits at the old number
  const lines = ["new header", "", "one", "two", "three"];

  assert.strictEqual(bookmarkLine(place("a.js", 2, "two"), lines), 4);
});

test("of two lines that read the same, the nearer one wins", () => {
  const lines = ["dup", "a", "b", "c", "dup", "d"];

  assert.strictEqual(bookmarkLine(place("a.js", 4, "dup"), lines), 5);
  assert.strictEqual(bookmarkLine(place("a.js", 2, "dup"), lines), 1);
});

test("a line that is gone keeps its number, inside the file", () => {
  const lines = ["one", "two"];

  assert.strictEqual(bookmarkLine(place("a.js", 2, "deleted"), lines), 2);
  assert.strictEqual(bookmarkLine(place("a.js", 40, "deleted"), lines), 2);
});

test("an emptied file answers with its first line", () => {
  assert.strictEqual(bookmarkLine(place("a.js", 9, "gone"), []), 1);
});
