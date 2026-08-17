"use strict";

// How the diff is computed, as opposed to how it is drawn.
//
// Two questions a reader asks constantly and, until now, could not ask at all. "What
// is around this change" — a hunk is three lines of context by default, and three
// lines is often exactly one line short of the thing that explains it. And "show me
// the change, not the reindent" — a commit that moved a block one level in is a wall
// of red and green with a handful of real edits hidden inside it.
//
// Both are answered by running git again with one more flag. Nothing here computes
// anything; git does, as it does for every other diff this plugin shows.

// The rungs the `+` and `-` keys move between. Doubling rather than counting, because
// the reader who wants more context usually wants a lot more, and stepping by three
// would take twelve presses to get there.
const WHOLE_FILE = 1000000;
const CONTEXT_STEPS = [0, 3, 6, 12, 25, 50, WHOLE_FILE];

// git's own default. A pane opens here, so a reader who never touches either key sees
// exactly what `git diff` would have shown them.
const DEFAULT_CONTEXT = 3;

/** The rung at or above a value, as an index into the ladder. */
function rungOf(lines) {
  const found = CONTEXT_STEPS.findIndex((step) => step >= lines);
  return found === -1 ? CONTEXT_STEPS.length - 1 : found;
}

/** The next rung up, or the top one. */
function widerContext(lines) {
  const at = rungOf(lines);
  // A value between two rungs climbs to the one above it rather than past it
  const next = CONTEXT_STEPS[at] > lines ? at : at + 1;
  return CONTEXT_STEPS[Math.min(next, CONTEXT_STEPS.length - 1)];
}

/** The next rung down, or nothing but the change itself. */
function narrowerContext(lines) {
  const at = rungOf(lines);
  return CONTEXT_STEPS[Math.max(at - 1, 0)];
}

/** What the header calls the current setting. */
function contextLabel(lines) {
  if (lines >= WHOLE_FILE) {
    return "whole file";
  }
  if (lines <= 0) {
    return "no context";
  }
  return `${lines} lines`;
}

/**
 * The flags git needs to produce the diff the reader has asked for.
 *
 * The default asks for nothing. A `-U3` on every invocation would produce the same
 * diff git produces without it, and be one more thing that could be wrong.
 *
 * @param {{context?: number, ignoreWhitespace?: boolean}} options
 * @returns {Array<string>} Flags, in a stable order
 */
function diffFlags(options) {
  const { context, ignoreWhitespace } = options || {};
  const flags = [];

  if (context !== undefined && context !== null && context !== DEFAULT_CONTEXT) {
    // git has no "all of it" flag, so the top of the ladder is a number large enough
    // that no file reaches it
    flags.push(`-U${context}`);
  }
  if (ignoreWhitespace === true) {
    flags.push("-w");
  }

  return flags;
}

/**
 * The options a state is carrying, in the shape lib/git wants them.
 *
 * Three callers load a diff — the pane opening, a reload, and a commit being shown —
 * and all three have to ask for the same one, or pressing `r` would quietly undo
 * whatever the reader had set.
 */
function diffOptionsOf(state) {
  return {
    context: state.diffContext === undefined ? DEFAULT_CONTEXT : state.diffContext,
    ignoreWhitespace: state.ignoreWhitespace === true,
  };
}

module.exports = {
  CONTEXT_STEPS,
  DEFAULT_CONTEXT,
  WHOLE_FILE,
  contextLabel,
  diffFlags,
  diffOptionsOf,
  narrowerContext,
  widerContext,
};
