"use strict";

// Handing the open file to the reader's own editor, and coming back to it.
//
// The spawning belongs to bin/review.js; what is checked here is the state either
// side of it — which file and line are asked for, and where the reader is put back.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const { createState, reduce, reloadedInPlace, toScreenModel } = require("../lib/app-state");

const VIEWPORT = 20;
const COLUMNS = 179;
const GIT_IDENTITY = ["-c", "user.email=test@example.com", "-c", "user.name=herdr-deep-code-reading test"];

function run(cwd, args) {
  execFileSync("git", args, { cwd, stdio: "ignore" });
}

function makeRepo(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "herdr-deep-code-reading-edit-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  run(root, ["init", "-q"]);
  fs.mkdirSync(path.join(root, "lib"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "lib", "a.js"),
    Array.from({ length: 20 }, (_, line) => `const line${line} = ${line};`).join("\n") + "\n"
  );
  run(root, ["add", "-A"]);
  run(root, [...GIT_IDENTITY, "commit", "-qm", "init"]);

  return root;
}

function press(state, keys) {
  return keys.reduce((current, key) => reduce(current, key, VIEWPORT), state);
}

/** Open lib/a.js in the reading view. */
function reading(root) {
  const state = press(createState(root, "files", COLUMNS), ["l", "l"]);
  assert.strictEqual(state.view, "read");
  assert.strictEqual(state.openPath, "lib/a.js");
  return state;
}

// --- asking for the editor --------------------------------------------------

test("E asks for the open file to be edited", (t) => {
  const root = makeRepo(t);

  const asked = reduce(reading(root), "E", VIEWPORT);

  assert.deepStrictEqual(asked.effect, { type: "edit", path: "lib/a.js", line: 1 });
});

test("the line asked for is the one under the cursor", (t) => {
  const root = makeRepo(t);

  const asked = press(reading(root), ["j", "j", "j", "E"]);

  assert.strictEqual(asked.effect.line, 4);
});

test("the reading view's footer offers it", (t) => {
  const root = makeRepo(t);

  assert.match(toScreenModel(reading(root)).help, /E edit/);
});

test("the diff view does not bind it", (t) => {
  // Editing is scoped to the file the reader has open. A diff is a view of two
  // versions at once, and half its lines are not lines of any file on disk.
  const root = makeRepo(t);
  const diff = createState(root, "review", COLUMNS);

  assert.strictEqual(reduce(diff, "E", VIEWPORT), diff);
  assert.doesNotMatch(toScreenModel(diff).help, /E edit/);
});

test("the browser does not bind it either", (t) => {
  const root = makeRepo(t);
  const browse = createState(root, "files", COLUMNS);

  assert.strictEqual(reduce(browse, "E", VIEWPORT), browse);
});

// --- coming back ------------------------------------------------------------

test("a reload after editing keeps the reader in the file, on the line", (t) => {
  const root = makeRepo(t);
  const atLine = press(reading(root), ["j", "j", "j", "j"]);
  assert.strictEqual(atLine.rows[atLine.cursor].cell.num, 5);

  // What an editor would have done while the pane was hidden
  fs.writeFileSync(path.join(root, "lib", "a.js"), "edited\n".repeat(20));

  const back = reloadedInPlace(atLine, null);

  assert.strictEqual(back.view, "read");
  assert.strictEqual(back.openPath, "lib/a.js");
  assert.strictEqual(back.rows[back.cursor].cell.num, 5);
  assert.strictEqual(back.rows[back.cursor].cell.text, "edited");
});

test("the reload picks up the change the editor made to the diff", (t) => {
  const root = makeRepo(t);
  const before = reading(root);
  assert.strictEqual(before.files.length, 0, "the fixture starts with a clean tree");

  fs.writeFileSync(path.join(root, "lib", "a.js"), "edited\n");
  const back = reloadedInPlace(before, null);

  assert.strictEqual(back.files.length, 1, "the edited file is not in the reloaded diff");
});

test("a reader past the new end of the file is put at the top, not off it", (t) => {
  const root = makeRepo(t);
  const atEnd = press(reading(root), ["G"]);

  fs.writeFileSync(path.join(root, "lib", "a.js"), "one line only\n");
  const back = reloadedInPlace(atEnd, null);

  assert.ok(back.cursor < back.rows.length, "the cursor is off the end of the rows");
});

test("a reload from a result list leaves the list alone", (t) => {
  // The diff behind it is refreshed; the hits the reader is looking at are not
  // the diff's rows and must survive
  const root = makeRepo(t);
  const searched = press(createState(root, "files", COLUMNS), ["/", "l", "i", "n", "e", "enter"]);
  assert.strictEqual(searched.view, "search");

  const back = reloadedInPlace(searched, null);

  assert.strictEqual(back.rows, searched.rows);
  assert.strictEqual(back.cursor, searched.cursor);
});

// --- the spawn itself -------------------------------------------------------

const { editFile } = require("../bin/review.js");

// The pane's screen handling, replaced with nothing. The real one resumes stdin,
// which would leave the test runner holding an open handle.
const NO_SCREEN = { leave: () => {}, enter: () => {} };

/**
 * An executable standing in for $EDITOR.
 * It lives outside the repository: an untracked file inside one is a change, and
 * these tests are counting the changes the editor made.
 */
function fakeEditor(t, script) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "herdr-deep-code-reading-editor-"));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));

  const bin = path.join(home, "fake-editor");
  fs.writeFileSync(bin, "#!/bin/sh\n" + script, { mode: 0o755 });

  const before = { VISUAL: process.env.VISUAL, EDITOR: process.env.EDITOR };
  delete process.env.VISUAL;
  process.env.EDITOR = bin;
  t.after(() => {
    process.env.VISUAL = before.VISUAL;
    process.env.EDITOR = before.EDITOR;
    if (before.VISUAL === undefined) {
      delete process.env.VISUAL;
    }
    if (before.EDITOR === undefined) {
      delete process.env.EDITOR;
    }
  });

  return bin;
}

test("the editor is run, and what it wrote is on screen afterwards", (t) => {
  const root = makeRepo(t);
  // $1 is the path: an unknown editor is given the file and nothing else
  fakeEditor(t, 'echo "written by the editor" > "$1"\n');
  const state = reading(root);

  const back = editFile(state, { type: "edit", path: "lib/a.js", line: 1 }, NO_SCREEN);

  assert.strictEqual(back.rows[0].cell.text, "written by the editor");
  assert.strictEqual(back.effect, null);
  assert.match(back.message, /Edited lib\/a\.js/);
});

test("the edit shows up in the diff behind the reader", (t) => {
  const root = makeRepo(t);
  fakeEditor(t, 'echo "changed" > "$1"\n');
  const state = reading(root);
  assert.strictEqual(state.files.length, 0);

  const back = editFile(state, { type: "edit", path: "lib/a.js", line: 1 }, NO_SCREEN);

  assert.strictEqual(back.files.length, 1);
});

test("the editor is given the file's real path", (t) => {
  const root = makeRepo(t);
  const record = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "herdr-deep-code-reading-argv-")), "argv");
  fakeEditor(t, `printf '%s\\n' "$@" > ${JSON.stringify(record)}\n`);

  editFile(reading(root), { type: "edit", path: "lib/a.js", line: 7 }, NO_SCREEN);

  const argv = fs.readFileSync(record, "utf8").trim().split("\n");
  assert.strictEqual(argv.length, 1, `an unknown editor gets only the path: ${argv.join(" ")}`);
  assert.strictEqual(fs.realpathSync(argv[0]), fs.realpathSync(path.join(root, "lib", "a.js")));
});

test("an editor that is not installed is reported, not thrown", (t) => {
  const root = makeRepo(t);
  const state = reading(root);
  const before = process.env.EDITOR;
  process.env.EDITOR = "definitely-not-an-editor-on-this-machine";
  t.after(() => {
    if (before === undefined) {
      delete process.env.EDITOR;
    } else {
      process.env.EDITOR = before;
    }
  });

  const back = editFile(state, { type: "edit", path: "lib/a.js", line: 1 }, NO_SCREEN);

  assert.match(back.message, /Could not run definitely-not-an-editor-on-this-machine: not found/);
  assert.strictEqual(back.effect, null);
});

test("a path outside the repository is refused before anything is run", (t) => {
  const root = makeRepo(t);
  fakeEditor(t, 'echo "should never run" > "$1"\n');

  const back = editFile(reading(root), { type: "edit", path: "../escape.js", line: 1 }, NO_SCREEN);

  assert.match(back.message, /Cannot read|outside the repository/);
});
