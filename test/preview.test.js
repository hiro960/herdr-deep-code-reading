"use strict";

// The preview column must show the level below, directories included.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const { reduce, toScreenModel } = require("../lib/app-state");
const { createState } = require("../lib/app-state");

function makeNestedRepo(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "herdr-deep-code-reading-preview-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  execFileSync("git", ["init", "-q"], { cwd: root, stdio: "ignore" });
  fs.mkdirSync(path.join(root, "src", "ui"), { recursive: true });
  fs.writeFileSync(path.join(root, "README.md"), "readme\n");
  fs.writeFileSync(path.join(root, "src", "index.js"), "const a = 1;\n");
  fs.writeFileSync(path.join(root, "src", "ui", "Icon.js"), "const icon = 2;\n");

  execFileSync("git", ["add", "-A"], { cwd: root, stdio: "ignore" });
  execFileSync(
    "git",
    ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init"],
    { cwd: root, stdio: "ignore" }
  );

  return root;
}

const VIEWPORT = 20;

test("previews the contents of the selected directory", (t) => {
  // Arrange: the browser opens at the root with "src" among the entries
  const root = makeNestedRepo(t);
  const state = createState(root, "files", 179);

  // Act: the first entry is the src directory
  const model = toScreenModel(state);

  // Assert: its children are previewed rather than an empty column
  assert.ok(model.preview, "the preview column is empty");
  assert.deepStrictEqual(
    model.preview.map((row) => row.entry.name),
    ["ui", "index.js"]
  );
});

test("marks a previewed directory apart from a previewed file", (t) => {
  const root = makeNestedRepo(t);
  const model = toScreenModel(createState(root, "files", 179));

  assert.strictEqual(model.preview[0].kind, "entry");
  assert.strictEqual(model.preview[0].entry.isDirectory, true);
  assert.strictEqual(model.preview[1].entry.isDirectory, false);
});

test("previews a file's contents once the selection moves off the directory", (t) => {
  const root = makeNestedRepo(t);
  const state = reduce(createState(root, "files", 179), "j", VIEWPORT);

  const model = toScreenModel(state);

  assert.strictEqual(model.preview[0].kind, "line");
  assert.strictEqual(model.preview[0].cell.text, "readme");
});

test("previews the next level down after stepping into a directory", (t) => {
  const root = makeNestedRepo(t);
  const state = reduce(createState(root, "files", 179), "l", VIEWPORT);

  const model = toScreenModel(state);

  // Inside src, the selection is the ui directory, so ui's contents show
  assert.deepStrictEqual(
    model.preview.map((row) => row.entry.name),
    ["Icon.js"]
  );
});
