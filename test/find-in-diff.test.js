"use strict";

// Finding text in a diff, and walking the word under the cursor.
//
// The reading view has had `/` since the beginning; the diff never did, because `n`
// and `p` are the file list here and a search with no way to repeat it is half a
// search. `*` is the way round it, and it is vi's: it looks for the word under the
// cursor, and since the jump lands on that same word, pressing it again walks forward.
// `/` composes with it — the column is left on the match, so `*` carries on from there.
//
// The search is of the file on screen. Looking through every file is what the browser's
// `/` and the pickaxe are for, and both are a keystroke away.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const { createState, helpText, reduce } = require("../lib/app-state");

const COLUMNS = 200;
const NARROW = 100;
const VIEWPORT = 40;

function makeRepo(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "herdr-deep-code-reading-finddiff-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: root, stdio: "ignore" });
  fs.writeFileSync(path.join(root, "a.js"), "one\n");
  fs.writeFileSync(path.join(root, "b.js"), "other\n");
  execFileSync("git", ["add", "-A"], { cwd: root, stdio: "ignore" });
  execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "base"], {
    cwd: root,
    stdio: "ignore",
  });

  fs.writeFileSync(
    path.join(root, "a.js"),
    ["one", "const target = 1;", "filler", "call(target);", "more", "target = 2;"].join("\n") + "\n"
  );
  fs.writeFileSync(path.join(root, "b.js"), "other\ntarget\n");
  return root;
}

function press(state, keys) {
  return keys.reduce((current, key) => reduce(current, key, VIEWPORT), state);
}

function open(t, columns) {
  return createState(makeRepo(t), "review", columns || COLUMNS);
}

/** The text of the row the cursor is on. */
function lineAt(state) {
  const row = state.rows[state.cursor];
  return row.cell ? row.cell.text : [row.left, row.right].filter(Boolean).map((c) => c.text).join(" | ");
}

function type(state, text) {
  return press(state, text.split(""));
}

// --- the field ---------------------------------------------------------------

test("the footer offers both keys", (t) => {
  const help = helpText(open(t));

  assert.ok(help.includes("/ find in diff"), "the footer does not offer /");
  assert.ok(help.includes("* this word"), "the footer does not offer *");
});

test("/ opens a field of its own", (t) => {
  const searching = reduce(open(t), "/", VIEWPORT);

  assert.strictEqual(searching.input.kind, "find");
});

test("what was typed is jumped to, column and all", (t) => {
  const found = press(type(reduce(open(t), "/", VIEWPORT), "target"), ["enter"]);

  assert.match(lineAt(found), /const target = 1;/);
  assert.ok(found.column > 0, "the column stayed at the start of the line");
});

test("a query nothing holds says so and moves nothing", (t) => {
  const state = open(t);

  const missed = press(type(reduce(state, "/", VIEWPORT), "nowhere"), ["enter"]);

  assert.strictEqual(missed.cursor, state.cursor);
  assert.match(missed.message, /nowhere/);
});

// --- the word under the cursor -----------------------------------------------

test("* goes to the next place the word under the cursor appears", (t) => {
  const first = press(type(reduce(open(t), "/", VIEWPORT), "target"), ["enter"]);

  const second = reduce(first, "*", VIEWPORT);

  assert.match(lineAt(second), /call\(target\);/);
});

test("* again walks on, which is what it is for", (t) => {
  const first = press(type(reduce(open(t), "/", VIEWPORT), "target"), ["enter"]);

  const third = press(first, ["*", "*"]);

  assert.match(lineAt(third), /target = 2;/);
});

test("* wraps round the file rather than stopping at the end", (t) => {
  const walked = press(type(reduce(open(t), "/", VIEWPORT), "target"), ["enter", "*", "*", "*"]);

  assert.match(lineAt(walked), /const target = 1;/);
  assert.match(String(walked.message), /wrapped/i);
});

test("* on nothing at all says so", (t) => {
  // The first row of a diff is its hunk heading, which no column cursor reaches
  const state = { ...open(t), cursor: 0, column: 0 };

  const pressed = reduce(state, "*", VIEWPORT);

  assert.strictEqual(pressed.cursor, 0);
  assert.ok(pressed.message.length > 0);
});

// --- the layout it is drawn in -----------------------------------------------

test("it finds text in the stacked layout too", (t) => {
  const found = press(type(reduce(open(t, NARROW), "/", VIEWPORT), "target"), ["enter"]);

  assert.strictEqual(found.sideBySide, false);
  assert.match(lineAt(found), /target/);
});

test("it finds text in the split layout too", (t) => {
  const state = open(t);
  assert.strictEqual(state.sideBySide, true);

  const found = press(type(reduce(state, "/", VIEWPORT), "target"), ["enter"]);

  assert.match(lineAt(found), /target/);
});

// --- what it does not touch ---------------------------------------------------

test("n and p still move the file list", (t) => {
  const found = press(type(reduce(open(t), "/", VIEWPORT), "target"), ["enter"]);

  const next = reduce(found, "n", VIEWPORT);

  assert.strictEqual(next.selectedIndex, 1);
});

test("the search is of the file on screen, and does not follow the file list", (t) => {
  // b.js holds `target` too. Moving to it is moving, not searching.
  const moved = press(type(reduce(open(t), "/", VIEWPORT), "target"), ["enter", "n"]);

  assert.strictEqual(moved.selectedIndex, 1);
  assert.strictEqual(moved.cursor, moved.rows.findIndex((row) => row.kind !== "hunk"));
});

// --- and the same key where a whole file is being read ------------------------

test("* means the same thing in the reading view", (t) => {
  const reading = press(createState(makeRepo(t), "files", COLUMNS), ["l"]);
  assert.strictEqual(reading.openPath, "a.js");
  const found = press(reading, ["/", "t", "a", "r", "g", "e", "t", "enter"]);
  assert.strictEqual(found.rows[found.cursor].cell.num, 2);

  const next = reduce(found, "*", VIEWPORT);

  assert.strictEqual(next.rows[next.cursor].cell.num, 4);
});

test("the reading view's footer offers it too", (t) => {
  const reading = press(createState(makeRepo(t), "files", COLUMNS), ["l"]);

  assert.ok(helpText(reading).includes("* this word"));
});
