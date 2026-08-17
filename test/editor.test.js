"use strict";

// Handing a file to the reader's own editor. Which editor, and how it is told which
// line to open on — the spawning itself belongs to bin/review.js.

const test = require("node:test");
const assert = require("node:assert");

const { DEFAULT_EDITOR, editorInvocation, editorName } = require("../lib/editor");

// --- which editor -----------------------------------------------------------

test("falls back to vi when nothing is set", () => {
  const invocation = editorInvocation({}, "lib/a.js", 1);

  assert.strictEqual(invocation.command, DEFAULT_EDITOR);
});

test("prefers VISUAL over EDITOR", () => {
  // VISUAL names the full-screen editor, which is the one a terminal pane can hand
  // its screen to; EDITOR may be a line editor
  const env = { VISUAL: "nvim", EDITOR: "ed" };

  assert.strictEqual(editorInvocation(env, "lib/a.js", 1).command, "nvim");
});

test("prefers the plugin's own setting over both", () => {
  // The config file's `editor` reaches here as HERDR_DEEP_CODE_READING_EDITOR. It is how a reader
  // names an editor for this pane without changing what every other program opens.
  const env = { HERDR_DEEP_CODE_READING_EDITOR: "hx", VISUAL: "nvim", EDITOR: "ed" };

  assert.strictEqual(editorInvocation(env, "lib/a.js", 1).command, "hx");
});

test("the plugin's own setting carries its arguments too", () => {
  const env = { HERDR_DEEP_CODE_READING_EDITOR: "code -w", EDITOR: "vi" };
  const invocation = editorInvocation(env, "lib/a.js", 12);

  assert.strictEqual(invocation.command, "code");
  assert.ok(invocation.args.includes("-w"), "the waiting flag was dropped");
});

test("an empty plugin setting steps aside for the shell's", () => {
  assert.strictEqual(
    editorInvocation({ HERDR_DEEP_CODE_READING_EDITOR: "  ", VISUAL: "nvim" }, "a.js", 1).command,
    "nvim"
  );
});

test("ignores a variable set to nothing but spaces", () => {
  assert.strictEqual(editorInvocation({ EDITOR: "   " }, "lib/a.js", 1).command, DEFAULT_EDITOR);
  assert.strictEqual(editorInvocation({ VISUAL: "", EDITOR: "vim" }, "a.js", 1).command, "vim");
});

test("keeps the arguments an editor was set with", () => {
  // `code -w` is how a GUI editor is made to block, and dropping the flag would
  // have the pane redraw over a window the reader is still typing in
  const invocation = editorInvocation({ EDITOR: "code -w" }, "lib/a.js", 12);

  assert.strictEqual(invocation.command, "code");
  assert.deepStrictEqual(invocation.args, ["-w", "--goto", "lib/a.js:12"]);
});

test("reads the editor's name past the directories of its path", () => {
  assert.strictEqual(editorName("/usr/local/bin/nvim"), "nvim");
  assert.strictEqual(editorName("nvim"), "nvim");
});

test("an editor given by its full path still gets its line", () => {
  const invocation = editorInvocation({ EDITOR: "/usr/bin/vim" }, "lib/a.js", 9);

  assert.deepStrictEqual(invocation.args, ["+9", "lib/a.js"]);
});

// --- how the line is passed -------------------------------------------------

test("passes the line as +N to the editors that take one", () => {
  for (const name of ["vi", "vim", "nvim", "nano", "emacs", "kak", "micro"]) {
    assert.deepStrictEqual(
      editorInvocation({ EDITOR: name }, "lib/a.js", 42).args,
      ["+42", "lib/a.js"],
      name
    );
  }
});

test("appends the line to the path for the editors that read it there", () => {
  for (const name of ["hx", "helix", "subl", "zed"]) {
    assert.deepStrictEqual(
      editorInvocation({ EDITOR: name }, "lib/a.js", 42).args,
      ["lib/a.js:42"],
      name
    );
  }
});

test("uses --goto for the VS Code family", () => {
  for (const name of ["code", "codium", "cursor"]) {
    assert.deepStrictEqual(
      editorInvocation({ EDITOR: name }, "lib/a.js", 42).args,
      ["--goto", "lib/a.js:42"],
      name
    );
  }
});

test("opens an unknown editor at the top of the file", () => {
  // The file is what was asked for; the line is a convenience, and guessing a
  // syntax an editor does not have would hand it an argument it reads as a path
  const invocation = editorInvocation({ EDITOR: "acme" }, "lib/a.js", 42);

  assert.deepStrictEqual(invocation.args, ["lib/a.js"]);
});

test("leaves the line out when there is not one worth passing", () => {
  for (const line of [0, -1, null, undefined, 1.5, NaN]) {
    assert.deepStrictEqual(
      editorInvocation({ EDITOR: "vim" }, "lib/a.js", line).args,
      ["lib/a.js"],
      String(line)
    );
  }
});
