"use strict";

// Reading a definition without going to it.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const { createState, reduce, toScreenModel } = require("../lib/app-state");
const { renderScreen } = require("../lib/render");
const { PEEK_LINES } = require("../lib/state/views/peek");

const COLUMNS = 120;
const ROWS = 30;
const VIEWPORT = 20;

const SGR = /\[[0-9;]*m/g;
const CURSOR = /\[\d+;\d+H/g;
const ERASE = /\[0K/g;
const HOME = /\[H/g;

const GREET = [
  '"use strict";',
  "",
  "function greet(name) {",
  "  const opening = 1;",
  "  return opening + name;",
  "}",
  "",
  "module.exports = { greet };",
].join("\n");

function makeRepo(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "herdr-deep-code-reading-peek-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  execFileSync("git", ["init", "-q"], { cwd: root, stdio: "ignore" });
  fs.writeFileSync(path.join(root, "greet.js"), GREET + "\n");
  fs.writeFileSync(path.join(root, "use.js"), 'const { greet } = require("./greet");\n');
  execFileSync("git", ["add", "-A"], { cwd: root, stdio: "ignore" });
  execFileSync(
    "git",
    ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init"],
    { cwd: root, stdio: "ignore" }
  );
  fs.writeFileSync(path.join(root, "use.js"), 'const { greet } = require("./greet");\ngreet("world");\n');

  return root;
}

function frameLines(state) {
  return renderScreen(toScreenModel(state), { columns: COLUMNS, rows: ROWS })
    .replace(HOME, "")
    .replace(ERASE, "")
    .replace(CURSOR, "\n")
    .replace(SGR, "")
    .split("\n")
    .filter((line) => line !== "");
}

/** The cursor on the word `greet`, in a file that only mentions it. */
function onTheName(t) {
  const state = createState(makeRepo(t), "review", COLUMNS);
  const rows = state.rows;
  const at = rows.findIndex(
    (row) => row.kind === "line" && row.cell.text.includes("greet(")
  );
  assert.notStrictEqual(at, -1, "the fixture has no call to look at");

  // Column zero is the start of `greet(...)`, so the name is already under it
  return { ...state, cursor: at, column: 0 };
}

// --- what it shows -------------------------------------------------------------------

test("K reads out the definition of the name under the cursor", (t) => {
  const peeked = reduce(onTheName(t), "K", VIEWPORT);

  assert.notStrictEqual(peeked.peek, null);
  assert.match(peeked.peek.title, /^greet\.js:3/);
  assert.ok(
    peeked.peek.rows.some((row) => row.cell.text.includes("function greet(name)")),
    "the definition is not in what was shown"
  );
});

test("it shows enough of the body to say what the thing is, and no more", (t) => {
  const peeked = reduce(onTheName(t), "K", VIEWPORT);

  assert.ok(peeked.peek.rows.length <= PEEK_LINES);
  assert.ok(peeked.peek.rows.length > 1, "a signature on its own says very little");
});

test("the lines keep the numbers the file gives them", (t) => {
  const peeked = reduce(onTheName(t), "K", VIEWPORT);
  const [first] = peeked.peek.rows;

  assert.strictEqual(first.cell.num, 3);
});

test("the definition is drawn where the body was", (t) => {
  const peeked = reduce(onTheName(t), "K", VIEWPORT);
  const drawn = frameLines(peeked).join("\n");

  assert.match(drawn, /greet\.js:3/);
  assert.match(drawn, /function greet\(name\)/);
});

// --- what it costs -----------------------------------------------------------------------

test("nothing moves: not the cursor, not the file, not the way back", (t) => {
  // The whole point. Enter is the key that goes there and gives up the place.
  const before = onTheName(t);
  const peeked = reduce(before, "K", VIEWPORT);

  assert.strictEqual(peeked.cursor, before.cursor);
  assert.strictEqual(peeked.view, before.view);
  assert.strictEqual(peeked.selectedIndex, before.selectedIndex);
  assert.strictEqual(peeked.history.length, before.history.length);
});

test("the next key puts it away, whatever the key was", (t) => {
  const peeked = reduce(onTheName(t), "K", VIEWPORT);

  assert.strictEqual(reduce(peeked, "j", VIEWPORT).peek, null);
  assert.strictEqual(reduce(peeked, "escape", VIEWPORT).peek, null);
  assert.strictEqual(reduce(peeked, "z", VIEWPORT).peek, null);
});

/** The same glance, taken while reading the file rather than its diff. */
function readingOnTheName(t) {
  const opened = reduce(createState(makeRepo(t), "files", COLUMNS), "l", VIEWPORT);
  assert.strictEqual(opened.view, "read");
  const at = opened.rows.findIndex(
    (row) => row.kind === "line" && row.cell.text.includes("module.exports")
  );
  assert.notStrictEqual(at, -1, "the fixture has no line to look at");

  return { ...opened, cursor: at, column: opened.rows[at].cell.text.indexOf("greet") };
}

test("Esc is spent putting it away, and takes nothing else with it", (t) => {
  // Regression: Esc closed the peek and then meant what it means underneath, which in
  // the reading view is leaving the file — so the key a reader reaches for to dismiss
  // a glance threw away the place the glance was taken from. Esc is this pane's "put
  // the thing in front of me away" everywhere else, and now it is here too.
  const before = readingOnTheName(t);
  const peeked = reduce(before, "K", VIEWPORT);
  assert.ok(peeked.peek, "there was nothing to glance at");

  const closed = reduce(peeked, "escape", VIEWPORT);

  assert.strictEqual(closed.peek, null);
  assert.strictEqual(closed.view, before.view);
  assert.strictEqual(closed.openPath, before.openPath);
  assert.strictEqual(closed.cursor, before.cursor);
});

test("the key that put it away still does what it was going to do", (t) => {
  // `g` rather than `j`: the fixture's cursor is on the last row of a two-line diff,
  // and a key with nowhere to go would prove nothing
  const peeked = reduce(onTheName(t), "K", VIEWPORT);
  assert.ok(peeked.cursor > 0, "the fixture has nowhere to move from");

  const moved = reduce(peeked, "g", VIEWPORT);

  assert.strictEqual(moved.peek, null);
  assert.strictEqual(moved.cursor, 0);
});

// --- when there is nothing to show ----------------------------------------------------------

test("a name nothing defines says so rather than showing nothing", (t) => {
  const state = onTheName(t);
  // `world` is a string in the one call and a definition nowhere
  const onTheArgument = { ...state, column: 'greet("'.length };

  const peeked = reduce(onTheArgument, "K", VIEWPORT);

  assert.strictEqual(peeked.peek, undefined);
  assert.match(peeked.message, /No definition found for world/);
});

test("several definitions show the first, and say there are more", (t) => {
  const root = makeRepo(t);
  fs.writeFileSync(path.join(root, "other.js"), "function greet(who) {\n  return who;\n}\n");
  execFileSync("git", ["add", "-A"], { cwd: root, stdio: "ignore" });

  const state = createState(root, "review", COLUMNS);
  const at = state.rows.findIndex(
    (row) => row.kind === "line" && row.cell.text.includes("function greet")
  );
  assert.notStrictEqual(at, -1, "the fixture has no definition on screen");

  const onName = { ...state, cursor: at, column: "function ".length };
  const peeked = reduce(onName, "K", VIEWPORT);

  assert.match(peeked.peek.title, /\(1 of 2\)/);
});
