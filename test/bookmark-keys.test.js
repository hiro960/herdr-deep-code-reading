"use strict";

// Saving a place and coming back to it, from the keys down to the file on disk.
//
// lib/bookmarks is tested on its own in test/bookmarks.test.js. This is the pane:
// which key saves, which key goes, and what survives the pane closing.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const { createState, reduce, toScreenModel } = require("../lib/app-state");
const { loadBookmarks, STORE_FILENAME } = require("../lib/bookmarks");
const { applyKey } = require("../bin/review.js");

const VIEWPORT = 20;
const COLUMNS = 179;
const GIT_IDENTITY = ["-c", "user.email=test@example.com", "-c", "user.name=herdr-deep-code-reading test"];

function run(cwd, args) {
  execFileSync("git", args, { cwd, stdio: "ignore" });
}

/** A repository, and a bookmark store of its own well away from the reader's. */
function makeRepo(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "herdr-deep-code-reading-marks-ui-"));
  const store = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "herdr-deep-code-reading-store-")), STORE_FILENAME);
  t.after(() => {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(path.dirname(store), { recursive: true, force: true });
  });

  run(root, ["init", "-q"]);
  fs.mkdirSync(path.join(root, "lib"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "lib", "a.js"),
    Array.from({ length: 20 }, (_, line) => `const line${line} = ${line};`).join("\n") + "\n"
  );
  run(root, ["add", "-A"]);
  run(root, [...GIT_IDENTITY, "commit", "-qm", "init"]);

  return { root, store };
}

function open(repo, mode) {
  return createState(repo.root, mode || "files", COLUMNS, { bookmarksFile: repo.store });
}

function press(state, keys) {
  return keys.reduce((current, key) => reduce(current, key, VIEWPORT), state);
}

/** Press keys through the pane, so the effects a key raises are actually performed. */
function pressLive(state, keys) {
  return keys.reduce((current, key) => applyKey(current, key, null, VIEWPORT), state);
}

/** lib/a.js open in the reading view, cursor on line 5. */
function readingAtLine5(repo) {
  const state = press(open(repo), ["l", "l", "j", "j", "j", "j"]);
  assert.strictEqual(state.view, "read");
  assert.strictEqual(state.rows[state.cursor].cell.num, 5);
  return state;
}

// --- saving -----------------------------------------------------------------

test("m saves the line under the cursor", (t) => {
  const repo = makeRepo(t);

  const marked = reduce(readingAtLine5(repo), "m", VIEWPORT);

  assert.deepStrictEqual(marked.bookmarks, [
    { path: "lib/a.js", line: 5, text: "const line4 = 4;" },
  ]);
  assert.deepStrictEqual(marked.effect, { type: "save-bookmarks" });
  assert.match(marked.message, /Bookmarked lib\/a\.js:5/);
});

test("m again on the same line takes it away", (t) => {
  const repo = makeRepo(t);

  const twice = press(readingAtLine5(repo), ["m", "m"]);

  assert.deepStrictEqual(twice.bookmarks, []);
  assert.match(twice.message, /Unbookmarked lib\/a\.js:5/);
});

test("the reading view's footer offers both keys", (t) => {
  const repo = makeRepo(t);
  const help = toScreenModel(readingAtLine5(repo)).help;

  assert.match(help, /m bookmark/);
  assert.match(help, /' marks/);
});

test("m is not bound where there is no line to save", (t) => {
  const repo = makeRepo(t);
  const browse = open(repo);

  assert.strictEqual(reduce(browse, "m", VIEWPORT), browse);
});

// --- the file on disk --------------------------------------------------------

test("a saved place outlives the pane", (t) => {
  const repo = makeRepo(t);

  pressLive(readingAtLine5(repo), ["m"]);

  assert.deepStrictEqual(loadBookmarks(repo.store, repo.root), [
    { path: "lib/a.js", line: 5, text: "const line4 = 4;" },
  ]);
});

test("a new pane opens with what the last one saved", (t) => {
  const repo = makeRepo(t);
  pressLive(readingAtLine5(repo), ["m"]);

  const later = open(repo);

  assert.strictEqual(later.bookmarks.length, 1);
  assert.strictEqual(later.bookmarks[0].path, "lib/a.js");
});

test("removing one is written back too", (t) => {
  const repo = makeRepo(t);
  pressLive(readingAtLine5(repo), ["m"]);

  pressLive(readingAtLine5(repo), ["m"]);

  assert.deepStrictEqual(loadBookmarks(repo.store, repo.root), []);
});

// --- going back --------------------------------------------------------------

test("' lists the saved places from any view", (t) => {
  const repo = makeRepo(t);
  pressLive(readingAtLine5(repo), ["m"]);

  for (const [label, state] of [
    ["browse", open(repo)],
    ["diff", open(repo, "review")],
  ]) {
    const listed = reduce(state, "'", VIEWPORT);
    assert.strictEqual(listed.view, "search", label);
    assert.strictEqual(listed.hits.length, 1, label);
  }
});

test("' with nothing saved opens a list that says so", (t) => {
  // A key that only flashes a message is a key the reader cannot tell from a
  // broken one
  const repo = makeRepo(t);

  const listed = reduce(open(repo), "'", VIEWPORT);

  assert.strictEqual(listed.view, "search");
  assert.deepStrictEqual(listed.hits, []);
  assert.match(listed.rows[0].text, /No bookmarks yet/);
});

test("Enter on a saved place opens the file there", (t) => {
  const repo = makeRepo(t);
  pressLive(readingAtLine5(repo), ["m"]);

  const jumped = press(open(repo), ["'", "enter"]);

  assert.strictEqual(jumped.view, "read");
  assert.strictEqual(jumped.openPath, "lib/a.js");
  assert.strictEqual(jumped.rows[jumped.cursor].cell.num, 5);
});

test("a place follows its line when the file has been edited above it", (t) => {
  // The reason a bookmark records the text and not only the number
  const repo = makeRepo(t);
  pressLive(readingAtLine5(repo), ["m"]);

  const lines = fs.readFileSync(path.join(repo.root, "lib", "a.js"), "utf8");
  fs.writeFileSync(path.join(repo.root, "lib", "a.js"), "// a new header\n\n" + lines);

  const jumped = press(open(repo), ["'", "enter"]);

  assert.strictEqual(jumped.rows[jumped.cursor].cell.num, 7);
  assert.strictEqual(jumped.rows[jumped.cursor].cell.text, "const line4 = 4;");
  assert.match(jumped.message, /moved to line 7/);
});

test("a place in a file that is gone says so rather than opening nothing", (t) => {
  const repo = makeRepo(t);
  pressLive(readingAtLine5(repo), ["m"]);
  fs.rmSync(path.join(repo.root, "lib", "a.js"));

  const jumped = press(open(repo), ["'", "enter"]);

  assert.match(jumped.message, /Cannot read lib\/a\.js/);
});

test("Escape comes back from the list to where it was opened", (t) => {
  const repo = makeRepo(t);
  pressLive(readingAtLine5(repo), ["m"]);
  const browsing = open(repo);

  const back = press(browsing, ["'", "escape"]);

  assert.strictEqual(back.view, "browse");
});
