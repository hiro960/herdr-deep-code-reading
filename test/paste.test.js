"use strict";

// Text pasted into a field, newlines and all.
//
// A terminal sends a paste as the characters it holds, and a newline among them is the
// same byte the Enter key sends. So a commit message pasted in three lines used to be
// one line committed and two lines of keystrokes run against whatever came next.
//
// Bracketed paste is the way out: the terminal is asked to wrap a paste in markers, and
// what arrives between them is text rather than keys. It arrives as one key of its own
// so that a field can take it whole and every other screen can ignore it — a pasted `D`
// in the browser must not arm the delete it names.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const { ESC, screen } = require("../lib/ansi");
const { decodeKeys, pastedText } = require("../lib/input");
const { createState, reduce } = require("../lib/app-state");

const COLUMNS = 160;
const VIEWPORT = 20;
const START = ESC + "[200~";
const END = ESC + "[201~";

function makeRepo(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "herdr-deep-code-reading-paste-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: root, stdio: "ignore" });
  fs.writeFileSync(path.join(root, "a.js"), "one\n");
  execFileSync("git", ["add", "-A"], { cwd: root, stdio: "ignore" });
  return root;
}

function press(state, keys) {
  return keys.reduce((current, key) => reduce(current, key, VIEWPORT), state);
}

// --- reading a paste off the wire --------------------------------------------

test("a paste is one key, whatever it holds", () => {
  const { keys, pasting } = decodeKeys(START + "hello" + END, false);

  assert.strictEqual(keys.length, 1);
  assert.strictEqual(pastedText(keys[0]), "hello");
  assert.strictEqual(pasting, false);
});

test("the newlines in a paste are text rather than Enter", () => {
  const { keys } = decodeKeys(START + "subject\n\nbody\n" + END, false);

  assert.strictEqual(pastedText(keys[0]), "subject\n\nbody\n");
});

test("keys either side of a paste are still keys", () => {
  const { keys } = decodeKeys("j" + START + "x" + END + "k", false);

  assert.strictEqual(keys.length, 3);
  assert.strictEqual(keys[0], "j");
  assert.strictEqual(pastedText(keys[1]), "x");
  assert.strictEqual(keys[2], "k");
});

test("a paste too big for one chunk is carried across them", () => {
  // stdin does not promise to deliver a paste whole, and the tail of one arriving as
  // keystrokes is the bug this exists to fix, only later
  const first = decodeKeys(START + "one\ntwo", false);
  assert.strictEqual(first.pasting, true);
  assert.strictEqual(pastedText(first.keys[0]), "one\ntwo");

  const second = decodeKeys("\nthree" + END + "j", true);
  assert.strictEqual(second.pasting, false);
  assert.strictEqual(pastedText(second.keys[0]), "\nthree");
  assert.strictEqual(second.keys[1], "j");
});

test("what a paste carries is text, not an escape to obey", () => {
  // The escape byte is stripped the way it is from everything else drawn here; what
  // was around it stays, because it is what somebody copied
  const { keys } = decodeKeys(START + "ab" + ESC + "[Ac" + END, false);

  assert.strictEqual(pastedText(keys[0]), "ab[Ac");
  assert.strictEqual(keys.length, 1, "something in the paste was read as a key");
});

test("an ordinary chunk is decoded as it always was", () => {
  const { keys, pasting } = decodeKeys("jk" + ESC + "[A", false);

  assert.deepStrictEqual(keys, ["j", "k", "up"]);
  assert.strictEqual(pasting, false);
});

test("a key that is not a paste says so", () => {
  assert.strictEqual(pastedText("j"), null);
  assert.strictEqual(pastedText("enter"), null);
});

// --- what a field does with one ----------------------------------------------

/** The one key a chunk of pasted text decodes to. */
function paste(text) {
  return decodeKeys(START + text + END, false).keys[0];
}

test("a commit message keeps every line of what was pasted", (t) => {
  const writing = press(createState(makeRepo(t), "review", COLUMNS), ["C"]);
  assert.strictEqual(writing.input.kind, "commit");

  const pasted = reduce(writing, paste("subject\n\nbody line\nand another"), VIEWPORT);

  assert.strictEqual(pasted.input.text, "subject\n\nbody line\nand another");
});

test("a paste lands where the typing left off", (t) => {
  const writing = press(createState(makeRepo(t), "review", COLUMNS), ["C", "f", "i", "x", ":", " "]);

  const pasted = reduce(writing, paste("one\ntwo"), VIEWPORT);

  assert.strictEqual(pasted.input.text, "fix: one\ntwo");
});

test("a field that is one line by nature takes the text without the breaks", (t) => {
  // A filter with a newline in it matches nothing, which is not what was meant
  const browsing = press(createState(makeRepo(t), "files", COLUMNS), ["f"]);
  assert.strictEqual(browsing.input.kind, "filter");

  const pasted = reduce(browsing, paste("a\nb"), VIEWPORT);

  assert.strictEqual(pasted.input.text, "ab");
});

test("a comment takes a pasted paragraph whole", (t) => {
  const writing = press(createState(makeRepo(t), "review", COLUMNS), ["c"]);

  assert.strictEqual(reduce(writing, paste("why\nnot"), VIEWPORT).input.text, "why\nnot");
});

// --- and what every other screen does -----------------------------------------

test("a paste with no field open does nothing at all", (t) => {
  // `D` in the browser arms a delete. A paste that happens to hold one must not.
  const browsing = createState(makeRepo(t), "files", COLUMNS);

  const pasted = reduce(browsing, paste("DDqqq"), VIEWPORT);

  assert.strictEqual(pasted.pendingDelete, false);
  assert.strictEqual(pasted.quit, false);
  assert.strictEqual(pasted.view, "browse");
});

// --- asking the terminal for them ---------------------------------------------

test("the terminal is asked for bracketed paste, and told to stop", () => {
  assert.strictEqual(screen.enableBracketedPaste, ESC + "[?2004h");
  assert.strictEqual(screen.disableBracketedPaste, ESC + "[?2004l");
});
