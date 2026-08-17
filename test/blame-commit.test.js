"use strict";

// Opening the commit a blame line names.
//
// `B` answers "when did this line last change" with a sha and a date, which is half an
// answer: the other half is in the commit, and there was no key that went there. `H`
// lists the whole file's commits, which is a different question — the reader is
// pointing at one line and one commit.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const { createState, helpText, reduce } = require("../lib/app-state");
const { shaOfLabel } = require("../lib/blame");

const COLUMNS = 120;
const VIEWPORT = 20;
const GIT_IDENTITY = ["-c", "user.email=t@t", "-c", "user.name=t"];

function run(cwd, args) {
  execFileSync("git", args, { cwd, stdio: "ignore" });
}

function makeRepo(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "herdr-deep-code-reading-blamed-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const store = fs.mkdtempSync(path.join(os.tmpdir(), "herdr-deep-code-reading-blamed-store-"));
  t.after(() => fs.rmSync(store, { recursive: true, force: true }));

  run(root, ["init", "-q", "-b", "main"]);
  fs.writeFileSync(path.join(root, "a.js"), "const first = 1;\n");
  run(root, ["add", "-A"]);
  run(root, [...GIT_IDENTITY, "commit", "-qm", "the first line"]);

  fs.writeFileSync(path.join(root, "a.js"), "const first = 1;\nconst second = 2;\n");
  run(root, ["add", "-A"]);
  run(root, [...GIT_IDENTITY, "commit", "-qm", "the second line"]);

  return { root, journalFile: path.join(store, "journal.json") };
}

function press(state, keys) {
  return keys.reduce((current, key) => reduce(current, key, VIEWPORT), state);
}

/** a.js open in the reader, with the cursor on a line and blame however asked for. */
function reading(t, { blame, line }) {
  const { root, journalFile } = makeRepo(t);
  const opened = press(createState(root, "files", COLUMNS, { journalFile }), ["l"]);
  assert.strictEqual(opened.openPath, "a.js");

  const traced = blame === false ? opened : reduce(opened, "B", VIEWPORT);
  const at = traced.rows.findIndex((row) => row.kind === "line" && row.cell.num === line);
  assert.notStrictEqual(at, -1, `the fixture has no line ${line}`);

  return { ...traced, cursor: at };
}

// --- reading the sha off a label ---------------------------------------------

test("a label names the commit it opens with", () => {
  assert.strictEqual(shaOfLabel("1a2b3c4 2026-08-18"), "1a2b3c4");
});

test("a label is only a sha where it looks like one", () => {
  // The blame column is the only place a sha reaches a git argument from, and what it
  // was parsed out of came from a repository somebody else wrote
  assert.strictEqual(shaOfLabel("--upload-pack=sh 2026-08-18"), null);
  assert.strictEqual(shaOfLabel("zzzzzzz 2026-08-18"), null);
  assert.strictEqual(shaOfLabel(""), null);
  assert.strictEqual(shaOfLabel(undefined), null);
});

// --- the key -----------------------------------------------------------------

test("C opens the commit the line under the cursor came from", (t) => {
  const traced = reading(t, { blame: true, line: 2 });

  const opened = reduce(traced, "C", VIEWPORT);

  assert.strictEqual(opened.view, "diff");
  assert.strictEqual(opened.mode, "commit");
  assert.match(opened.title, /the second line/);
});

test("a different line opens a different commit", (t) => {
  const traced = reading(t, { blame: true, line: 1 });

  assert.match(reduce(traced, "C", VIEWPORT).title, /the first line/);
});

test("the commit it opens is on the record of what has been read", (t) => {
  const traced = reading(t, { blame: true, line: 2 });

  const opened = reduce(traced, "C", VIEWPORT);

  assert.strictEqual(opened.journal.length, 2, "the file and the commit");
  assert.strictEqual(opened.journal[1].kind, "commit");
  assert.strictEqual(opened.journal[1].subject, "the second line");
});

test("Ctrl+O comes back to the file it was pressed in", (t) => {
  const traced = reading(t, { blame: true, line: 2 });

  const back = press(traced, ["C", "ctrl-o"]);

  assert.strictEqual(back.view, "read");
  assert.strictEqual(back.openPath, "a.js");
});

test("without the column there is no line's commit, and it says so", (t) => {
  const plain = reading(t, { blame: false, line: 2 });

  const pressed = reduce(plain, "C", VIEWPORT);

  assert.strictEqual(pressed.view, "read");
  assert.match(pressed.message, /B/);
});

// --- the footer --------------------------------------------------------------

test("the footer offers it only while the column is on", (t) => {
  assert.ok(!helpText(reading(t, { blame: false, line: 2 })).includes("C commit"));
  assert.ok(helpText(reading(t, { blame: true, line: 2 })).includes("C commit"));
});
