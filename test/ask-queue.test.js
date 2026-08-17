"use strict";

// Asking several things at once.
//
// `@` sent one question the moment it was typed, which is the wrong shape for the
// reading it exists for: a reader works down a file with five things they do not
// understand, and stopping to send each one is five round trips through somebody
// else's pane. They go on the same list `S` sends, and go out together — which is
// what lets the reader carry on reading while the answers arrive.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const { createState, reduce, toScreenModel } = require("../lib/app-state");
const { formatBatch } = require("../lib/comments");
const { rescueComments } = require("../lib/run/effects");
const { sheetPreview } = require("../lib/state/views/sheet");

const COLUMNS = 120;
const VIEWPORT = 20;

function makeRepo(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "herdr-deep-code-reading-ask-queue-"));
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

  const state = fs.mkdtempSync(path.join(os.tmpdir(), "herdr-deep-code-reading-ask-store-"));
  t.after(() => fs.rmSync(state, { recursive: true, force: true }));

  return { root, notes: path.join(state, "notes.json") };
}

function press(state, keys) {
  return keys.reduce((current, key) => reduce(current, key, VIEWPORT), state);
}

function opened(t) {
  const { root, notes } = makeRepo(t);
  return press(createState(root, "review", COLUMNS, { notesFile: notes }), ["j"]);
}

/** Type a question about the line under the cursor and accept it. */
function ask(state, text) {
  return reduce(press(reduce(state, "@", VIEWPORT), Array.from(text)), "enter", VIEWPORT);
}

/** Write a comment on the line under the cursor. */
function comment(state, text) {
  return reduce(press(reduce(state, "c", VIEWPORT), Array.from(text)), "enter", VIEWPORT);
}

// --- asking puts it on the list ------------------------------------------------------

test("a question is kept rather than sent the moment it is typed", (t) => {
  const asked = ask(opened(t), "why is this here?");

  assert.strictEqual(asked.effect, null, "nothing went out");
  assert.strictEqual(asked.input, null);
  assert.strictEqual(asked.comments.length, 1);
  assert.strictEqual(asked.comments[0].kind, "question");
  assert.strictEqual(asked.comments[0].text, "why is this here?");
});

test("five questions are five entries, and the footer counts them", (t) => {
  let state = opened(t);
  for (const text of ["one?", "two?", "three?"]) {
    state = ask(state, text);
  }

  assert.strictEqual(state.comments.length, 3);
  assert.match(state.message, /3/);
});

test("an empty question is still not a question", (t) => {
  const state = opened(t);

  const away = reduce(reduce(state, "@", VIEWPORT), "enter", VIEWPORT);

  assert.strictEqual(away.input, null);
  assert.strictEqual(away.comments.length, 0);
});

test("a question carries the lines it is about, the way a comment does", (t) => {
  const asked = ask(opened(t), "why?");
  const [question] = asked.comments;

  assert.strictEqual(question.file, "a.js");
  assert.ok(question.lines.length > 0);
  assert.ok(question.start >= 1);
});

// --- the list they share -------------------------------------------------------------

test("questions and comments are one list, and one send", (t) => {
  const state = comment(ask(opened(t), "why?"), "this could be simpler");

  const listed = reduce(state, '"', VIEWPORT);

  assert.strictEqual(listed.hits.length, 2);
  assert.match(toScreenModel(listed).title, /2/);
});

test("a question says it is one, so a list of both can be read", (t) => {
  const state = comment(ask(opened(t), "why?"), "simpler");

  const listed = reduce(state, '"', VIEWPORT);
  const labels = listed.hits.map((hit) => hit.label).join("\n");

  assert.match(labels, /\?/, "nothing on the row says which of the two it is");
});

test("S sends both together", (t) => {
  const state = comment(ask(opened(t), "why is this here?"), "this could be simpler");

  const sent = press(state, ["S", "enter"]);

  assert.strictEqual(sent.effect.type, "send");
  assert.strictEqual(sent.effect.comments.length, 2);
});

test("one of them can be left out of the batch", (t) => {
  const state = comment(ask(opened(t), "why?"), "simpler");

  const sent = press(state, ["S", " ", "enter"]);

  assert.strictEqual(sent.effect.comments.length, 1);
});

// --- what goes out ---------------------------------------------------------------------

test("the batch asks the questions and reviews the comments, in one message", (t) => {
  const state = comment(ask(opened(t), "why is this here?"), "this could be simpler");

  const batch = sheetPreview(press(state, ["S"]));

  assert.match(batch, /Code review/);
  assert.match(batch, /this could be simpler/);
  assert.match(batch, /why is this here\?/);
  assert.match(batch, /question/i);
});

test("every question carries its own reply command, because one command is one note", (t) => {
  let state = opened(t);
  state = ask(state, "first?");
  state = ask(press(state, ["j"]), "second?");

  const batch = formatBatch(state.comments);
  const commands = batch.split("\n").filter((line) => line.startsWith("node "));

  assert.strictEqual(commands.length, 2, "bin/note.js writes one note per run");
  assert.ok(commands[0] !== commands[1], "both point at the same line");
});

test("a batch of comments alone is exactly what it always was", (t) => {
  const state = comment(opened(t), "this could be simpler");

  const batch = formatBatch(state.comments);

  assert.match(batch, /^Code review: 1 comment\./);
  assert.ok(!batch.includes("node "), "nothing to answer, so no command to answer with");
});

test("sending questions turns the watch on, because the answers arrive on their own", (t) => {
  const state = ask(opened(t), "why?");

  const sent = press(state, ["S", "enter"]);

  assert.strictEqual(sent.watching, true);
});

test("sending comments alone leaves the watch as it was", (t) => {
  const state = comment(opened(t), "simpler");

  const sent = press(state, ["S", "enter"]);

  assert.notStrictEqual(sent.watching, true);
});

// --- they are as unsent as a comment is --------------------------------------------------

test("Q asks before discarding an unsent question", (t) => {
  const state = ask(opened(t), "why?");

  const asked = reduce(state, "Q", VIEWPORT);

  assert.notStrictEqual(asked.quit, true);
  assert.match(asked.message, /unsent/i);
  assert.match(asked.message, /question/);
});

test("the subtitle counts questions apart from comments", (t) => {
  const state = comment(ask(opened(t), "why?"), "simpler");

  assert.match(toScreenModel(state).subtitle, /1 comment/);
  assert.match(toScreenModel(state).subtitle, /1 question/);
});

test("a crash saves the questions with the comments", () => {
  const said = rescueComments([
    { kind: "question", file: "a.js", side: "new", start: 1, end: 1, lines: ["+x"], text: "why?" },
  ]);

  assert.match(said, /1 unsent/);
});
