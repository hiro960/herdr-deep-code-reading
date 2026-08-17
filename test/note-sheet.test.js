"use strict";

// Reading what the agent answered.
//
// A note has been marked in the gutter with `◆` since notes existed, and that is the
// whole of what a reader could see of it: the text was written to the store, and no
// key on any screen put it in front of anybody. Two keys answer that. `&` lists every
// note there is, and `K` — the key that already answers "what is this, where I am" —
// reads out the one on the line under the cursor.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const { createState, reduce, toScreenModel } = require("../lib/app-state");
const { saveNotes } = require("../lib/notes");

const COLUMNS = 120;
const VIEWPORT = 20;

function makeRepo(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "herdr-deep-code-reading-note-sheet-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  execFileSync("git", ["init", "-q"], { cwd: root, stdio: "ignore" });
  fs.writeFileSync(path.join(root, "a.js"), "one\ntwo\nthree\n");
  fs.writeFileSync(path.join(root, "b.js"), "const helper = 1;\n");
  execFileSync("git", ["add", "-A"], { cwd: root, stdio: "ignore" });
  execFileSync(
    "git",
    ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init"],
    { cwd: root, stdio: "ignore" }
  );

  // Outside the repository, where the real one lives: a store inside it would be an
  // untracked file the browser lists, and `l` would open it instead of the code
  const state = fs.mkdtempSync(path.join(os.tmpdir(), "herdr-deep-code-reading-note-store-"));
  t.after(() => fs.rmSync(state, { recursive: true, force: true }));

  return { root, notes: path.join(state, "notes.json") };
}

function press(state, keys) {
  return keys.reduce((current, key) => reduce(current, key, VIEWPORT), state);
}

/** A pane on the file browser, with these notes already written. */
function opened(t, entries, mode) {
  const { root, notes } = makeRepo(t);
  saveNotes(notes, root, entries);

  return createState(root, mode || "files", COLUMNS, { notesFile: notes });
}

const ONE_NOTE = [{ path: "a.js", line: 2, text: "the second line", from: "claude" }];

// --- the list ---------------------------------------------------------------------

test("& lists every note there is", (t) => {
  const state = opened(t, [
    { path: "a.js", line: 2, text: "the second line", from: "claude" },
    { path: "b.js", line: 1, text: "a helper", from: "claude" },
  ]);

  const listed = reduce(state, "&", VIEWPORT);

  assert.match(toScreenModel(listed).title, /notes\s+\(2\)/);
  assert.deepStrictEqual(
    listed.hits.map((hit) => `${hit.path}:${hit.line}`),
    ["a.js:2", "b.js:1"]
  );
});

test("a row says what was answered, and who answered it", (t) => {
  const listed = reduce(opened(t, ONE_NOTE), "&", VIEWPORT);

  assert.match(listed.hits[0].text, /the second line/);
  assert.match(listed.hits[0].text, /claude/);
});

test("a note of several lines shows its first in the list", (t) => {
  const listed = reduce(
    opened(t, [{ path: "a.js", line: 1, text: "what it does\nand when", from: "claude" }]),
    "&",
    VIEWPORT
  );

  assert.match(listed.hits[0].text, /what it does/);
  assert.doesNotMatch(listed.hits[0].text, /and when/, "a list row is one row");
});

test("Enter goes to the line the note is about", (t) => {
  const listed = reduce(opened(t, ONE_NOTE), "&", VIEWPORT);

  const there = reduce(listed, "enter", VIEWPORT);

  assert.strictEqual(there.openPath, "a.js");
  assert.strictEqual(there.rows[there.cursor].cell.num, 2);
});

test("Esc comes back from it, the way it does from every other list", (t) => {
  const state = opened(t, ONE_NOTE);

  const back = press(state, ["&", "escape"]);

  assert.strictEqual(back.view, state.view);
});

test("no notes is said rather than shown as an empty list", (t) => {
  const state = opened(t, []);

  const nothing = reduce(state, "&", VIEWPORT);

  assert.strictEqual(nothing.view, state.view);
  assert.match(nothing.message, /no notes/i);
});

test("every view offers it, because a note is about the repository rather than a screen", (t) => {
  for (const mode of ["review", "files", "log"]) {
    const state = opened(t, ONE_NOTE, mode);
    assert.match(toScreenModel(state).help, /&/, `${mode}: the footer does not offer it`);
  }
});

// --- reading one out ----------------------------------------------------------------

test("K reads out the note on the line under the cursor", (t) => {
  const state = press(opened(t, ONE_NOTE), ["l", "j"]);
  assert.strictEqual(state.openPath, "a.js");
  assert.strictEqual(state.rows[state.cursor].cell.num, 2, "on the line the note is about");

  const peeked = reduce(state, "K", VIEWPORT);

  assert.ok(peeked.peek, "nothing was shown");
  assert.match(peeked.peek.title, /a\.js:2/);
  assert.ok(
    peeked.peek.rows.some((row) => row.text.includes("the second line")),
    "the note is not in what was shown"
  );
});

test("a note of several lines is several rows", (t) => {
  const notes = [{ path: "a.js", line: 1, text: "what it does\n\nand when it does it", from: "claude" }];
  const state = press(opened(t, notes), ["l"]);

  const peeked = reduce(state, "K", VIEWPORT);

  assert.ok(peeked.peek.rows.some((row) => row.text.includes("what it does")));
  assert.ok(peeked.peek.rows.some((row) => row.text.includes("and when it does it")));
});

test("a line with no note still peeks at the definition", (t) => {
  // The key keeps its old meaning where there is nothing newer to say
  const state = press(opened(t, ONE_NOTE), ["j", "l"]);
  assert.strictEqual(state.openPath, "b.js");

  const peeked = press(state, ["w", "K"]);

  assert.ok(peeked.peek === null || !peeked.peek.title.includes("claude"));
});

test("two notes on one line are both read out", (t) => {
  const notes = [
    { path: "a.js", line: 1, text: "first answer", from: "claude" },
    { path: "a.js", line: 1, text: "second answer", from: "you" },
  ];
  const state = press(opened(t, notes), ["l"]);

  const peeked = reduce(state, "K", VIEWPORT);

  const shown = peeked.peek.rows.map((row) => row.text).join("\n");
  assert.match(shown, /first answer/);
  assert.match(shown, /second answer/);
});

test("K in the list reads out the note the cursor is on", (t) => {
  const notes = [{ path: "a.js", line: 2, text: "a long answer\nover two lines", from: "claude" }];

  const peeked = press(opened(t, notes), ["&", "K"]);

  assert.ok(peeked.peek, "the list had nothing to show");
  assert.ok(peeked.peek.rows.some((row) => row.text.includes("over two lines")));
});

test("the next key puts it away, the way a peeked definition goes", (t) => {
  const peeked = press(opened(t, ONE_NOTE), ["l", "j", "K"]);
  assert.ok(peeked.peek);

  assert.strictEqual(reduce(peeked, "j", VIEWPORT).peek, null);
});
