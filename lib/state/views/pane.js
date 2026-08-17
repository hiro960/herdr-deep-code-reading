"use strict";

// Reading two places at once.
//
// Following a name to where it is defined costs you the place you were reading, and
// `Ctrl+O` is the way back rather than a way to have both. That is fine for a glance
// and wrong for the thing deep reading is mostly made of: holding a definition and
// its caller side by side and looking between them.
//
// Herdr already has the answer, because Herdr is a terminal multiplexer and this is a
// plugin living in it. `|` opens a second pane of the same plugin, beside this one,
// at the place the cursor is on. Nothing here draws anything: it asks Herdr for a
// pane and Herdr starts another copy, which opens where it was told to.

const { SIDE_OLD, anchorFromRow } = require("../../comments");
const { currentFilePath } = require("../files");
const { clearTransient, withMessage } = require("../messages");

const MESSAGE_NOWHERE_TO_OPEN = "Nothing under the cursor to open beside this";

// How the place is written into the new pane's environment. One variable rather than
// two, because Herdr passes them through as a list of strings and a path with a colon
// in it is not a thing a repository has.
const OPEN_SEPARATOR = ":";

/** Where the cursor is, as a place a second pane could be opened at. */
function placeUnderCursor(state) {
  const file = currentFilePath(state);
  if (file === null || file === undefined) {
    return null;
  }

  const anchor = anchorFromRow(state.rows[state.cursor]);
  // A removed line is numbered in a version of the file that no longer exists, so a
  // pane opened at it would land on whatever now has that number
  if (anchor === null || anchor.side === SIDE_OLD) {
    return { path: file, line: 1 };
  }
  return { path: file, line: anchor.start };
}

/** The place a pane was told to open at, read out of its environment. */
function openAt(env) {
  const raw = (env || {}).HERDR_DEEP_CODE_READING_OPEN;
  if (typeof raw !== "string" || raw === "") {
    return null;
  }

  const at = raw.lastIndexOf(OPEN_SEPARATOR);
  if (at <= 0) {
    return { path: raw, line: 1 };
  }

  // A tail that is a number at all is a line, however bad a one — `a.js:0` meant to
  // name a line and got it wrong. A tail that is not a number is part of the path,
  // because a repository may well hold a file with a colon in its name.
  const tail = raw.slice(at + 1);
  const line = Number(tail);
  if (tail === "" || !Number.isFinite(line)) {
    return { path: raw, line: 1 };
  }
  return { path: raw.slice(0, at), line: Math.max(1, Math.floor(line)) };
}

/** How a place is written for the pane that will read it. */
function openSpec(place) {
  return `${place.path}${OPEN_SEPARATOR}${place.line}`;
}

/**
 * Ask Herdr for a second pane, beside this one, showing this place.
 *
 * Split rather than zoomed: the point is to see both. Two columns of diff want 160
 * of them and a split has half that, so the pane that opens will draw its file
 * unified — which is what reading one file wants anyway.
 */
function openBeside(state) {
  const place = placeUnderCursor(state);
  if (place === null) {
    return withMessage(state, MESSAGE_NOWHERE_TO_OPEN);
  }

  return {
    ...clearTransient(state),
    effect: { type: "open-pane", place },
    message: `Opening ${openSpec(place)} beside this`,
  };
}

module.exports = {
  openAt,
  openBeside,
  openSpec,
  placeUnderCursor,
};
