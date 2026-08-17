"use strict";

// The files a merge could not settle, and the keys that settle them.
//
// One list, one row per file, in the order git named them: what the file is called,
// which of the seven kinds of conflict it is, and whether it is done. It is the one
// screen in this pane that is a job rather than a reading — there is a thing to finish
// and a count of how much of it is left — so it says both, in the header.
//
// What can be done to a row is what git can do on its own. `o` and `t` take one side
// whole; `space` says a file the reader has edited by hand is finished; `E` is what
// hands it to them to edit, and `Enter` opens it here first, at the conflict, with the
// two sides drawn apart — see lib/conflict. Choosing half of one side is nobody's job
// but the editor's: it would mean writing a file neither side wrote, and this pane does
// not write files.
//
// `C` finishes the merge and `!` undoes it. Both ask first, for the same reason `p`
// does: one makes a commit and the other throws away every resolution in the list.

const { conflictRows, firstConflictLine } = require("../../conflict");
const { readFileLines } = require("../../file-view");
const { pushPlace } = require("../../jump-history");
const { isMergingNow, mergeState, pathsWithMarkers, unresolvedOf } = require("../../merge");
const { VIEW_CONFLICTS } = require("../../view-names");
const { withCursor } = require("../cursor");
const { clearTransient, withMessage } = require("../messages");
const { jumpBack } = require("./reading");

// The same mark a file already read carries, and a commit already read: this list is
// the third place something is ticked off, and a reader has learned it twice already.
const RESOLVED_MARK = "✓";

const MESSAGE_NO_MERGE = "No merge in progress";
const MESSAGE_NO_CONFLICT = "No conflicted file here";

/**
 * Where a file's first conflict is, for opening it at the right line.
 * A file that has been resolved, or one that is gone, has none — and the top of a file
 * is where a file opens anyway.
 */
function conflictLineOf(state, filePath) {
  const result = readFileLines(state.repoDir, filePath);
  return result.ok ? firstConflictLine(result.lines) : 1;
}

/** One row per conflicted file: the name, what kind it is, and whether it is done. */
function conflictHits(state, conflicts) {
  return conflicts.map((conflict) => ({
    path: conflict.path,
    line: conflictLineOf(state, conflict.path),
    // The location column carries the name, so the rest of the row is free to say
    // what the conflict is rather than repeat a line number nobody asked for
    label: conflict.path,
    text: conflict.resolved === true ? `${RESOLVED_MARK} ${conflict.kind}` : conflict.kind,
    conflict,
  }));
}

function rowsOfHits(hits) {
  return hits.map((hit) => ({ kind: "hit", hit }));
}

/**
 * Step to the next conflict in the file being read, or the previous one.
 *
 * A file with four conflicts in it is four places to go, and finding the next one by
 * scrolling is what a reader should not have to do. There is no wrap: arriving back at
 * the top without having asked to reads as having gone the wrong way, and the footer
 * saying there is none that way is the more useful answer.
 */
function moveToConflict(state, direction, viewport) {
  const places = conflictRows(state.rows);

  if (places.length === 0) {
    return withMessage(state, "No conflict left in this file");
  }

  const next =
    direction > 0
      ? places.find((at) => at > state.cursor)
      : [...places].reverse().find((at) => at < state.cursor);

  if (next === undefined) {
    return withMessage(state, direction > 0 ? "No conflict below this" : "No conflict above this");
  }

  return withCursor(clearTransient(state), next, viewport);
}

/** What the header says: what is left of the job, and how much of it there was. */
function conflictTitle(merge) {
  const total = merge.conflicts.length;
  const left = unresolvedOf(merge).length;

  if (total === 0) {
    return "conflicts  (none)";
  }
  return left === 0
    ? `conflicts  (${total} resolved — C commits the merge)`
    : `conflicts  (${total - left}/${total} resolved)`;
}

/**
 * Put the conflict list on a state, keeping the reader where they were in it.
 *
 * Every key here ends in this: the list is read from git after each one, because git is
 * what changed. The cursor follows the row rather than the index — resolving a file
 * does not remove its row, but a reload during a merge can add one — so the reader is
 * left looking at the file they were looking at.
 */
function withConflicts(state, merge, said) {
  const hits = conflictHits(state, merge.conflicts);
  const rows = rowsOfHits(hits);
  const was = state.hits === undefined || state.hits === null ? null : state.hits[state.cursor];
  const found = was === null || was === undefined
    ? -1
    : hits.findIndex((hit) => hit.path === was.path);

  return {
    ...state,
    merge,
    view: VIEW_CONFLICTS,
    listTitle: conflictTitle(merge),
    hits,
    rows,
    cursor: Math.max(0, found),
    scroll: found === -1 ? 0 : state.scroll,
    openPath: null,
    message: said === undefined ? null : said,
    effect: null,
  };
}

/**
 * Open the list of what is left to settle.
 *
 * Reached from anywhere, the way the log is: a merge is a state the whole repository is
 * in, not something that belongs to whichever screen the reader happened to be on when
 * it began. It is also where a conflicted pull leaves them.
 */
function openConflicts(state, said) {
  const merge = mergeState(state.repoDir, state.merge ? state.merge.conflicts : null);

  if (!isMergingNow(merge)) {
    // Nothing is put on the state, deliberately. There is no merge, so there is
    // nothing to record — and a key that only answers a question must leave the state
    // it was asked about exactly as it found it, or the footer would have to name a
    // key that does nothing on every screen that has no merge behind it.
    return withMessage(state, MESSAGE_NO_MERGE);
  }

  return withConflicts({ ...state, history: pushPlace(state.history, state) }, merge, said);
}

/**
 * Read the list again, after something changed it.
 *
 * A merge that is over — committed here, committed in another pane, or aborted — takes
 * the list with it, and the reader with it too: a screen listing what to resolve is not
 * a screen to be left standing on when there is nothing left to resolve. They go back
 * where they came from, which for a pull that conflicted is the log they pulled from.
 */
function refreshConflicts(state, said) {
  const merge = mergeState(state.repoDir, state.merge ? state.merge.conflicts : null);
  const message = said === undefined ? null : said;

  if (!isMergingNow(merge)) {
    const gone = { ...state, merge };
    const left = state.view === VIEW_CONFLICTS ? jumpBack(gone) : gone;
    return { ...left, merge, message, effect: null };
  }

  return withConflicts(state, merge, said);
}

/** The conflict the cursor is on, or null when the row is not one. */
function conflictAtCursor(state) {
  const hits = state.hits || [];
  const hit = hits[state.cursor];
  return hit === undefined || hit.conflict === undefined ? null : hit.conflict;
}

/**
 * Take one side of the file under the cursor, whole.
 * A file already resolved is left alone: taking a side of it now would undo whatever
 * the reader settled it as, which is not what a key pressed on a row marked done means.
 */
function requestTake(state, side) {
  const conflict = conflictAtCursor(state);
  if (conflict === null) {
    return withMessage(state, MESSAGE_NO_CONFLICT);
  }
  if (conflict.resolved === true) {
    return withMessage(state, `${conflict.path} is already resolved`);
  }

  return {
    ...clearTransient(state),
    effect: { type: "resolve", side, path: conflict.path, code: conflict.code },
  };
}

/**
 * Say the file under the cursor is settled.
 *
 * For the file the reader has just edited by hand. The markers are looked for first and
 * named if they are still there — a file added with `<<<<<<<` still in it is a commit
 * nobody meant to make — but the mark is not withheld over it: a file may hold that line
 * for its own reasons, and this pane is not the judge of what somebody's file says.
 */
function requestResolved(state) {
  const conflict = conflictAtCursor(state);
  if (conflict === null) {
    return withMessage(state, MESSAGE_NO_CONFLICT);
  }

  return {
    ...clearTransient(state),
    effect: { type: "resolve", side: null, path: conflict.path, code: conflict.code },
  };
}

/** Hand the file under the cursor to the reader's own editor, at its first conflict. */
function requestEditConflict(state) {
  const hits = state.hits || [];
  const hit = hits[state.cursor];
  if (hit === undefined) {
    return withMessage(state, MESSAGE_NO_CONFLICT);
  }

  return {
    ...clearTransient(state),
    effect: { type: "edit", path: hit.path, line: hit.line },
  };
}

/**
 * Finish the merge.
 *
 * Two presses when a file still holds the markers git wrote, one when none does. The
 * question is not "are you sure" — it is "this file still has both sides in it", which
 * is worth being told once and not worth being stopped by: `<<<<<<<` at the start of a
 * line is a line some files legitimately carry, and a tool that refused outright would
 * be refusing a commit its reader is entitled to make.
 */
function requestMergeCommit(state) {
  const left = unresolvedOf(state.merge);
  if (left.length > 0) {
    const noun = left.length === 1 ? "file is" : "files are";
    return withMessage(state, `${left.length} ${noun} still unresolved`);
  }

  const marked = state.pendingCommit === true
    ? []
    : pathsWithMarkers(state.repoDir, (state.merge.conflicts || []).map((conflict) => conflict.path));

  if (marked.length > 0) {
    return {
      ...state,
      pendingCommit: true,
      effect: null,
      message: `${marked[0]} still has conflict markers — press C again to commit anyway`,
    };
  }

  return { ...clearTransient(state), pendingCommit: false, effect: { type: "commit-merge" } };
}

/**
 * Undo the whole merge.
 * Two presses, because the first one would throw away every side already chosen — and
 * unlike the merge itself, that work is not written down anywhere to be found again.
 */
function requestAbort(state) {
  if (state.pendingAbort === true) {
    return { ...clearTransient(state), pendingAbort: false, effect: { type: "abort-merge" } };
  }

  const total = (state.merge.conflicts || []).length;
  return {
    ...state,
    pendingAbort: true,
    effect: null,
    message: `Undo the merge and everything resolved in ${total} files — press ! again`,
  };
}

module.exports = {
  MESSAGE_NO_CONFLICT,
  MESSAGE_NO_MERGE,
  RESOLVED_MARK,
  conflictAtCursor,
  conflictTitle,
  moveToConflict,
  openConflicts,
  refreshConflicts,
  requestAbort,
  requestEditConflict,
  requestMergeCommit,
  requestResolved,
  requestTake,
};
