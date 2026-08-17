"use strict";

// Showing what is on screen in the desktop's own file manager.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const { DARWIN, LINUX, containingDirectory, revealCommand, unsupportedMessage } =
  require("../lib/reveal");
const { createState, reduce } = require("../lib/app-state");
const { resolveInsideRepo } = require("../lib/file-view");

const VIEWPORT = 20;
const COLUMNS = 179;

// --- what to run, per platform ----------------------------------------------

test("macOS opens a directory and reveals a file", () => {
  // The difference is what a reader means by each: revealing a directory would
  // show its parent with the directory selected, which is not "open this folder"
  assert.deepStrictEqual(revealCommand(DARWIN, "/repo/lib", true), {
    command: "open",
    args: ["/repo/lib"],
  });
  assert.deepStrictEqual(revealCommand(DARWIN, "/repo/lib/a.js", false), {
    command: "open",
    args: ["-R", "/repo/lib/a.js"],
  });
});

test("Linux opens the directory either way", () => {
  // xdg-open has no reveal, and opening the file itself would launch an editor
  assert.deepStrictEqual(revealCommand(LINUX, "/repo/lib", true), {
    command: "xdg-open",
    args: ["/repo/lib"],
  });
  assert.deepStrictEqual(revealCommand(LINUX, "/repo/lib/a.js", false), {
    command: "xdg-open",
    args: ["/repo/lib"],
  });
});

test("says nothing to run where it knows no file manager", () => {
  assert.strictEqual(revealCommand("win32", "/repo", true), null);
  assert.match(unsupportedMessage("win32"), /win32/);
});

test("passes the path as an argument rather than a command line", () => {
  // A repository can hold a file named anything at all; a path is never a string
  // a shell gets to read
  const nasty = "/repo/lib/$(rm -rf ~) 'x'.js";
  const { args } = revealCommand(DARWIN, nasty, false);

  assert.deepStrictEqual(args, ["-R", nasty]);
});

test("finds the directory holding a file", () => {
  assert.strictEqual(containingDirectory("/repo/lib/a.js"), "/repo/lib");
  assert.strictEqual(containingDirectory("/a.js"), ".");
});

// --- what may be handed to the file manager ---------------------------------

test("refuses to show anything outside the repository", (t) => {
  // git tracks symlinks, so a repository can carry one pointing anywhere on the
  // machine. Nothing is read on the way to Finder, but what gets opened is the
  // same question — the path goes through the check every read goes through.
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "herdr-deep-code-reading-escape-"));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));

  const outside = path.join(base, "outside");
  const repo = path.join(base, "repo");
  fs.mkdirSync(outside);
  fs.mkdirSync(repo);
  fs.writeFileSync(path.join(outside, "secret.txt"), "secret\n");
  fs.symlinkSync("../outside", path.join(repo, "escape"));
  fs.writeFileSync(path.join(repo, "a.js"), "const a = 1;\n");

  for (const target of ["escape", "escape/secret.txt", "../outside", "/etc"]) {
    const result = resolveInsideRepo(repo, target);
    assert.strictEqual(result.ok, false, `${target} was allowed through`);
  }

  // What is genuinely inside still goes through
  assert.strictEqual(resolveInsideRepo(repo, "a.js").ok, true);
  assert.strictEqual(resolveInsideRepo(repo, "").ok, true);
});

// --- what each view asks to be shown ----------------------------------------

function run(cwd, args) {
  execFileSync("git", args, { cwd, stdio: "ignore" });
}

function makeRepo(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "herdr-deep-code-reading-reveal-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  run(root, ["init", "-q"]);
  fs.mkdirSync(path.join(root, "lib"), { recursive: true });
  fs.writeFileSync(path.join(root, "lib", "a.js"), "const needle = 1;\n");
  fs.writeFileSync(path.join(root, "lib", "b.js"), "const b = 2;\n");
  run(root, ["add", "-A"]);
  run(root, ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init"]);
  fs.writeFileSync(path.join(root, "lib", "a.js"), "const needle = 99;\n");

  return root;
}

function press(state, keys) {
  return keys.reduce((current, key) => reduce(current, key, VIEWPORT), state);
}

test("the browser asks for the entry under the selection", (t) => {
  const root = makeRepo(t);
  const inLib = press(createState(root, "files", COLUMNS), ["l"]);
  assert.strictEqual(inLib.browse.dir, "lib");

  assert.deepStrictEqual(reduce(inLib, "O", VIEWPORT).effect, {
    type: "reveal",
    path: "lib/a.js",
  });
});

test("the browser asks for the directory when it is empty", (t) => {
  const root = makeRepo(t);
  const filtered = press(createState(root, "files", COLUMNS), ["l", "f", "z", "z", "z"]);
  assert.strictEqual(filtered.browse.entries.length, 0);

  assert.deepStrictEqual(reduce({ ...filtered, input: null }, "O", VIEWPORT).effect, {
    type: "reveal",
    path: "lib",
  });
});

test("the reader asks for the file it has open", (t) => {
  const root = makeRepo(t);
  const reading = press(createState(root, "files", COLUMNS), ["l", "l"]);
  assert.strictEqual(reading.view, "read");

  assert.strictEqual(reduce(reading, "O", VIEWPORT).effect.path, reading.openPath);
});

test("the diff asks for the file the panel names", (t) => {
  const root = makeRepo(t);
  const state = createState(root, "review", COLUMNS);

  assert.deepStrictEqual(reduce(state, "O", VIEWPORT).effect, {
    type: "reveal",
    path: "lib/a.js",
  });
});

test("a list asks for the place under the cursor", (t) => {
  const root = makeRepo(t);
  const searched = press(createState(root, "files", COLUMNS), [
    "/", "n", "e", "e", "d", "l", "e", "enter",
  ]);
  assert.strictEqual(searched.view, "search");

  assert.strictEqual(reduce(searched, "O", VIEWPORT).effect.path, "lib/a.js");
});

test("says so rather than asking for nothing", (t) => {
  const root = makeRepo(t);
  const searched = press(createState(root, "files", COLUMNS), [
    "/", "z", "z", "z", "z", "enter",
  ]);
  // No hits, so the cursor is on the "No matches" note
  const asked = reduce(searched, "O", VIEWPORT);

  assert.strictEqual(asked.effect, null);
  assert.match(asked.message, /Nothing here/);
});

test("the repository root is what the root of the browser points at", (t) => {
  const root = makeRepo(t);
  const atRoot = createState(root, "files", COLUMNS);
  // The only entry is lib/, so an empty listing is what leaves the directory itself
  const emptied = { ...atRoot, browse: { ...atRoot.browse, entries: [] } };

  assert.strictEqual(reduce(emptied, "O", VIEWPORT).effect.path, "");
});
