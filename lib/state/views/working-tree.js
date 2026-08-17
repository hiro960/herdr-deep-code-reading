"use strict";

// The way back to the working tree, from wherever the reading went.
//
// Four of the five things this pane can show a diff of are fixed: the index, the
// branch, a commit, and a commit reached from the log. None of them is something
// `git add` has anything to say about, so all four withhold the staging keys — and
// until this, none of them had a way out. `r` reloads whatever is already loaded, and
// Ctrl+O only unwinds a jump somebody made, so a pane opened straight onto the branch
// diff was a pane in which no file could be staged at all.
//
// This is the other half of ./history's openCommitDiff: that one leaves the working
// tree for a commit, this one comes home from wherever it went.

const { diffOptionsOf } = require("../../diff-options");
const { DEFAULT_MODE } = require("../../entrypoints");
const git = require("../../git");
const { pushPlace } = require("../../jump-history");
const { VIEW_DIFF } = require("../../view-names");
const { clearTransient, withMessage } = require("../messages");
const { withFiles } = require("../rows");

// Said rather than done. The reader is already looking at this diff, and reading it
// again would scroll them back to the top of a file they were in the middle of.
const MESSAGE_ALREADY_HOME = "Already showing the working tree — r reloads it";

/** Whether the working tree's diff is the one already on screen. */
function isShowingWorkingTree(state) {
  return state.view === VIEW_DIFF && state.mode === DEFAULT_MODE;
}

/**
 * Load the working tree's diff and show it, from any view.
 *
 * Where it came from goes on the history stack, so Ctrl+O gives the commit or the
 * branch diff back — a place carries the mode and the commit with it, which is what
 * makes coming back land on the same diff rather than on this one under its name.
 *
 * Deliberately not counted as a refresh by lib/run/input-loop: the reader may be
 * standing on this diff already, in which case this says so and draws nothing, and
 * telling the watcher the repository had been read would swallow the very change it
 * was turned on to announce. A redundant reload on the next tick is the cheaper half
 * of that trade.
 */
function openWorkingTree(state) {
  if (isShowingWorkingTree(state)) {
    return withMessage(state, MESSAGE_ALREADY_HOME);
  }

  let loaded;
  try {
    loaded = git.loadDiff(state.repoDir, DEFAULT_MODE, null, diffOptionsOf(state));
  } catch (error) {
    // The mode is changed only once git has answered. Set first, a failure would leave
    // the pane offering the staging keys over another diff's files.
    return withMessage(state, `Could not read the working tree: ${error.message}`);
  }

  const pushed = pushPlace(state.history, state);
  const base = {
    ...clearTransient(state),
    view: VIEW_DIFF,
    mode: DEFAULT_MODE,
    // A commit left loaded is what `r` would reload, and what a place restored from
    // here would come back to
    commit: null,
    openPath: null,
    // A run marked in the diff being left would point into this one's rows
    selectionAnchor: null,
  };

  return {
    ...withFiles(base, loaded.files, 0),
    history: pushed,
    title: loaded.title,
    branch: loaded.branch,
    message: loaded.title,
  };
}

module.exports = { openWorkingTree };
