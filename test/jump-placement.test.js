"use strict";

// Where a jump puts the line it jumped to.
//
// Regression: following a name, or opening an outline entry, scrolled by the least it
// could — which put the line at the very bottom of the body, with the whole of what
// was above it on screen and none of what was below. A reader who jumps to a function
// wants to read the function, and had to press `d` before they could see any of it.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const { createState, reduce } = require("../lib/app-state");

const VIEWPORT = 40;
const COLUMNS = 160;
const GIT_IDENTITY = ["-c", "user.email=t@t", "-c", "user.name=t"];

// Two functions with a long stretch of nothing between them, so that jumping to the
// second one is a jump the screen has to move for.
const DEEP_LINE = 150;

function longFile() {
  const lines = ["function near() {", "  return 1;", "}", ""];
  while (lines.length < DEEP_LINE - 1) {
    lines.push(`const filler${lines.length} = ${lines.length};`);
  }
  lines.push("function deep() {");
  for (let at = 0; at < 40; at += 1) {
    lines.push(`  const inside${at} = ${at};`);
  }
  lines.push("}");
  return lines.join("\n") + "\n";
}

function makeRepo(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "herdr-deep-code-reading-jump-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  execFileSync("git", ["init", "-q"], { cwd: root, stdio: "ignore" });
  fs.writeFileSync(path.join(root, "deep.js"), longFile());
  fs.writeFileSync(path.join(root, "short.js"), "function tiny() {\n  return 2;\n}\n");
  execFileSync("git", ["add", "-A"], { cwd: root, stdio: "ignore" });
  execFileSync("git", [...GIT_IDENTITY, "commit", "-qm", "init"], { cwd: root, stdio: "ignore" });

  return root;
}

function press(state, keys) {
  return keys.reduce((current, key) => reduce(current, key, VIEWPORT), state);
}

/** Open a file in the reader, from the browser. */
function open(root, name) {
  let state = createState(root, "files", COLUMNS);
  while (state.browse.entries[state.browse.index].name !== name) {
    state = reduce(state, "j", VIEWPORT);
  }
  return reduce(state, "l", VIEWPORT);
}

/** Open the outline and choose the entry whose text names `what`. */
function jumpFromOutline(state, what) {
  let listed = reduce(state, "o", VIEWPORT);
  while (!listed.rows[listed.cursor].hit.text.includes(what)) {
    listed = reduce(listed, "j", VIEWPORT);
  }
  return reduce(listed, "enter", VIEWPORT);
}

/** The line the cursor is on. */
function lineAt(state) {
  return state.rows[state.cursor].cell.num;
}

test("a jump deep into a file lands on the line asked for", (t) => {
  const root = makeRepo(t);

  assert.strictEqual(lineAt(jumpFromOutline(open(root, "deep.js"), "function deep")), DEEP_LINE);
});

test("a jump deep into a file leaves the line on screen", (t) => {
  // The bug itself: the cursor was one row past the last one drawn
  const root = makeRepo(t);
  const jumped = jumpFromOutline(open(root, "deep.js"), "function deep");
  const offset = jumped.cursor - jumped.scroll;

  assert.ok(offset >= 0 && offset < VIEWPORT, `the line is ${offset} rows into a ${VIEWPORT} row body`);
});

test("a jump leaves most of the screen below the line, to read it in", (t) => {
  const root = makeRepo(t);
  const jumped = jumpFromOutline(open(root, "deep.js"), "function deep");
  const offset = jumped.cursor - jumped.scroll;

  assert.ok(offset <= VIEWPORT / 2, `the line sits ${offset} rows down a ${VIEWPORT} row body`);
  assert.ok(offset > 0, "the line is at the very top, with none of what leads up to it");
});

test("a jump near the top of a file does not scroll past it", (t) => {
  const root = makeRepo(t);
  const jumped = jumpFromOutline(open(root, "deep.js"), "function near");

  assert.strictEqual(jumped.scroll, 0);
  assert.strictEqual(lineAt(jumped), 1);
});

test("a jump in a file shorter than the body scrolls not at all", (t) => {
  const root = makeRepo(t);
  const jumped = jumpFromOutline(open(root, "short.js"), "function tiny");

  assert.strictEqual(jumped.scroll, 0);
});

test("stepping the cursor still moves by the least it can", (t) => {
  // Only a jump re-centres. Holding `j` down must not make the screen jump about.
  const root = makeRepo(t);
  const reading = press(open(root, "deep.js"), Array.from({ length: 60 }, () => "j"));

  assert.strictEqual(reading.cursor - reading.scroll, VIEWPORT - 1);
});
