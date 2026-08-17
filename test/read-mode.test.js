"use strict";

// Reading a file's contents and reading its diff are the same view, toggled.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const { createState, reduce, toScreenModel } = require("../lib/app-state");

const VIEWPORT = 20;

function makeRepo(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "herdr-deep-code-reading-readmode-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  execFileSync("git", ["init", "-q"], { cwd: root, stdio: "ignore" });
  fs.writeFileSync(path.join(root, "a.txt"), "one\ntwo\nthree\n");
  fs.writeFileSync(path.join(root, "untouched.txt"), "same\n");
  execFileSync("git", ["add", "-A"], { cwd: root, stdio: "ignore" });
  execFileSync(
    "git",
    ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init"],
    { cwd: root, stdio: "ignore" }
  );

  // a.txt now differs from HEAD; untouched.txt does not
  fs.writeFileSync(path.join(root, "a.txt"), "one\nTWO\nthree\n");

  return root;
}

/** Open the browser and read the first file. */
function openFirstFile(root, keys) {
  const state = createState(root, "files", 179);
  return (keys || ["l"]).reduce((current, key) => reduce(current, key, VIEWPORT), state);
}

test("opens a file on its contents", (t) => {
  const root = makeRepo(t);

  const state = openFirstFile(root);

  assert.strictEqual(state.view, "read");
  assert.deepStrictEqual(
    state.rows.map((row) => row.cell.text),
    ["one", "TWO", "three"]
  );
});

test("shows the file's own diff after the toggle", (t) => {
  const root = makeRepo(t);

  const state = openFirstFile(root, ["l", "tab"]);

  // A hunk header proves this is a diff rather than the file's lines
  assert.strictEqual(state.rows[0].kind, "hunk");
  assert.ok(state.rows.some((row) => row.kind === "pair" || row.kind === "line"));
});

test("returns to the contents on a second toggle", (t) => {
  const root = makeRepo(t);

  const state = openFirstFile(root, ["l", "tab", "tab"]);

  assert.deepStrictEqual(
    state.rows.map((row) => row.cell.text),
    ["one", "TWO", "three"]
  );
});

test("says so when the open file has no changes", (t) => {
  const root = makeRepo(t);

  // a.txt is first, untouched.txt second
  const state = openFirstFile(root, ["j", "l", "tab"]);

  assert.strictEqual(state.rows.length, 1);
  assert.strictEqual(state.rows[0].kind, "note");
  assert.match(state.rows[0].text, /No changes/);
});

test("keeps the comment anchored to the open file in diff mode", (t) => {
  const root = makeRepo(t);

  const state = openFirstFile(root, ["l", "tab", "j", "c"]);

  assert.notStrictEqual(state.input, null);
  assert.strictEqual(state.input.file, "a.txt");
});

test("previews the diff too once the toggle is on", (t) => {
  const root = makeRepo(t);
  // Toggle from the browser, without opening a file
  const state = reduce(createState(root, "files", 179), "tab", VIEWPORT);

  const model = toScreenModel(state);

  assert.ok(model.preview.some((row) => row.kind === "hunk"));
});

test("leaves the toggle alone when a directory is selected", (t) => {
  const root = makeRepo(t);
  const state = reduce(createState(root, "files", 179), "tab", VIEWPORT);

  assert.strictEqual(state.readMode, "diff");
});
