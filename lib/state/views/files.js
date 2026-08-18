"use strict";

// Copying, deleting and renaming a file, from the browser it is listed in.
//
// This is where the line moved. It used to run between naming a file — which the
// browser is the right place for — and everything else, which was the editor's. But
// the three things a reader does to a tree they are reading are copy it, drop it and
// call it something else, and leaving the pane to do them is leaving the pane.
//
// Three rules hold the whole of it:
//
//   - They act on a file, never on a directory. The listing is built from files, and a
//     recursive delete is the widest blast radius there is for the narrowest gain.
//   - Nothing is ever overwritten. A destination something already answers to is
//     refused, not replaced — the second half of somebody's afternoon is not this
//     pane's to spend.
//   - The one that destroys asks first, the way the pull, the push and the undone
//     merge do: it names what is about to go and waits for the same key again.
//
// Two halves, as every key that touches the world has: what can be decided without a
// filesystem is decided here, and the rest is an effect — see lib/run/effects.

const path = require("node:path");

const { INPUT_RENAME } = require("../../view-names");
const { clearTransient, withMessage } = require("../messages");

const MESSAGE_NOTHING_YANKED = "Nothing yanked — y remembers the file under the cursor";
const MESSAGE_NO_NAME = "Nothing renamed: no name";

/** The entry the browser's cursor is on, or null where there is none. */
function entryUnderCursor(state) {
  const browse = state.browse;
  if (browse === null || browse === undefined) {
    return null;
  }
  return browse.entries[browse.index] || null;
}

/**
 * The file under the cursor, or a reason there is none.
 * @returns {{ok: true, path: string, name: string}|{ok: false, reason: string}}
 */
function fileUnderCursor(state) {
  const entry = entryUnderCursor(state);
  if (entry === null) {
    return { ok: false, reason: "Nothing here to act on" };
  }
  if (entry.isDirectory) {
    return { ok: false, reason: `${entry.name} is a directory — these keys act on a file` };
  }
  return { ok: true, path: entry.path, name: entry.name };
}

/** Where a name typed in the browser lands: under the directory being shown. */
function underBrowsedDirectory(state, name) {
  const dir = state.browse === null || state.browse === undefined ? "" : state.browse.dir;
  return dir === "" ? name : `${dir}/${name}`;
}

/** Remember the file under the cursor, for `p` to write somewhere else. */
function yankFile(state) {
  const file = fileUnderCursor(state);
  if (!file.ok) {
    return withMessage(state, file.reason);
  }
  return {
    ...clearTransient(state),
    yanked: file.path,
    message: `Yanked ${file.path} — p writes it where you are`,
  };
}

/**
 * Write the yanked file into the directory being browsed, under its own name.
 *
 * Its own name rather than one typed: `p` is the other half of `y`, and a field between
 * them would make the pair a form. A name already taken is refused rather than typed
 * over — see the rules above, and `r` for the key that does ask.
 */
function pasteFile(state) {
  const from = state.yanked;
  if (from === null || from === undefined) {
    return withMessage(state, MESSAGE_NOTHING_YANKED);
  }

  const to = underBrowsedDirectory(state, path.posix.basename(from));
  if (to === from) {
    return withMessage(state, `${from} is already here`);
  }
  return { ...clearTransient(state), effect: { type: "copy-file", from, to } };
}

/**
 * Ask to delete the file under the cursor, and ask again before doing it.
 *
 * The prompt is armed on the state the way the pull's and the push's are, so that any
 * other key takes it back off — see PROMPT_KEYS in ../reducers.
 */
function requestDelete(state) {
  const file = fileUnderCursor(state);
  if (!file.ok) {
    return withMessage(state, file.reason);
  }
  if (state.pendingDelete) {
    return { ...clearTransient(state), pendingDelete: false, effect: { type: "delete-file", path: file.path } };
  }
  return {
    ...clearTransient(state),
    pendingDelete: true,
    message: `Delete ${file.path} — press D again`,
  };
}

/** Open the field the file's new name is typed into, with the old one already in it. */
function startRename(state) {
  const file = fileUnderCursor(state);
  if (!file.ok) {
    return withMessage(state, file.reason);
  }
  return { ...clearTransient(state), input: { kind: INPUT_RENAME, text: file.name } };
}

/**
 * Ask for the file to be renamed to what was typed.
 *
 * The name lands under the directory being browsed, the way `a`'s does: the reader is
 * looking at a listing and naming something in it. A name with slashes moves the file
 * as well as renaming it, which is the same act said longer.
 */
function requestRename(state, typed) {
  const name = typed.trim();
  const closed = { ...state, input: null };
  const file = fileUnderCursor(state);

  if (!file.ok) {
    return withMessage(closed, file.reason);
  }
  if (name === "") {
    return withMessage(closed, MESSAGE_NO_NAME);
  }
  if (name.endsWith("/")) {
    return withMessage(closed, `${name} names a directory — name a file instead`);
  }

  const to = underBrowsedDirectory(state, name);
  if (to === file.path) {
    return withMessage(closed, `${file.name} is already called that`);
  }
  return { ...clearTransient(closed), effect: { type: "rename-file", from: file.path, to } };
}

module.exports = {
  MESSAGE_NOTHING_YANKED,
  pasteFile,
  requestDelete,
  requestRename,
  startRename,
  yankFile,
};
