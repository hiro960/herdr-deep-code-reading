"use strict";

// Copying, deleting and renaming a file, from the browser it is listed in.
//
// The line this plugin used to draw was that naming a file is a browser's business and
// everything else is an editor's. These three cross it deliberately: they are what a
// reader does to the tree in front of them, and leaving the pane to do them is leaving
// the pane. They act on a file and never on a directory, they never overwrite, and the
// one that destroys asks first.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { createState, helpText, reduce } = require("../lib/app-state");
const { performEffect } = require("../lib/run/effects");

const COLUMNS = 160;
const VIEWPORT = 20;

function makeTree(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "herdr-deep-code-reading-files-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  fs.mkdirSync(path.join(root, "lib"));
  fs.writeFileSync(path.join(root, "a.js"), "const a = 1;\n");
  fs.writeFileSync(path.join(root, "b.js"), "const b = 2;\n");
  fs.writeFileSync(path.join(root, "lib", "c.js"), "const c = 3;\n");
  return root;
}

function browsing(t) {
  return createState(makeTree(t), "files", COLUMNS);
}

function press(state, key) {
  return performEffect(reduce(state, key, VIEWPORT), null);
}

function pressAll(state, keys) {
  return keys.reduce((current, key) => press(current, key), state);
}

/** Move the browser's cursor onto a named entry, from the top of the listing. */
function onto(state, name) {
  let current = press(state, "g");
  for (let steps = 0; steps < current.browse.entries.length; steps += 1) {
    if (current.browse.entries[current.browse.index].name === name) {
      return current;
    }
    current = press(current, "j");
  }
  throw new Error(`the listing has no ${name}`);
}

function listing(state) {
  return state.browse.entries.map((entry) => entry.name);
}

// --- what the browser starts with --------------------------------------------

test("the fixture lists what it holds", (t) => {
  assert.deepStrictEqual(listing(browsing(t)), ["lib", "a.js", "b.js"]);
});

test("the footer names the three keys, and no longer the working tree's", (t) => {
  const help = helpText(browsing(t));

  for (const item of ["y yank", "p paste", "D delete", "r rename"]) {
    assert.ok(help.includes(item), `the footer does not offer ${item}`);
  }
  assert.ok(!help.includes("D working tree"), "D still means two things here");
});

// --- copying ------------------------------------------------------------------

test("y remembers a file and p writes it where the browser is", (t) => {
  const state = onto(browsing(t), "a.js");

  const yanked = press(state, "y");
  assert.match(yanked.message, /a\.js/);

  const inside = press(press(onto(yanked, "lib"), "l"), "p");

  assert.strictEqual(fs.readFileSync(path.join(inside.repoDir, "lib", "a.js"), "utf8"), "const a = 1;\n");
  assert.ok(listing(inside).includes("a.js"), "the copy is not in the listing");
});

test("pasting where the name is already taken writes nothing", (t) => {
  const state = onto(browsing(t), "a.js");
  const inside = press(press(onto(press(state, "y"), "lib"), "l"), "p");

  const again = press(inside, "p");

  assert.match(again.message, /already exists/);
  assert.strictEqual(fs.readFileSync(path.join(state.repoDir, "lib", "a.js"), "utf8"), "const a = 1;\n");
});

test("pasting a file back where it came from says it is already there", (t) => {
  const state = onto(browsing(t), "a.js");

  const pasted = press(press(state, "y"), "p");

  assert.match(pasted.message, /already here/);
});

test("pasting with nothing yanked says so", (t) => {
  assert.match(press(browsing(t), "p").message, /nothing/i);
});

test("a directory is not a file to yank", (t) => {
  const yanked = press(onto(browsing(t), "lib"), "y");

  assert.match(yanked.message, /directory/i);
  assert.strictEqual(yanked.yanked, null);
});

// --- deleting -----------------------------------------------------------------

test("D asks before it deletes", (t) => {
  const state = onto(browsing(t), "b.js");

  const asked = press(state, "D");

  assert.match(asked.message, /b\.js/);
  assert.ok(fs.existsSync(path.join(state.repoDir, "b.js")), "it went on the first press");
});

test("D again deletes, and the listing loses it", (t) => {
  const state = onto(browsing(t), "b.js");

  const gone = press(press(state, "D"), "D");

  assert.ok(!fs.existsSync(path.join(state.repoDir, "b.js")));
  assert.deepStrictEqual(listing(gone), ["lib", "a.js"]);
});

test("any other key takes the question back off", (t) => {
  const state = onto(browsing(t), "b.js");

  const moved = press(press(state, "D"), "k");

  assert.strictEqual(moved.pendingDelete, false);
  assert.ok(fs.existsSync(path.join(state.repoDir, "b.js")));
});

test("a directory is not a file to delete", (t) => {
  const asked = press(onto(browsing(t), "lib"), "D");

  assert.match(asked.message, /directory/i);
  assert.ok(fs.existsSync(path.join(asked.repoDir, "lib")));
});

// --- renaming -----------------------------------------------------------------

test("r opens a field with the name already in it", (t) => {
  const state = press(onto(browsing(t), "a.js"), "r");

  assert.strictEqual(state.input.kind, "rename");
  assert.strictEqual(state.input.text, "a.js");
});

test("a name accepted renames the file, and the listing follows", (t) => {
  const state = press(onto(browsing(t), "a.js"), "r");

  const renamed = pressAll(state, ["backspace", "backspace", "backspace", "backspace", "backspace", "z", ".", "j", "s", "enter"]);

  assert.ok(!fs.existsSync(path.join(renamed.repoDir, "a.js")));
  assert.strictEqual(fs.readFileSync(path.join(renamed.repoDir, "z.js"), "utf8"), "const a = 1;\n");
  assert.deepStrictEqual(listing(renamed), ["lib", "b.js", "z.js"]);
});

test("renaming onto a name something already answers to writes nothing", (t) => {
  const state = press(onto(browsing(t), "a.js"), "r");

  const refused = pressAll(state, [
    "backspace", "backspace", "backspace", "backspace", "b", ".", "j", "s", "enter",
  ]);

  assert.match(refused.message, /already exists/);
  assert.strictEqual(fs.readFileSync(path.join(state.repoDir, "b.js"), "utf8"), "const b = 2;\n");
});

test("a name that climbs out of the tree is refused", (t) => {
  const state = press(onto(browsing(t), "a.js"), "r");

  const refused = pressAll(state, ["backspace", "backspace", "backspace", "backspace", "escape"]);
  assert.strictEqual(refused.input, null);

  const climbed = pressAll(press(onto(browsing(t), "a.js"), "r"), [
    "backspace", "backspace", "backspace", "backspace", ".", ".", "/", "x", "enter",
  ]);
  assert.match(climbed.message, /not a name inside/);
});

test("a directory is not a file to rename", (t) => {
  const asked = press(onto(browsing(t), "lib"), "r");

  assert.match(asked.message, /directory/i);
  assert.strictEqual(asked.input, null);
});
