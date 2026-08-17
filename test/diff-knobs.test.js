"use strict";

// The two keys that change what git was asked for, rather than what is done with the
// answer. Both end in a reload, so the test for them is the one that runs git.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const { createState, reduce, toScreenModel } = require("../lib/app-state");
const { WHOLE_FILE } = require("../lib/diff-options");

const COLUMNS = 120;
const VIEWPORT = 30;

/** Twenty lines, so there is room above and below a change to widen into. */
function body(marker) {
  const lines = [];
  for (let at = 1; at <= 20; at += 1) {
    lines.push(at === 10 ? `  const value = ${marker};` : `  // line ${at}`);
  }
  return lines.join("\n") + "\n";
}

function makeRepo(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "herdr-deep-code-reading-knobs-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  execFileSync("git", ["init", "-q"], { cwd: root, stdio: "ignore" });
  fs.writeFileSync(path.join(root, "a.js"), body("1"));
  // A file whose only change is its indentation, which is what -w exists for
  fs.writeFileSync(path.join(root, "spaced.js"), "function f() {\n  return 1;\n}\n");
  execFileSync("git", ["add", "-A"], { cwd: root, stdio: "ignore" });
  execFileSync(
    "git",
    ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init"],
    { cwd: root, stdio: "ignore" }
  );

  fs.writeFileSync(path.join(root, "a.js"), body("2"));
  fs.writeFileSync(path.join(root, "spaced.js"), "function f() {\n    return 1;\n}\n");

  return root;
}

function open(t) {
  return createState(makeRepo(t), "review", COLUMNS);
}

function press(state, keys) {
  return keys.split("").reduce((current, key) => reduce(current, key, VIEWPORT), state);
}

/** How many rows of the selected file's diff are lines rather than headings. */
function lineRows(state) {
  return state.rows.filter((row) => row.kind === "line" || row.kind === "pair").length;
}

function paths(state) {
  return state.files.map((file) => file.newPath || file.oldPath);
}

// --- how much of the file comes with the change ---------------------------------

test("a pane opens with the three lines git would have given it", (t) => {
  const state = open(t);

  assert.strictEqual(state.diffContext, 3);
  // The changed line, three above, three below, and its removed twin
  assert.ok(lineRows(state) < 12, "the pane opened wider than git's default");
});

test("+ shows more of the file around the change", (t) => {
  const state = open(t);
  const before = lineRows(state);
  const wider = press(state, "+");

  assert.ok(lineRows(wider) > before, "widening showed no more of the file");
  assert.strictEqual(wider.diffContext, 6);
  assert.match(wider.message, /Context: 6 lines/);
});

test("+ enough times reaches the whole file", (t) => {
  const whole = press(open(t), "++++++++");

  assert.strictEqual(whole.diffContext, WHOLE_FILE);
  assert.match(whole.message, /whole file/);
  // Every line of the file is on screen, plus the line that was removed
  assert.ok(lineRows(whole) >= 21, "the whole file is not there");
});

test("- narrows to the change and nothing around it", (t) => {
  const bare = press(open(t), "-");

  assert.strictEqual(bare.diffContext, 0);
  assert.match(bare.message, /no context/);
  // The rows are the selected file's alone: one line removed, one added, nothing else
  assert.strictEqual(lineRows(bare), 2);
});

test("- at the bottom stays there rather than going negative", (t) => {
  const bare = press(open(t), "--");

  assert.strictEqual(bare.diffContext, 0);
});

// --- whitespace -------------------------------------------------------------------

test("= drops a file whose only change is its indentation", (t) => {
  const state = open(t);
  assert.ok(paths(state).includes("spaced.js"), "the fixture is wrong");

  const ignoring = press(state, "=");

  assert.strictEqual(ignoring.ignoreWhitespace, true);
  assert.ok(!paths(ignoring).includes("spaced.js"), "the reindented file is still there");
  assert.ok(paths(ignoring).includes("a.js"), "the real change went with it");
  assert.match(ignoring.message, /Ignoring whitespace/);
});

test("= again counts it as a change once more", (t) => {
  const back = press(open(t), "==");

  assert.strictEqual(back.ignoreWhitespace, false);
  assert.ok(paths(back).includes("spaced.js"));
  assert.match(back.message, /Counting whitespace again/);
});

// --- the settings stay set ---------------------------------------------------------

test("a reload asks git for the same diff the reader had", (t) => {
  // Reload runs the same code path as the watch and as coming back from the editor,
  // and a reload that quietly went back to three lines of context would be worse than
  // no key at all
  const wide = press(open(t), "++=");
  const reloaded = press(wide, "r");

  assert.strictEqual(reloaded.diffContext, wide.diffContext);
  assert.strictEqual(reloaded.ignoreWhitespace, true);
  assert.ok(!paths(reloaded).includes("spaced.js"), "the reload brought the reindent back");
});

// --- and say so ---------------------------------------------------------------------

test("the header says what the diff was computed with", (t) => {
  // The message that announced it fades after four seconds, and a diff hiding every
  // whitespace change is not one to be left holding without knowing
  const state = press(open(t), "+=");
  const { subtitle } = toScreenModel(state);

  assert.match(subtitle, /context 6 lines/);
  assert.match(subtitle, /ignoring whitespace/);
});

test("the header says nothing when nothing was changed", (t) => {
  const { subtitle } = toScreenModel(open(t));

  assert.doesNotMatch(subtitle, /context/);
  assert.doesNotMatch(subtitle, /whitespace/);
});

// --- where they work ------------------------------------------------------------------

test("the keys answer wherever the reader is in the diff view", (t) => {
  const state = open(t);

  assert.strictEqual(press(state, "+").diffContext, 6);
  assert.strictEqual(press(state, "jjj+").diffContext, 6);
});
