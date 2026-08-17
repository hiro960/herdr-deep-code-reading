"use strict";

// Reading two places at once, and the key list when the footer runs out of room.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const { createState, reduce, toScreenModel } = require("../lib/app-state");
const { OVERFLOW, wrapHelp } = require("../lib/help-layout");
const { openAt, openSpec, placeUnderCursor } = require("../lib/state/views/pane");

const COLUMNS = 120;
const VIEWPORT = 20;

function makeRepo(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "herdr-deep-code-reading-pane-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  execFileSync("git", ["init", "-q"], { cwd: root, stdio: "ignore" });
  fs.writeFileSync(path.join(root, "a.js"), "one\ntwo\nthree\nfour\n");
  execFileSync("git", ["add", "-A"], { cwd: root, stdio: "ignore" });
  execFileSync(
    "git",
    ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init"],
    { cwd: root, stdio: "ignore" }
  );
  fs.writeFileSync(path.join(root, "a.js"), "one\nTWO\nthree\nFOUR\n");

  return root;
}

function press(state, keys) {
  return keys.reduce((current, key) => reduce(current, key, VIEWPORT), state);
}

// --- where a second pane would open ---------------------------------------------------

test("the place under the cursor is a path and a line", (t) => {
  const state = press(createState(makeRepo(t), "review", COLUMNS), ["j", "j"]);
  const place = placeUnderCursor(state);

  assert.strictEqual(place.path, "a.js");
  assert.ok(place.line >= 1);
});

test("a removed line opens the file rather than a line that moved", (t) => {
  // A removed line is numbered in a version of the file that no longer exists, so
  // opening at that number would land on whatever now has it
  const state = createState(makeRepo(t), "review", COLUMNS);
  const onRemoved = state.rows.findIndex(
    (row) => row.anchor !== undefined && row.anchor !== null && row.anchor.side === "old"
  );
  assert.notStrictEqual(onRemoved, -1, "the fixture has no removed line");

  assert.deepStrictEqual(placeUnderCursor({ ...state, cursor: onRemoved }), {
    path: "a.js",
    line: 1,
  });
});

test("| asks for one, and says where", (t) => {
  const state = press(createState(makeRepo(t), "review", COLUMNS), ["j", "j"]);

  const asked = reduce(state, "|", VIEWPORT);

  assert.strictEqual(asked.effect.type, "open-pane");
  assert.strictEqual(asked.effect.place.path, "a.js");
  assert.match(asked.message, /beside this/);
});

// --- and how it is told ----------------------------------------------------------------

test("a place survives the trip through an environment variable", () => {
  const place = { path: "lib/a b.js", line: 42 };

  assert.deepStrictEqual(openAt({ HERDR_DEEP_CODE_READING_OPEN: openSpec(place) }), place);
});

test("a path with a colon in it keeps its colon", () => {
  assert.deepStrictEqual(openAt({ HERDR_DEEP_CODE_READING_OPEN: "a:b.js:7" }), { path: "a:b.js", line: 7 });
});

test("a spec with no line opens the top of the file", () => {
  assert.deepStrictEqual(openAt({ HERDR_DEEP_CODE_READING_OPEN: "a.js" }), { path: "a.js", line: 1 });
  assert.deepStrictEqual(openAt({ HERDR_DEEP_CODE_READING_OPEN: "a.js:x" }), { path: "a.js:x", line: 1 });
  assert.deepStrictEqual(openAt({ HERDR_DEEP_CODE_READING_OPEN: "a.js:0" }), { path: "a.js", line: 1 });
});

test("no variable is no place", () => {
  assert.strictEqual(openAt({}), null);
  assert.strictEqual(openAt({ HERDR_DEEP_CODE_READING_OPEN: "" }), null);
  assert.strictEqual(openAt(undefined), null);
});

test("a pane told where to open, opens there", (t) => {
  const state = createState(makeRepo(t), "files", COLUMNS, { openAt: { HERDR_DEEP_CODE_READING_OPEN: "a.js:3" } });

  assert.strictEqual(state.view, "read");
  assert.strictEqual(state.openPath, "a.js");
});

test("a pane told nothing opens on whatever its mode says", (t) => {
  const state = createState(makeRepo(t), "files", COLUMNS, { openAt: {} });

  assert.strictEqual(state.view, "browse");
});

// --- the key list ---------------------------------------------------------------------

test("a footer that ran out of rows says where the rest is", () => {
  const long = Array.from({ length: 60 }, (_, at) => `k${at} does something`).join("  ");
  const rows = wrapHelp(long, 79);

  assert.strictEqual(rows.length, 4, "the ceiling moved");
  assert.ok(rows[3].endsWith(OVERFLOW), "the last row said nothing about the rest");
  assert.ok(rows[3].length <= 79, "the row it said it on does not fit either");
});

test("a footer that fits says nothing about a rest that is not there", () => {
  const rows = wrapHelp("a one  b two", 79);

  assert.deepStrictEqual(rows, ["a one  b two"]);
});

test("? lists every key the view binds, one to a row", (t) => {
  const state = createState(makeRepo(t), "review", COLUMNS);
  const help = toScreenModel(state).help;

  const keys = reduce(state, "?", VIEWPORT);

  assert.match(keys.listTitle, /^keys {2}\(\d+\)/);
  assert.strictEqual(keys.rows.length, help.split("  ").filter((item) => item !== "").length);
  assert.ok(keys.rows.every((row) => row.kind === "note"));
});

test("the list has every key the footer clipped", (t) => {
  const state = createState(makeRepo(t), "review", COLUMNS);
  const shown = reduce(state, "?", VIEWPORT).rows.map((row) => row.text);

  assert.ok(shown.some((item) => item.startsWith("Q quit")), "the last key is missing");
  assert.ok(shown.some((item) => item.startsWith("| open")), "a new key is missing");
});

test("Esc comes back from it, the way it comes back from any list", (t) => {
  const state = createState(makeRepo(t), "review", COLUMNS);
  const back = press(state, ["?", "escape"]);

  assert.strictEqual(back.view, "diff");
});
