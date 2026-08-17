"use strict";

// Making a new file, from the browser it will appear in.
//
// The one thing this plugin creates. Everything else it writes goes through git — a
// stage, a commit, a side of a merge — and the files themselves are the reader's, or
// their editor's. This is an empty file at a name they typed, at their keystroke, and
// nothing is ever written into it here: `E` hands it to the editor that does that.
//
// It exists because the browser is where a reader already is when they decide a file
// should exist, and leaving the pane to run `touch` is leaving the pane.
//
// Two halves, as every field-driven key has: the key opens the field, and accepting it
// asks the outside world for the one thing this cannot do purely — see
// lib/run/effects. Everything decidable without a filesystem is decided here.

const { INPUT_CREATE } = require("../../view-names");
const { clearTransient, withMessage } = require("../messages");

const MESSAGE_NO_NAME = "Nothing created: no name";

/** Open the field a new file's name is typed into. */
function startCreate(state) {
  return { ...clearTransient(state), input: { kind: INPUT_CREATE, text: "" } };
}

/**
 * Ask for the file to be made, under the directory the browser is showing.
 *
 * The name is joined to that directory rather than taken as it stands: the reader is
 * looking at a listing and naming something in it, which is what `a` means in the
 * browser it was borrowed from. A name with slashes in it is still allowed and still
 * lands under that directory — `state/views/x.js` typed at the root is one keystroke
 * against six.
 *
 * Whether it would land inside the repository at all is not decided here. That needs
 * the filesystem, because a symlinked directory is how a name with nothing wrong with
 * it points somewhere else — see lib/file-view's resolveNewInsideRepo.
 */
function requestCreate(state, typed) {
  const name = typed.trim();
  const closed = { ...state, input: null };

  if (name === "") {
    return withMessage(closed, MESSAGE_NO_NAME);
  }
  // A trailing slash is how the browser this borrows from asks for a directory. This
  // makes files: a directory with nothing in it is invisible here anyway, because the
  // tree is built from the paths git lists — see lib/file-tree.
  if (name.endsWith("/")) {
    return withMessage(closed, `${name} names a directory — name a file instead`);
  }

  const dir = state.browse === null || state.browse === undefined ? "" : state.browse.dir;

  return {
    ...clearTransient(closed),
    effect: { type: "create-file", path: dir === "" ? name : `${dir}/${name}` },
  };
}

module.exports = {
  MESSAGE_NO_NAME,
  requestCreate,
  startCreate,
};
