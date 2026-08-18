"use strict";

// Reading a directory that is not a repository.
//
// Most of what this plugin does is reading, and reading needs a file rather than a
// history: a browser, a reader, an outline, a search, a bookmark, a question to an
// agent. None of that is git's. So a directory git has never heard of opens, and the
// keys that are about a repository — the diffs, the log, blame, staging, the remote —
// are withheld rather than left to fail in front of the reader.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const { createState, helpText, reduce, reloadedInPlace, toScreenModel } = require("../lib/app-state");
const { fingerprint } = require("../lib/watch");

const COLUMNS = 160;
const VIEWPORT = 20;

/** A plain directory with a little source in it, and no repository anywhere above. */
function makePlain(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "herdr-deep-code-reading-plain-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  fs.writeFileSync(path.join(root, "greet.js"), "function greet(name) {\n  return name;\n}\n");
  fs.mkdirSync(path.join(root, "lib"));
  fs.writeFileSync(path.join(root, "lib", "call.js"), 'const g = require("../greet");\ng(greet);\n');
  return root;
}

/** The same, with a repository, so the two can be told apart. */
function makeRepo(t) {
  const root = makePlain(t);
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: root, stdio: "ignore" });
  execFileSync("git", ["add", "-A"], { cwd: root, stdio: "ignore" });
  execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "one"], {
    cwd: root,
    stdio: "ignore",
  });
  return root;
}

function press(state, keys) {
  return keys.reduce((current, key) => reduce(current, key, VIEWPORT), state);
}

function open(t, mode) {
  return createState(makePlain(t), mode || "files", COLUMNS);
}

// --- opening at all ----------------------------------------------------------

test("a directory without a repository opens, on the browser", (t) => {
  const state = open(t);

  assert.strictEqual(state.repository, false);
  assert.strictEqual(state.view, "browse");
});

test("a diff asked for where there is none opens the browser, and says why", (t) => {
  // The action a reader pressed was `review`; refusing outright is what it used to do
  const state = open(t, "review");

  assert.strictEqual(state.view, "browse");
  assert.match(state.message, /not a git repository/i);
});

test("the log asked for where there is none does the same", (t) => {
  assert.strictEqual(open(t, "log").view, "browse");
});

test("a repository still opens on whatever was asked for", (t) => {
  const state = createState(makeRepo(t), "review", COLUMNS);

  assert.strictEqual(state.repository, true);
  assert.strictEqual(state.view, "diff");
  assert.strictEqual(state.message, null);
});

// --- what the browser lists --------------------------------------------------

test("the listing is walked from the directory itself", (t) => {
  const state = open(t);

  assert.deepStrictEqual(
    state.browse.entries.map((entry) => entry.name),
    ["lib", "greet.js"]
  );
});

test("a file opens and reads", (t) => {
  const reading = press(open(t), ["j", "l"]);

  assert.strictEqual(reading.view, "read");
  assert.strictEqual(reading.openPath, "greet.js");
  assert.strictEqual(reading.rows[0].cell.text, "function greet(name) {");
});

test("what a file declares is its own business, not the repository's", (t) => {
  const outlined = press(open(t), ["j", "l", "o"]);

  assert.strictEqual(outlined.view, "search");
  assert.deepStrictEqual(outlined.hits.map((hit) => hit.name), ["greet"]);
});

test("finding text in the open file needs no repository either", (t) => {
  const found = press(open(t), ["j", "l", "/", "r", "e", "t", "u", "r", "n", "enter"]);

  assert.strictEqual(found.rows[found.cursor].cell.num, 2);
});

// --- the keys that are about a repository ------------------------------------

const GIT_KEYS = ["e diff", "D working tree", "L log", "# find in history", "Tab contents/diff"];

test("the footer offers no key that needs a repository", (t) => {
  const help = helpText(open(t));

  for (const item of GIT_KEYS) {
    assert.ok(!help.includes(item), `the footer still offers ${item}`);
  }
  assert.ok(help.includes("l/Enter open"), "the browser lost its own keys");
});

test("the reading view keeps its own keys and loses the repository's", (t) => {
  const help = helpText(press(open(t), ["j", "l"]));

  assert.ok(help.includes("o outline"), "the outline went with them");
  assert.ok(help.includes("@ ask"), "asking went with them");
  for (const item of ["H history", "B blame", "e diff", "D working tree"]) {
    assert.ok(!help.includes(item), `the footer still offers ${item}`);
  }
});

test("a repository's footer is untouched", (t) => {
  const help = helpText(createState(makeRepo(t), "files", COLUMNS));

  for (const item of GIT_KEYS) {
    assert.ok(help.includes(item), `a repository lost ${item}`);
  }
});

test("pressing one anyway says what it needs rather than failing", (t) => {
  const state = open(t);

  for (const key of ["L", "D", "#"]) {
    const pressed = reduce(state, key, VIEWPORT);
    assert.strictEqual(pressed.view, "browse", `${key} left the browser`);
    assert.match(pressed.message, /repository/i, `${key} said nothing`);
  }
});

test("the header names no branch where there is none", (t) => {
  assert.doesNotMatch(toScreenModel(open(t)).title, /\s\s\S+\s\s\/$/);
});

// --- keeping up to date ------------------------------------------------------

test("a reload reads the file again rather than failing on a diff there is none of", (t) => {
  const root = makePlain(t);
  const reading = press(createState(root, "files", COLUMNS), ["j", "l"]);
  assert.strictEqual(reading.openPath, "greet.js");
  fs.writeFileSync(path.join(root, "greet.js"), "function greet(name) {\n  return name + 1;\n}\n");

  const again = reloadedInPlace(reading, null, VIEWPORT);

  assert.strictEqual(again.rows[1].cell.text, "  return name + 1;");
  assert.doesNotMatch(String(again.message), /failed/i);
});

test("an agent's answer still arrives, which is what the watch is for", (t) => {
  const root = makePlain(t);
  const notesFile = path.join(root, "notes.json");
  const state = createState(root, "files", COLUMNS, { notesFile });

  const before = fingerprint(root, notesFile, state.repository);
  fs.writeFileSync(
    notesFile,
    JSON.stringify({ [root]: [{ path: "greet.js", line: 1, text: "because", from: "claude" }] })
  );

  assert.notStrictEqual(before, null);
  assert.notStrictEqual(fingerprint(root, notesFile, state.repository), before);
});

test("turning the watch on brings the answer in, without a repository too", (t) => {
  const root = makePlain(t);
  const notesFile = path.join(root, "notes.json");
  const state = createState(root, "files", COLUMNS, { notesFile });
  fs.writeFileSync(
    notesFile,
    JSON.stringify({ [root]: [{ path: "greet.js", line: 1, text: "because", from: "claude" }] })
  );

  const watching = reduce(state, "W", VIEWPORT);

  assert.strictEqual(watching.watching, true);
  assert.strictEqual(watching.notes.length, 1);
});

// --- following a name without a repository -----------------------------------

test("following a name goes to where it is declared", (t) => {
  const state = press(open(t), ["l", "l"]);
  assert.strictEqual(state.openPath, "lib/call.js");

  const jumped = press({ ...state, cursor: 1, column: 2 }, ["enter"]);

  assert.strictEqual(jumped.openPath, "greet.js");
  assert.strictEqual(jumped.rows[jumped.cursor].cell.num, 1);
});

test("the uses of a name are listed", (t) => {
  const state = press(open(t), ["l", "l"]);

  const uses = press({ ...state, cursor: 1, column: 2 }, ["R"]);

  assert.strictEqual(uses.view, "search");
  assert.ok(uses.hits.length > 0, "nothing was found to use it");
});

test("searching the whole directory answers from the files themselves", (t) => {
  const found = press(open(t), ["/", "g", "r", "e", "e", "t", "enter"]);

  assert.strictEqual(found.view, "search");
  assert.deepStrictEqual(
    [...new Set(found.hits.map((hit) => hit.path))].sort(),
    ["greet.js", "lib/call.js"]
  );
});

test("the quick find opens a file by part of its path", (t) => {
  const found = press(open(t), ["P", "c", "a", "l", "l", "enter"]);

  assert.strictEqual(found.openPath, "lib/call.js");
});
