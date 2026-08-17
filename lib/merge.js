"use strict";

// A merge that stopped, as a fact about the repository.
//
// git leaves three things behind when a merge cannot finish on its own: MERGE_HEAD,
// naming what was being merged in; an index carrying both sides of every file it could
// not settle; and those files on disk with the two versions between markers. The first
// is what says a merge is in progress at all, the second is the list this reads, and the
// third is ./conflict's to read.
//
// Only a merge. A rebase and a cherry-pick stop the same way and leave their own heads
// behind, and neither is something this pane can start — so neither is something it
// claims to be in the middle of. A reader who began one in another pane is told nothing
// here rather than told something wrong.
//
// The list is kept rather than recomputed from nothing each time: a file stops being
// unmerged the moment it is resolved, and a list that dropped it would have the row
// under the reader's cursor disappear as they worked. What this answers is "the files
// this merge conflicted in", each marked with whether it is settled yet.

const { loadStatus, runGit } = require("./git");
const { isUnmerged, statusLabel } = require("./status");
const { hasConflictMarkers } = require("./conflict");
const { readFileLines } = require("./file-view");

// What each pair of letters means, in the words git's own messages use. The reader is
// being asked to choose between two versions, so which two matters: a file both sides
// changed is a different decision from one side deleting what the other was editing.
const CONFLICT_KINDS = {
  UU: "both modified",
  AA: "both added",
  DD: "both deleted",
  AU: "added by us",
  UA: "added by them",
  DU: "deleted by us",
  UD: "deleted by them",
};

// The codes where one side has no version of the file at all. Taking that side is
// deleting the file rather than checking a version of it out, and asking git for a
// version that is not there is an error rather than an answer.
const NO_OURS = new Set(["DU", "UA", "DD"]);
const NO_THEIRS = new Set(["UD", "AU", "DD"]);

const OURS = "ours";
const THEIRS = "theirs";

/** What a pair of status letters says the conflict is. */
function kindOf(code) {
  return CONFLICT_KINDS[code] || "unmerged";
}

/** Whether the side named has a version of this file to be taken. */
function sideExists(code, side) {
  return side === OURS ? !NO_OURS.has(code) : !NO_THEIRS.has(code);
}

/**
 * Whether a merge is in progress.
 * MERGE_HEAD is written when one begins and removed when it is committed or aborted,
 * so its presence is the question and nothing else has to be inferred.
 */
function isMerging(repoDir) {
  try {
    return runGit(repoDir, ["rev-parse", "--verify", "--quiet", "MERGE_HEAD"]).status === 0;
  } catch {
    // git could not be run at all. Everything else here would fail the same way, and
    // "no merge" is the state the pane can still draw.
    return false;
  }
}

/**
 * The files git could not settle, as it lists them now.
 * @returns {Array<{path: string, code: string, kind: string}>}
 */
function unmergedPaths(repoDir) {
  return loadStatus(repoDir)
    .filter(isUnmerged)
    .map((entry) => {
      const code = statusLabel(entry);
      return { path: entry.path, code, kind: kindOf(code) };
    });
}

/**
 * Fold what git says now into what this merge has already shown.
 *
 * A resolved file keeps its row, marked. Three reasons: the reader's cursor is
 * somewhere in this list and rows vanishing under it is the one thing a list must not
 * do; a merge of six files is a job with a progress, and `4/6` is that progress; and a
 * file resolved by mistake is one the reader has to be able to find again.
 *
 * @param {Array<object>} previous The list as it was, or nothing on the first read
 * @param {Array<object>} current What `git status` says is unmerged now
 */
function mergedConflicts(previous, current) {
  const now = new Map(current.map((conflict) => [conflict.path, conflict]));
  const before = previous || [];

  const kept = before.map((conflict) => {
    const still = now.get(conflict.path);
    return still === undefined
      ? { ...conflict, resolved: true }
      : { ...still, resolved: false };
  });

  const seen = new Set(before.map((conflict) => conflict.path));
  const arrived = current
    .filter((conflict) => !seen.has(conflict.path))
    .map((conflict) => ({ ...conflict, resolved: false }));

  return [...kept, ...arrived];
}

/**
 * Where the merge stands: whether there is one, and what it left unsettled.
 *
 * @param {Array<object>} [previous] The conflict list already on the state, so that a
 *   file resolved a moment ago keeps its row — see mergedConflicts
 * @returns {{merging: boolean, conflicts: Array<object>}}
 */
function mergeState(repoDir, previous) {
  if (!isMerging(repoDir)) {
    // Committed or aborted: what the list said belongs to a merge that is over, and
    // carrying it forward would have the pane offering to resolve settled files.
    return { merging: false, conflicts: [] };
  }

  return { merging: true, conflicts: mergedConflicts(previous, unmergedPaths(repoDir)) };
}

/** The conflicts still to settle. */
function unresolvedOf(merge) {
  if (merge === null || merge === undefined) {
    return [];
  }
  return (merge.conflicts || []).filter((conflict) => conflict.resolved !== true);
}

/** Whether the pane is in the middle of a merge with anything left to do. */
function isMergingNow(merge) {
  return merge !== null && merge !== undefined && merge.merging === true;
}

/**
 * Which of these files still hold a conflict git wrote into them.
 *
 * Asked of the working tree rather than of the index, because the reader edits the
 * working tree and this exists to catch the file they thought they had finished. A
 * file that cannot be read — deleted as the resolution, or binary — is not one that
 * can be shown to hold markers, so it is left out rather than guessed at.
 *
 * @returns {Array<string>} Paths, in the order given
 */
function pathsWithMarkers(repoDir, paths) {
  const found = [];

  for (const filePath of paths) {
    const result = readFileLines(repoDir, filePath);
    if (result.ok && hasConflictMarkers(result.lines)) {
      found.push(filePath);
    }
  }

  return found;
}

module.exports = {
  CONFLICT_KINDS,
  OURS,
  THEIRS,
  isMerging,
  isMergingNow,
  kindOf,
  mergeState,
  mergedConflicts,
  pathsWithMarkers,
  sideExists,
  unmergedPaths,
  unresolvedOf,
};
