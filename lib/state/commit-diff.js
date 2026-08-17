"use strict";

// Putting one commit's diff on a state.
//
// Two views want this and neither is above the other: the log draws a commit's diff
// under the graph as the cursor passes over it, and the commit list opens one in the
// whole pane. They differ in what they do around it — the history each pushes, the
// view each lands in — and not at all in this, so it lives below both.

const git = require("../git");
const { COMMIT_MODE } = require("../git");
const { diffOptionsOf } = require("../diff-options");
const { withFiles } = require("./rows");

/**
 * Load a commit and put its files and rows on the state.
 *
 * The mode goes with it, which is what withholds the staging keys: a commit that landed
 * last year is not something `git add` has anything to say about.
 *
 * Throws whatever git threw — the callers say different things about a failure, so
 * neither is served by having it turned into a message here.
 *
 * @param {object} commit A commit from ../graph or ../history
 */
function withCommitDiff(state, commit) {
  // Not loadDiff: which branch is checked out is the same while the reader steps down
  // the graph, and this is the one load that happens on a keypress — see ../git
  const loaded = git.loadCommitDiff(state.repoDir, commit, diffOptionsOf(state));

  return {
    ...withFiles(state, loaded.files, 0),
    mode: COMMIT_MODE,
    commit,
    title: loaded.title,
    // A run marked in the last commit's rows would point into this one's
    selectionAnchor: null,
  };
}

/**
 * The same, with git's refusal turned into something to say.
 *
 * All three callers — the graph passing over a commit, the graph opening one, the
 * commit list opening one — said the same sentence about a failure, each from its own
 * catch. That made the message three copies of itself for no gain, so it is written
 * once here and they choose only what to do with a state that loaded.
 *
 * @returns {{ok: true, state: object}|{ok: false, message: string}}
 */
function tryCommitDiff(state, commit) {
  try {
    return { ok: true, state: withCommitDiff(state, commit) };
  } catch (error) {
    return { ok: false, message: `Could not show ${commit.shortSha}: ${error.message}` };
  }
}

module.exports = { tryCommitDiff };
