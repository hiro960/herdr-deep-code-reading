"use strict";

// Which editor to hand a file to, and how to tell it which line.
//
// This is yazi's bargain, and it is the right one: yazi has no editor of its own.
// Its preview column is drawn by yazi, and opening a file runs the `[opener]` rule
// for it — `${EDITOR:-vi} "$@"` with `block = true`, which hides yazi to a secondary
// screen and gives the main one to the editor until it exits. The reading view here
// is already more than yazi's preview: it has comments, an outline, and a definition
// jump. What it is not, and should not become, is an editor. Writing a modal editor
// would be a second program living inside this one, and the reader already has the
// editor they want configured.
//
// So this module answers two questions and performs nothing. bin/review.js does the
// leaving and re-entering of the screen, because that is where the terminal lives.
//
// Nothing here writes to a file either. The plugin's promise is that it changes the
// repository only through git; running the reader's own editor does not break it,
// because the editor is the reader's, launched at their keystroke, writing under
// their hands.

const path = require("node:path");

// What vi is on every system this runs on, and what $EDITOR falls back to by
// long convention.
const DEFAULT_EDITOR = "vi";

// Three ways of naming a line, which between them cover the editors people set
// $EDITOR to. An editor in none of them is opened at the top of the file: guessing
// a syntax it does not have would hand it an argument it reads as a second path,
// and being in the right file beats being in the wrong one at the right line.

/** `editor +N path` */
const PLUS_LINE = new Set([
  "vi", "vim", "nvim", "view", "vimdiff", "gvim", "mvim",
  "nano", "pico", "emacs", "emacsclient", "kak", "micro", "joe", "jed",
]);

/** `editor path:N` */
const PATH_LINE = new Set(["hx", "helix", "subl", "sublime_text", "zed"]);

/** `editor --goto path:N` */
const GOTO_LINE = new Set(["code", "code-insiders", "codium", "vscodium", "cursor", "windsurf"]);

const GOTO_FLAG = "--goto";

/**
 * The editor's own name, past any directories it was given with.
 * $EDITOR is often a full path — /usr/local/bin/nvim — and the tables above are
 * keyed by what the program is called.
 */
function editorName(command) {
  return path.basename(command);
}

/**
 * The words the editor was named in.
 *
 * Any of the three may carry arguments — `code -w` is how a GUI editor is made to
 * wait, and dropping the flag would have the pane redraw over a window still being
 * typed in — so the value is split rather than used whole. Splitting on whitespace
 * means an editor whose path contains a space cannot be named this way; naming a
 * wrapper script is the way round that, and is what a shell would need anyway.
 *
 * $HERDR_DEEP_CODE_READING_EDITOR comes first, and is how the plugin's own config file names one:
 * a reader whose $EDITOR is a line editor, or whose windowed editor needs a waiting
 * flag only here, has somewhere to say so that does not follow them into every other
 * program. Then $VISUAL, which is the one that names a full-screen editor and so the
 * one a pane can hand its screen to, and only then $EDITOR, which may be a line editor.
 */
function editorWords(env) {
  const configured = [env.HERDR_DEEP_CODE_READING_EDITOR, env.VISUAL, env.EDITOR].find(
    (value) => typeof value === "string" && value.trim() !== ""
  );
  return configured === undefined ? [DEFAULT_EDITOR] : configured.trim().split(/\s+/);
}

/** Whether a line number is one an editor could be sent to. */
function isRealLine(line) {
  return Number.isInteger(line) && line > 0;
}

/**
 * The command and arguments that open a file in the reader's editor.
 *
 * @param {object} env Environment to read $VISUAL and $EDITOR from
 * @param {string} filePath The file to open, as the editor should receive it
 * @param {number} [line] 1-based line to land on; omitted or unusable opens the top
 * @returns {{command: string, args: Array<string>}}
 */
function editorInvocation(env, filePath, line) {
  const [command, ...configured] = editorWords(env || {});
  const name = editorName(command);

  if (!isRealLine(line)) {
    return { command, args: [...configured, filePath] };
  }
  if (PLUS_LINE.has(name)) {
    return { command, args: [...configured, `+${line}`, filePath] };
  }
  if (PATH_LINE.has(name)) {
    return { command, args: [...configured, `${filePath}:${line}`] };
  }
  if (GOTO_LINE.has(name)) {
    return { command, args: [...configured, GOTO_FLAG, `${filePath}:${line}`] };
  }

  return { command, args: [...configured, filePath] };
}

module.exports = { DEFAULT_EDITOR, editorInvocation, editorName };
