"use strict";

// Changing how the diff on screen was computed, rather than how it is drawn.
//
// `t` picks a layout and rebuilds the rows out of what is already in hand. These
// three go further back than that: they change what git was asked for, so the answer
// has to be fetched again. That is why each of them ends in a reload rather than in a
// row rebuild — and why each says what it did, because a diff that quietly grew or
// quietly stopped showing whitespace would be a diff the reader could not trust.

const {
  contextLabel,
  diffOptionsOf,
  narrowerContext,
  widerContext,
} = require("../diff-options");
const { prunedTo, toggleViewed } = require("../viewed");
const { MESSAGE_NO_FILE, clearTransient, withMessage } = require("./messages");
const { reloaded } = require("./views/reload");

/** Reload with a new setting, saying what it now is. */
function withDiffOption(state, changed, said) {
  return reloaded({ ...clearTransient(state), ...changed }, said);
}

/**
 * Show more of the file around each change.
 *
 * The commonest question a hunk raises is "what is above this", and until now the
 * only answer was to leave the diff and open the file.
 */
function widenContext(state) {
  const lines = widerContext(diffOptionsOf(state).context);
  return withDiffOption(state, { diffContext: lines }, `Context: ${contextLabel(lines)}`);
}

/** Show less of it, down to the changed lines and nothing else. */
function narrowContext(state) {
  const lines = narrowerContext(diffOptionsOf(state).context);
  return withDiffOption(state, { diffContext: lines }, `Context: ${contextLabel(lines)}`);
}

/**
 * Stop counting whitespace as a change, or start again.
 *
 * A commit that moved a block one level in is a wall of red and green with a handful
 * of real edits inside it. This is the key that finds them. It is off by default and
 * says so in the header while it is on: a diff that hides changes is not one to be
 * left holding without knowing.
 */
function toggleIgnoreWhitespace(state) {
  const ignoring = diffOptionsOf(state).ignoreWhitespace !== true;

  return withDiffOption(
    state,
    { ignoreWhitespace: ignoring },
    ignoring ? "Ignoring whitespace" : "Counting whitespace again"
  );
}

/**
 * Mark the file the panel points at as read, or unread when it already is.
 *
 * The marks are pruned against the files on screen on the way out. A branch reviewed
 * and then rebased leaves marks for paths nobody will see again, and here is the one
 * moment the plugin knows which paths are still real.
 */
function toggleFileViewed(state) {
  const file = state.files[state.selectedIndex];
  if (file === undefined) {
    return withMessage(state, MESSAGE_NO_FILE);
  }

  const { marks, viewed } = toggleViewed(state.viewed || [], file);
  const label = file.newPath || file.oldPath;

  return {
    ...clearTransient(state),
    viewed: prunedTo(marks, state.files),
    effect: { type: "save-viewed" },
    message: viewed ? `Read: ${label}` : `Unread: ${label}`,
  };
}

module.exports = {
  narrowContext,
  toggleFileViewed,
  toggleIgnoreWhitespace,
  widenContext,
};
