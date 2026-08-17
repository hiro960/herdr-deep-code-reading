"use strict";

// Where things go when Herdr did not say where.
//
// Every store — bookmarks, read marks, notes — and the exported review itself are
// written under $HERDR_PLUGIN_STATE_DIR, which Herdr gives the pane. Run from a shell
// without one, they used to fall back to the temporary directory itself under a fixed
// name. On a Linux host that directory is shared with every other account on the
// machine, and what is written there is not nothing: a bookmark names a path inside
// somebody's repository, and the exported review quotes the code it is about.
//
// A predictable name in a shared directory is two problems at once. Anyone can read
// it, and anyone can leave a symlink waiting under that name for the write to follow.
// A directory of the plugin's own, owned and reachable by one account, answers both.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { loadEntries, saveEntries, stateDirectory, storePathFor } = require("../lib/store");
const { EXPORT_FILENAME, writeComments } = require("../lib/run/effects");

const DIRECTORY_MODE = 0o700;
const FILE_MODE = 0o600;
const PERMISSION_BITS = 0o777;

function tempDir(t, prefix) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), `herdr-deep-code-reading-${prefix}-`));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

/** Set one variable for the length of a test, and put it back afterwards. */
function withEnv(t, name, value) {
  const had = Object.prototype.hasOwnProperty.call(process.env, name);
  const was = process.env[name];

  t.after(() => {
    if (had) {
      process.env[name] = was;
    } else {
      delete process.env[name];
    }
  });

  process.env[name] = value;
}

function modeOf(target) {
  return fs.statSync(target).mode & PERMISSION_BITS;
}

test("the state directory is the one the pane was given", () => {
  assert.strictEqual(stateDirectory({ HERDR_PLUGIN_STATE_DIR: "/state" }), "/state");
  assert.strictEqual(storePathFor({ HERDR_PLUGIN_STATE_DIR: "/state" }, "a.json"), "/state/a.json");
});

test("without one it is a directory of the plugin's own, not the shared temp directory", () => {
  const fallback = stateDirectory({});

  assert.notStrictEqual(fallback, os.tmpdir());
  assert.strictEqual(path.dirname(fallback), os.tmpdir());
  // Named for the account it belongs to, so two users on one host do not meet in it
  assert.ok(
    path.basename(fallback).startsWith("herdr-deep-code-reading-"),
    `${fallback} is not named for this plugin`
  );
});

test("a store the plugin creates is readable by nobody else", (t) => {
  const parent = tempDir(t, "store");
  const directory = path.join(parent, "state");
  const file = path.join(directory, "bookmarks.json");

  const saved = saveEntries(file, "/repo", [{ path: "a.js", line: 1 }]);

  assert.deepStrictEqual(saved, { ok: true });
  assert.strictEqual(modeOf(directory), DIRECTORY_MODE);
  assert.strictEqual(modeOf(file), FILE_MODE);
  assert.strictEqual(loadEntries(file, "/repo", () => true).length, 1);
});

test("an exported review is written into the plugin's own directory, readable by nobody else", (t) => {
  const parent = tempDir(t, "export");
  // os.tmpdir() reads the environment on every call, so this moves the fallback
  // somewhere the test owns rather than writing into the real temporary directory
  withEnv(t, "TMPDIR", parent);
  withEnv(t, "TMP", parent);
  withEnv(t, "TEMP", parent);
  const previous = process.env.HERDR_PLUGIN_STATE_DIR;
  delete process.env.HERDR_PLUGIN_STATE_DIR;
  t.after(() => {
    if (previous !== undefined) {
      process.env.HERDR_PLUGIN_STATE_DIR = previous;
    }
  });

  const written = writeComments("### a.js:1\n\nwhy one?\n", EXPORT_FILENAME);

  assert.ok(written.ok, written.error);
  assert.strictEqual(path.dirname(path.dirname(written.path)), parent);
  assert.strictEqual(modeOf(written.path), FILE_MODE);
  assert.strictEqual(modeOf(path.dirname(written.path)), DIRECTORY_MODE);
});
