"use strict";

// Reading the repository again, after it moved.
//
// A reload comes from three places — the `r` key, the watch, and coming back from the
// editor — and they do not all arrive with the reader standing in the diff. So the
// diff behind them is refreshed either way, and what happens to the rows in front of
// them depends on whose rows they are.

const git = require("../../git");
const { pathOf } = require("../files");
const { mergeState } = require("../../merge");
const { VIEW_CONFLICTS, VIEW_DIFF, VIEW_LOG, VIEW_READ } = require("../../view-names");
const { diffOptionsOf } = require("../../diff-options");
const { loadNotes } = require("../../notes");
const { rowsKeepingLine, withFiles } = require("../rows");
const { withMessage } = require("../messages");
const { reloadLog } = require("../log");
const { refreshConflicts } = require("./conflicts");

/**
 * Reload the diff. Comments are kept.
 * The selection follows the file path rather than its index, because staging
 * reorders the list and an index would land on a different file.
 */
function reloaded(state, message) {
  try {
    const previousPath = pathOf(state.files[state.selectedIndex]);
    const { title, files, branch } = git.loadDiff(
      state.repoDir,
      state.mode,
      state.commit,
      diffOptionsOf(state)
    );

    const restored = files.findIndex((file) => pathOf(file) === previousPath);
    const fallback = Math.min(state.selectedIndex, Math.max(0, files.length - 1));
    const index = restored === -1 ? fallback : restored;

    return {
      ...withFiles(state, files, index),
      title,
      branch,
      // An agent's answer lands in a file rather than in the repository, and a reload
      // is the moment the pane looks at both — see lib/watch, which fingerprints it
      notes: loadNotes(state.notesFile, state.repoDir),
      // And whether a merge is in the middle of happening. A pull in another pane can
      // leave one behind while this one is reading, and every view says so while there
      // is one — see lib/merge. The list already in hand is passed back so that a file
      // resolved a moment ago keeps its row.
      merge: mergeState(state.repoDir, state.merge ? state.merge.conflicts : null),
      message: message === undefined ? `Reloaded (${files.length} files)` : message,
      effect: null,
    };
  } catch (error) {
    return withMessage(state, `Reload failed: ${error.message}`);
  }
}

/**
 * Reload after the working tree may have changed under the reader.
 *
 * `reloaded` is written for the diff view, where a reload is a reload of the thing on
 * screen. It is not the only place a reload comes from any more: an editor was just
 * handed the file, and the reader is standing in the reading view rather than the
 * diff. So the diff behind them is refreshed either way, and what happens to the rows
 * in front of them depends on whose rows they are.
 *
 * The reading view rebuilds from the file on disk — that is the whole point, the file
 * has changed — and keeps the reader on the line they were on, which may no longer
 * exist. A result list keeps its own rows: they are hits, not the diff's, and the
 * reload is about something behind them.
 *
 * @param {string|null} [message] Footer text; null says nothing, undefined counts files
 * @param {number} [viewport] Body rows, for the log's own scroll
 */
function reloadedInPlace(state, message, viewport) {
  // The log is the one view whose own rows go stale: a commit landing while it is open
  // is exactly the change the reader turned the watch on to see. Its reload rebuilds
  // the graph and the diff under it together, so it does not go through `reloaded`.
  if (state.view === VIEW_LOG && state.log !== null && state.log !== undefined) {
    const relogged = reloadLog(state, viewport === undefined ? state.columns : viewport);
    return message === undefined ? relogged : { ...relogged, message };
  }

  // The conflict list is read from git too, and what it lists is exactly what moves
  // while a merge is being settled — including from another pane, which is what the
  // watch is for. The diff behind it is refreshed the ordinary way first.
  if (state.view === VIEW_CONFLICTS) {
    return refreshConflicts(reloaded(state, message === undefined ? null : message), message);
  }

  const refreshed = reloaded(state, message);

  if (state.view === VIEW_READ && state.openPath !== null && state.openPath !== undefined) {
    return { ...refreshed, ...rowsKeepingLine(state, refreshed) };
  }

  if (state.view === VIEW_DIFF) {
    return refreshed;
  }

  // The browser and the result lists draw from something other than `rows`, and the
  // diff's rows are only sitting there waiting to be gone back to. Putting the
  // reader's own rows back is what keeps a reload from emptying the list they are
  // reading — see test/edit-action.test.js.
  return { ...refreshed, rows: state.rows, cursor: state.cursor, scroll: state.scroll };
}

module.exports = {
  reloaded,
  reloadedInPlace,
};
