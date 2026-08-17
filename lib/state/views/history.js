"use strict";

// The commits behind what is on screen: the repository's, one file's, one run of
// lines'. A list of them is the same act as a search — somewhere to look, and a key
// that goes there — so it is the same view. What a commit opens is a diff rather than
// a file, and that is the only difference.

const { shaOfLabel } = require("../../blame");
const { SIDE_OLD, anchorFromRows } = require("../../comments");
const { commitHits, commitRows, historyTitle, loadCommit, loadCommits } = require("../../history");
const { commitEntry } = require("../../journal");
const { recordVisit } = require("../visits");
const { pushPlace } = require("../../jump-history");
const { INPUT_PICKAXE, VIEW_DIFF, VIEW_READ } = require("../../view-names");
const { tryCommitDiff } = require("../commit-diff");
const { hasSelection, selectedRows } = require("../cursor");
const { MESSAGE_NOTHING_TO_TRACE, clearTransient, withMessage } = require("../messages");
const { openList } = require("./lists");

/**
 * List commits: the whole repository's, one file's, or one run of lines'.
 *
 * The same view a search fills, because it is the same act — a list of places, moved
 * through with the same keys, opened with the same one. What a commit opens is a
 * diff rather than a file, and that is the only difference.
 *
 * @param {{path?: string, start?: number, end?: number}} [scope]
 */
function openCommits(state, scope) {
  const result = loadCommits(state.repoDir, scope);
  if (!result.ok) {
    return withMessage(state, `Could not read the history: ${result.error}`);
  }

  const hits = commitHits(result.commits);
  return openList(state, historyTitle(scope, hits.length), commitRows(hits), hits);
}

/**
 * The history of the open file, or of the run of lines marked in it.
 *
 * A marked run narrows the question from "what has happened to this file" to "why is
 * this line the way it is", which is the question deep reading actually asks. git
 * answers it with `log -L`, following the lines through every commit that moved them.
 */
function openFileHistory(state) {
  const filePath = state.openPath;
  if (filePath === null || filePath === undefined) {
    return withMessage(state, MESSAGE_NOTHING_TO_TRACE);
  }

  // A marked run, and only a marked run. selectedRows answers with the row under the
  // cursor when nothing is marked — which is right for a comment, and would silently
  // turn every `H` into the history of line one.
  const anchor = hasSelection(state) ? anchorFromRows(selectedRows(state)) : null;
  // Only the new side has lines a historical file can be traced through; a removed
  // line is numbered in a version the file no longer has.
  const range =
    anchor === null || anchor.side === SIDE_OLD
      ? {}
      : { start: anchor.start, end: anchor.end };

  return openCommits(state, { path: filePath, ...range });
}

/**
 * Show one commit, in the pane the working-tree diff was in.
 *
 * The mode changes with it, which is what withholds the staging keys: a commit that
 * landed last year is not something `git add` has anything to say about. Going back
 * is Ctrl+O, and brings the previous diff with it — see ../../jump-history.
 */
function openCommitDiff(state, commit) {
  const pushed = pushPlace(state.history, state);
  const loaded = tryCommitDiff({ ...state, view: VIEW_DIFF }, commit);
  if (!loaded.ok) {
    return withMessage(state, loaded.message);
  }

  return recordVisit(
    {
      ...loaded.state,
      history: pushed,
      openPath: null,
      message: `${commit.shortSha} ${commit.subject}`,
    },
    commitEntry(commit)
  );
}

const MESSAGE_NO_BLAME = "Turn the blame column on with B to open a line's commit";

/**
 * Open the commit the blame column names for the line under the cursor.
 *
 * `B` answers "when did this line last change" with a sha and a date, which is half an
 * answer — the rest is in the commit, and there was no key that went there. `H` lists
 * the whole file's commits, which is the other question: this one is asked with a
 * finger on one line.
 *
 * Only where the column is on. It is what the reader is pointing at, and a key that
 * silently blamed the file to answer would be doing something they did not ask for.
 */
function openBlamedCommit(state) {
  const row = state.rows[state.cursor];
  const sha = row === undefined || row.cell === undefined ? null : shaOfLabel(row.cell.blame);
  if (sha === null) {
    return withMessage(state, MESSAGE_NO_BLAME);
  }

  const found = loadCommit(state.repoDir, sha);
  if (!found.ok) {
    return withMessage(state, `Could not read ${sha}: ${found.error}`);
  }
  return openCommitDiff(state, found.commit);
}

/**
 * Open the field the pickaxe is typed into.
 *
 * Prefilled with the word under the cursor, which is what the reader is looking at
 * and almost always what they want the history of. `H` asks what happened to this
 * file; this asks when this string arrived, which is a different question and, on
 * unfamiliar code, usually the more useful one.
 */
function openPickaxe(state, word) {
  return {
    ...clearTransient(state),
    input: { kind: INPUT_PICKAXE, text: word || "", regex: false },
  };
}

/**
 * List the commits that changed how many times a string appears.
 *
 * git's -S, not a grep of the log. "Which commits mention this" is a much longer
 * list and a much worse answer: the one that matters is where the string came from
 * and where it went.
 *
 * @param {boolean} regex Whether the text is a pattern, which is git's -G
 */
function runPickaxe(state, text, regex) {
  if (text.trim() === "") {
    return { ...clearTransient(state), input: null };
  }

  // Narrowed to the open file where there is one: a reader who pressed this while
  // reading something is asking about that thing, and the whole repository's answer
  // to a common word is a list nobody reads.
  const within = state.view === VIEW_READ && state.openPath ? { path: state.openPath } : {};
  return openCommits({ ...state, input: null }, { text: text.trim(), regex, ...within });
}

module.exports = {
  MESSAGE_NO_BLAME,
  openBlamedCommit,
  openCommitDiff,
  openPickaxe,
  runPickaxe,
  openFileHistory,
};
