"use strict";

// A commit message is a subject and, often, a body explaining it.
//
// The field at the foot of the screen is one row, so a line break needs a key of its
// own — the same one a comment uses, for the same reason. Enter still commits,
// because one line is the common case.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const { helpText } = require("../lib/screen-model");
const { createState, reduce } = require("../lib/app-state");
const { renderScreen } = require("../lib/render");
const { applyKey } = require("../bin/review");
const { displayWidth } = require("../lib/text");

const GIT_IDENTITY = ["-c", "user.email=t@t", "-c", "user.name=t"];
const COLUMNS = 100;
const VIEWPORT = 20;

const SGR = /\[[0-9;]*m/g;
const POSITION = /\[\d+;\d+H/g;
const ERASE = /\[0K/g;
const HOME = /\[H/g;

function run(cwd, args) {
  execFileSync("git", args, { cwd, stdio: "ignore" });
}

/** A repository with one staged change, ready to commit. */
function makeRepo(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "herdr-deep-code-reading-commit-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  run(root, ["init", "-q"]);
  // Written into the repository rather than passed with -c, because the commit these
  // tests are about is made by lib/git-write rather than from here. A machine with no
  // identity of its own — every CI runner — has git refuse it outright otherwise, and
  // a reader whose own git signs every commit would be asked for a key by the suite.
  // test/git-write.test.js sets the same three, for the same reason.
  run(root, ["config", "commit.gpgsign", "false"]);
  run(root, ["config", "user.email", "test@example.com"]);
  run(root, ["config", "user.name", "herdr-deep-code-reading test"]);

  fs.writeFileSync(path.join(root, "a.txt"), "one\n");
  run(root, ["add", "."]);
  run(root, [...GIT_IDENTITY, "commit", "-qm", "init"]);

  fs.writeFileSync(path.join(root, "a.txt"), "one\ntwo\n");
  run(root, ["add", "."]);

  return root;
}

/** Type a string into whatever field is open. */
function type(state, text) {
  return [...text].reduce((current, key) => reduce(current, key, VIEWPORT), state);
}

/** Type several lines, breaking between them the way the reviewer would. */
function typeLines(state, lines) {
  return lines.reduce(
    (current, line, index) =>
      type(index === 0 ? current : reduce(current, "ctrl-d", VIEWPORT), line),
    state
  );
}

/** A state with only the parts the input editor reads. */
function composing(text) {
  return { input: { kind: "commit", text }, comments: [], rows: [], cursor: 0 };
}

test("Ctrl+D starts a new line in a commit message", () => {
  // Act
  const broken = reduce(composing("subject"), "ctrl-d", VIEWPORT);

  // Assert
  assert.strictEqual(broken.input.text, "subject\n");
});

test("goes on typing after the line break", () => {
  // Act
  const written = type(reduce(composing("subject"), "ctrl-d", VIEWPORT), "body");

  // Assert
  assert.strictEqual(written.input.text, "subject\nbody");
});

test("the footer names the key", () => {
  // Act
  const footer = helpText({ input: { kind: "commit" }, picker: null });

  // Assert: a key nobody is shown is a key nobody presses
  assert.match(footer, /Ctrl\+D new line/);
  assert.match(footer, /Enter commit/);
});

test("Enter still commits rather than adding a line", () => {
  // Act
  const accepted = reduce(composing("subject\n\nbody"), "enter", VIEWPORT);

  // Assert
  assert.strictEqual(accepted.input, null);
  assert.strictEqual(accepted.effect.type, "commit");
  assert.strictEqual(accepted.effect.message, "subject\n\nbody");
});

test("a message of nothing but blank lines is still refused", () => {
  // Act
  const accepted = reduce(composing("\n\n  \n"), "enter", VIEWPORT);

  // Assert
  assert.strictEqual(accepted.effect, null);
  assert.match(accepted.message, /no message/);
});

test("a filter takes Ctrl+D as nothing, having no use for a second line", () => {
  // Arrange: a newline in a query is text nothing could match
  const filtering = { input: { kind: "filter", text: "views" }, comments: [], rows: [], cursor: 0 };

  // Act
  const after = reduce(filtering, "ctrl-d", VIEWPORT);

  // Assert
  assert.strictEqual(after.input.text, "views");
});

test("commits the subject and the body git records them as", (t) => {
  // Arrange: a blank line between them, which is what makes the rest a body
  const root = makeRepo(t);
  const opened = reduce(createState(root, "review", COLUMNS), "C", VIEWPORT);
  const written = typeLines(opened, ["add two", "", "why it matters"]);
  assert.strictEqual(written.input.text, "add two\n\nwhy it matters");

  // Act
  const committed = applyKey(written, "enter", null, VIEWPORT);

  // Assert
  const subject = execFileSync("git", ["log", "-1", "--format=%s"], { cwd: root, encoding: "utf8" });
  const body = execFileSync("git", ["log", "-1", "--format=%b"], { cwd: root, encoding: "utf8" });
  assert.strictEqual(subject.trim(), "add two");
  assert.strictEqual(body.trim(), "why it matters");
  assert.strictEqual(committed.effect, null);
});

test("says what it committed on one row of the footer", (t) => {
  // Arrange: the footer has one row for a message, and a body written into it would
  // push every row of the diff below it down by however many lines were typed
  const root = makeRepo(t);
  const opened = reduce(createState(root, "review", COLUMNS), "C", VIEWPORT);
  const written = typeLines(opened, ["add two", "", "why it matters"]);

  // Act
  const committed = applyKey(written, "enter", null, VIEWPORT);

  // Assert
  assert.ok(committed.message, "nothing was reported");
  assert.ok(
    !committed.message.includes("\n"),
    `the footer message runs to more than one line: ${JSON.stringify(committed.message)}`
  );
  assert.match(committed.message, /add two/);
  assert.ok(!committed.message.includes("why it matters"), "the body reached the footer");
});

test("a frame keeps every row the terminal's width whatever a message carries", () => {
  // Arrange: nothing should be able to put a line break into a drawn row
  const model = {
    title: "t",
    subtitle: "s",
    files: [],
    selectedIndex: 0,
    sideBySide: false,
    rows: [],
    scroll: 0,
    cursor: 0,
    focus: "diff",
    commentKeys: new Set(),
    selection: null,
    word: null,
    cursorActive: true,
    input: null,
    picker: null,
    view: "diff",
    browse: null,
    preview: null,
    openPath: null,
    help: "j/k move  q quit",
    message: "Committed: subject\nand a body\tand a tab",
  };

  // Act
  const rows = renderScreen(model, { columns: 60, rows: 8 })
    .replace(SGR, "")
    .replace(HOME, "")
    .replace(ERASE, "")
    .split(POSITION)
    .filter((row) => row !== "");

  // Assert
  assert.strictEqual(rows.length, 8);
  for (const row of rows) {
    assert.strictEqual(displayWidth(row), 60, `a row came out ${displayWidth(row)} wide`);
  }
});
