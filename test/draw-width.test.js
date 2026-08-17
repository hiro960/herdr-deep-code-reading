"use strict";

// The width the rows were wrapped to, and the width the frame is drawn at.
//
// Regression: a pane resized between the moment the state read the terminal's width
// and the moment it began listening for resizes kept wrapping to the old width while
// the frame was drawn at the new one. Every wrapped row was then one column too wide
// for the row it was drawn into, and the character that fell off the end was simply
// gone — one per wrap, silently, in the middle of a file somebody was reading closely.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const { createState, drawnAt, reduce, toScreenModel } = require("../lib/app-state");
const { renderScreen } = require("../lib/render");

const VIEWPORT = 40;
const ROWS = 45;
const GIT_IDENTITY = ["-c", "user.email=t@t", "-c", "user.name=t"];

// Digits rather than prose: every character says where in the line it belongs, so a
// missing one is found by reading the row rather than by diffing two paragraphs.
const LONG = "A" + Array.from({ length: 200 }, (_, i) => String((i + 1) % 10)).join("");

const ESC = "";
const CURSOR = new RegExp(ESC + "\\[\\d+;\\d+H", "g");
const HOME = new RegExp(ESC + "\\[H", "g");
const ERASE = new RegExp(ESC + "\\[0K", "g");
const SGR = new RegExp(ESC + "\\[[0-9;]*m", "g");

// The gutter, the line number and the lead in front of the text — see lib/layout
const CHROME = 9;

function makeRepo(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "herdr-deep-code-reading-draw-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  execFileSync("git", ["init", "-q"], { cwd: root, stdio: "ignore" });
  fs.writeFileSync(path.join(root, "long.txt"), ["head", LONG, "foot", ""].join("\n"));
  execFileSync("git", ["add", "-A"], { cwd: root, stdio: "ignore" });
  execFileSync("git", [...GIT_IDENTITY, "commit", "-qm", "init"], { cwd: root, stdio: "ignore" });

  return root;
}

/** Open long.txt in the reader, with the rows wrapped to `columns`. */
function openLong(root, columns) {
  const state = reduce(createState(root, "files", columns), "l", VIEWPORT);
  assert.strictEqual(state.openPath, "long.txt");
  return state;
}

/** Everything the frame drew of the long line, in the order it drew it. */
function longLineFromFrame(frame) {
  return frame
    .replace(HOME, "")
    .replace(ERASE, "")
    .replace(CURSOR, "\n")
    .replace(SGR, "")
    .split("\n")
    .map((row) => row.slice(CHROME).replace(/ +$/, ""))
    .filter((text) => /^[A0-9]/.test(text))
    .join("");
}

function drawAt(state, columns) {
  return longLineFromFrame(renderScreen(toScreenModel(state), { columns, rows: ROWS }));
}

test("a frame drawn at the width the rows were wrapped to loses nothing", (t) => {
  const root = makeRepo(t);

  assert.strictEqual(drawAt(openLong(root, 151), 151), LONG);
});

test("a frame drawn narrower than the rows were wrapped to loses nothing", (t) => {
  // One column narrower is the whole bug: one character per wrap, and nothing said
  const root = makeRepo(t);
  const wrapped = openLong(root, 152);

  assert.strictEqual(drawAt(drawnAt(wrapped, 151), 151), LONG);
});

test("a frame drawn much narrower than the rows were wrapped to loses nothing", (t) => {
  const root = makeRepo(t);
  const wrapped = openLong(root, 200);

  assert.strictEqual(drawAt(drawnAt(wrapped, 100), 100), LONG);
});

test("a frame drawn wider than the rows were wrapped to loses nothing", (t) => {
  const root = makeRepo(t);
  const wrapped = openLong(root, 100);

  assert.strictEqual(drawAt(drawnAt(wrapped, 200), 200), LONG);
});

test("drawing at the width already recorded changes nothing at all", (t) => {
  // Every frame asks, so the answer to "nothing moved" has to be the same state
  const root = makeRepo(t);
  const state = openLong(root, 151);

  assert.strictEqual(drawnAt(state, 151), state);
});

test("drawing at a new width records it, so the next frame agrees", (t) => {
  const root = makeRepo(t);

  assert.strictEqual(drawnAt(openLong(root, 152), 151).columns, 151);
});
