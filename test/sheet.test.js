"use strict";

// Every comment written so far, in one list — and the list `S` opens on the way out.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const { createState, reduce, toScreenModel } = require("../lib/app-state");
const { CHOSEN_MARK, UNCHOSEN_MARK, sheetPreview } = require("../lib/state/views/sheet");

const COLUMNS = 120;
const VIEWPORT = 20;

function makeRepo(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "herdr-deep-code-reading-sheet-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  execFileSync("git", ["init", "-q"], { cwd: root, stdio: "ignore" });
  fs.writeFileSync(path.join(root, "a.js"), "one\ntwo\nthree\n");
  execFileSync("git", ["add", "-A"], { cwd: root, stdio: "ignore" });
  execFileSync(
    "git",
    ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init"],
    { cwd: root, stdio: "ignore" }
  );
  fs.writeFileSync(path.join(root, "a.js"), "ONE\nTWO\nTHREE\n");

  return root;
}

function press(state, keys) {
  return keys.reduce((current, key) => reduce(current, key, VIEWPORT), state);
}

/** A state carrying two comments, written the way a reader writes them. */
function withComments(t) {
  const state = createState(makeRepo(t), "review", COLUMNS);
  const first = press(state, ["j", "c", ..."first".split(""), "enter"]);
  return press(first, ["j", "c", ..."second".split(""), "enter"]);
}

function labels(state) {
  return state.rows.filter((row) => row.kind === "hit").map((row) => row.hit.label);
}

// --- looking through them -----------------------------------------------------------

test('" opens the list of what has been written', (t) => {
  const state = press(withComments(t), ['"']);

  assert.strictEqual(state.view, "comments");
  assert.strictEqual(state.sheet.sending, false);
  assert.strictEqual(labels(state).length, 2);
  assert.match(toScreenModel(state).title, /comments {2}\(2\)/);
});

test("a list opened to look through chooses nothing", (t) => {
  // Nothing is being sent, so a column of boxes would be asking a question nobody
  // is about to answer
  const state = press(withComments(t), ['"']);

  for (const label of labels(state)) {
    assert.doesNotMatch(label, /\[/);
  }
});

test("Enter goes to the comment, which is what the list is for", (t) => {
  const state = press(withComments(t), ['"', "enter"]);

  assert.strictEqual(state.view, "read");
  assert.strictEqual(state.openPath, "a.js");
});

test('" with nothing written says so rather than opening an empty list', (t) => {
  const state = press(createState(makeRepo(t), "review", COLUMNS), ['"']);

  assert.notStrictEqual(state.view, "comments");
  assert.match(state.message, /comment/i);
});

// --- sending ---------------------------------------------------------------------------

test("S opens the same list with everything chosen", (t) => {
  const state = press(withComments(t), ["S"]);

  assert.strictEqual(state.view, "comments");
  assert.strictEqual(state.sheet.sending, true);
  assert.deepStrictEqual(state.sheet.excluded, []);
  for (const label of labels(state)) {
    assert.ok(label.startsWith(CHOSEN_MARK), label);
  }
});

test("Enter sends the chosen ones, which is one keystroke more than it was", (t) => {
  const sent = press(withComments(t), ["S", "enter"]);

  assert.strictEqual(sent.effect.type, "send");
  assert.strictEqual(sent.effect.comments.length, 2);
  assert.strictEqual(sent.sheet, null);
});

test("space leaves one out, and the title counts what is left", (t) => {
  const state = press(withComments(t), ["S", " "]);

  assert.deepStrictEqual(state.sheet.excluded, [0]);
  assert.ok(labels(state)[0].startsWith(UNCHOSEN_MARK));
  assert.ok(labels(state)[1].startsWith(CHOSEN_MARK));
  assert.match(toScreenModel(state).title, /send {2}\(1 of 2 comments\)/);
});

test("what is left out is left out of the batch", (t) => {
  const chosen = press(withComments(t), ["S", " "]);

  assert.doesNotMatch(sheetPreview(chosen), /first/);
  assert.match(sheetPreview(chosen), /second/);

  const sent = reduce(chosen, "enter", VIEWPORT);
  assert.strictEqual(sent.effect.comments.length, 1);
});

test("space puts one back", (t) => {
  const state = press(withComments(t), ["S", " ", " "]);

  assert.deepStrictEqual(state.sheet.excluded, []);
});

test("leaving everything out sends nothing, and says so", (t) => {
  const state = press(withComments(t), ["S", " ", "j", " ", "enter"]);

  assert.strictEqual(state.effect, null);
  assert.match(state.message, /Nothing chosen/);
});

test("Esc leaves the batch unsent and the comments where they were", (t) => {
  const before = withComments(t);
  const back = press(before, ["S", "escape"]);

  assert.strictEqual(back.effect, null);
  assert.strictEqual(back.comments.length, 2);
  assert.notStrictEqual(back.view, "comments");
});

test("the comments are still there after a send, as they always were", (t) => {
  const sent = press(withComments(t), ["S", "enter"]);

  assert.strictEqual(sent.comments.length, 2);
});

// --- taking one away ---------------------------------------------------------------------

test("x deletes the comment under the cursor, from where it can be read", (t) => {
  // `x` in the diff deletes a paragraph from a screen showing one line of it
  const state = press(withComments(t), ['"', "x"]);

  assert.strictEqual(state.comments.length, 1);
  assert.strictEqual(labels(state).length, 1);
  assert.match(state.message, /Comment deleted/);
});

test("deleting the last one closes the list rather than leaving it empty", (t) => {
  const state = press(withComments(t), ['"', "x", "x"]);

  assert.deepStrictEqual(state.comments, []);
  assert.strictEqual(state.sheet, null);
});

test("a deletion renumbers what was left out, rather than shifting it onto a neighbour", (t) => {
  // The exclusions are indexes into the comment list, and the list just got shorter
  const state = press(withComments(t), ["S", "j", " ", "g", "x"]);

  assert.strictEqual(state.comments.length, 1);
  assert.deepStrictEqual(state.sheet.excluded, [0], "the survivor lost its box");
  assert.ok(labels(state)[0].startsWith(UNCHOSEN_MARK));
});

// --- the footer says which list this is ------------------------------------------------

test("the footer names the key Enter is, in each of the two", (t) => {
  const looking = toScreenModel(press(withComments(t), ['"'])).help;
  const sending = toScreenModel(press(withComments(t), ["S"])).help;

  assert.match(looking, /go to the comment/);
  assert.doesNotMatch(looking, /space choose/);
  assert.match(sending, /space choose/);
  assert.match(sending, /send the chosen/);
});
