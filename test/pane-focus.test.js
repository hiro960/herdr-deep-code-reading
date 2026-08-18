"use strict";

// What `Tab` means where two panes are drawn side by side.
//
// The log has four panes and a focus that `Tab` cycles. The diff has two and no focus
// at all: `j`/`k` always move the lines and `n`/`p` always move the file list, so
// neither ever takes a turn at being the other. That is a good arrangement and an
// invisible one — a reader coming from the log presses `Tab`, nothing happens, and
// nothing tells them what to press instead.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const { createState, reduce } = require("../lib/app-state");

const COLUMNS = 200;
const VIEWPORT = 40;

function makeRepo(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "herdr-deep-code-reading-focus-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: root, stdio: "ignore" });
  fs.writeFileSync(path.join(root, "a.js"), "one\ntwo\nthree\n");
  fs.writeFileSync(path.join(root, "b.js"), "alpha\n");
  execFileSync("git", ["add", "-A"], { cwd: root, stdio: "ignore" });
  execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "one"], {
    cwd: root,
    stdio: "ignore",
  });
  fs.writeFileSync(path.join(root, "a.js"), "one\ntwo\nthree\nfour\n");
  fs.writeFileSync(path.join(root, "b.js"), "alpha\nbeta\n");
  return root;
}

function press(state, keys) {
  return keys.reduce((current, key) => reduce(current, key, VIEWPORT), state);
}

test("the file list still moves with n and p, from anywhere in the diff", (t) => {
  const state = press(createState(makeRepo(t), "review", COLUMNS), ["j", "j"]);

  const next = reduce(state, "n", VIEWPORT);

  assert.strictEqual(next.selectedIndex, 1);
  assert.strictEqual(reduce(next, "p", VIEWPORT).selectedIndex, 0);
});

test("Tab says what moves the file list rather than doing nothing", (t) => {
  // Regression: it did nothing at all, and a reader who had learnt `Tab` in the log
  // had no way to find out that this screen has no focus to cycle
  const state = press(createState(makeRepo(t), "review", COLUMNS), ["j"]);

  const pressed = reduce(state, "tab", VIEWPORT);

  assert.match(pressed.message, /n\/p/);
  assert.strictEqual(pressed.cursor, state.cursor, "it moved something");
  assert.strictEqual(pressed.selectedIndex, state.selectedIndex);
});

test("Tab goes on cycling the log's panes", (t) => {
  const state = reduce(createState(makeRepo(t), "log", COLUMNS), "tab", VIEWPORT);

  assert.strictEqual(state.view, "log");
  assert.notStrictEqual(state.log.focus, "graph", "the log lost its focus cycle");
});

test("Tab goes on flipping the reader between contents and diff", (t) => {
  const state = press(createState(makeRepo(t), "files", COLUMNS), ["l"]);
  assert.strictEqual(state.view, "read");

  assert.notStrictEqual(reduce(state, "tab", VIEWPORT).readMode, state.readMode);
});

test("h at the start of a line is still an ordinary key at its limit", (t) => {
  // `k` on the first row does nothing and should. A movement key that complained at
  // the end of its range would complain on every held keypress.
  const state = press(createState(makeRepo(t), "review", COLUMNS), ["j"]);
  assert.strictEqual(state.column, 0);

  const pressed = reduce(state, "h", VIEWPORT);

  assert.strictEqual(pressed.column, 0);
  assert.strictEqual(pressed.message, null);
});
