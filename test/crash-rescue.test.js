"use strict";

// Comments live for the session, so the session ending badly is the one way a whole
// review disappears. Quitting already asks before discarding them; these cover the
// two ways out that never asked — a key that throws, and an error nobody caught.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  CRASH_FILENAME,
  EXPORT_FILENAME,
  applyKey,
  rescueComments,
} = require("../bin/review");

const VIEWPORT_UNUSED = 20;

function makeStateDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "herdr-deep-code-reading-rescue-"));
  const previous = process.env.HERDR_PLUGIN_STATE_DIR;
  process.env.HERDR_PLUGIN_STATE_DIR = dir;

  t.after(() => {
    if (previous === undefined) {
      delete process.env.HERDR_PLUGIN_STATE_DIR;
    } else {
      process.env.HERDR_PLUGIN_STATE_DIR = previous;
    }
    fs.rmSync(dir, { recursive: true, force: true });
  });

  return dir;
}

function comment(text) {
  return { file: "a.js", side: "new", start: 1, end: 1, lines: ["+one"], text };
}

/**
 * A state whose rows hold a hit nothing can open.
 * A path that is not a string is exactly the kind of thing that reaches a `path`
 * call and throws where nobody was expecting one.
 */
function stateWithABadHit(comments) {
  return {
    repoDir: "/nonexistent",
    mode: "review",
    view: "search",
    rows: [{ kind: "hit", hit: { path: null, line: 1, text: "" } }],
    hits: [{ path: null, line: 1, text: "" }],
    files: [],
    fileSummaries: [],
    selectedIndex: 0,
    cursor: 0,
    scroll: 0,
    column: 0,
    columns: 100,
    sideBySide: false,
    readMode: "content",
    focus: "diff",
    selectionAnchor: null,
    browse: null,
    openPath: null,
    history: [],
    comments,
    input: null,
    picker: null,
    message: null,
    effect: null,
    pendingQuit: false,
    quit: false,
    title: "t",
    branch: "main",
  };
}

test("a key that throws leaves the pane standing and says so", () => {
  // Arrange
  const state = stateWithABadHit([]);

  // Act
  const next = applyKey(state, "enter", null, VIEWPORT_UNUSED);

  // Assert
  assert.ok(next.message, "the footer says nothing about the failure");
  assert.strictEqual(next.quit, false);
});

test("a key that throws keeps every comment written so far", () => {
  // Arrange
  const comments = [comment("first"), comment("second")];
  const state = stateWithABadHit(comments);

  // Act
  const next = applyKey(state, "enter", null, VIEWPORT_UNUSED);

  // Assert
  assert.deepStrictEqual(next.comments, comments);
});

test("a key that throws leaves the reader where they were", () => {
  // Arrange
  const state = stateWithABadHit([]);

  // Act
  const next = applyKey(state, "enter", null, VIEWPORT_UNUSED);

  // Assert
  assert.strictEqual(next.view, "search");
  assert.strictEqual(next.cursor, state.cursor);
});

test("an ordinary key still goes through applyKey untouched", () => {
  // Arrange
  const state = stateWithABadHit([]);

  // Act: j on a one-row list clamps to the row it is already on
  const next = applyKey(state, "j", null, VIEWPORT_UNUSED);

  // Assert
  assert.strictEqual(next.cursor, 0);
  assert.strictEqual(next.message, null);
});

test("a crash writes the unsent comments where they can be found", (t) => {
  // Arrange
  const dir = makeStateDir(t);

  // Act
  const said = rescueComments([comment("keep me")]);

  // Assert
  const written = fs.readFileSync(path.join(dir, CRASH_FILENAME), "utf8");
  assert.match(written, /keep me/);
  assert.match(said, new RegExp(CRASH_FILENAME));
});

test("a crash does not overwrite comments the reviewer exported on purpose", (t) => {
  // Arrange: an earlier "no agent found" export is already on disk
  const dir = makeStateDir(t);
  const exported = path.join(dir, EXPORT_FILENAME);
  fs.writeFileSync(exported, "the batch the reviewer meant to keep");

  // Act
  rescueComments([comment("whatever was in hand when it broke")]);

  // Assert
  assert.strictEqual(fs.readFileSync(exported, "utf8"), "the batch the reviewer meant to keep");
  assert.notStrictEqual(CRASH_FILENAME, EXPORT_FILENAME);
});

test("a crash with nothing written says nothing", (t) => {
  // Arrange
  const dir = makeStateDir(t);

  // Act
  const said = rescueComments([]);

  // Assert
  assert.strictEqual(said, "");
  assert.strictEqual(fs.existsSync(path.join(dir, CRASH_FILENAME)), false);
});

test("a crash that cannot write says that too, rather than nothing", (t) => {
  // Arrange: a state directory that cannot be created
  const previous = process.env.HERDR_PLUGIN_STATE_DIR;
  const blocked = path.join(os.tmpdir(), `herdr-deep-code-reading-blocked-${process.pid}`);
  fs.writeFileSync(blocked, "not a directory");
  process.env.HERDR_PLUGIN_STATE_DIR = path.join(blocked, "under-a-file");
  t.after(() => {
    if (previous === undefined) {
      delete process.env.HERDR_PLUGIN_STATE_DIR;
    } else {
      process.env.HERDR_PLUGIN_STATE_DIR = previous;
    }
    fs.rmSync(blocked, { force: true });
  });

  // Act
  const said = rescueComments([comment("lost")]);

  // Assert
  assert.match(said, /could not be saved/);
});
