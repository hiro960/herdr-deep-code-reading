"use strict";

// Parses `git status --porcelain=v1 -z`.
//
// Each record is "XY <path>", where X is the index status and Y the worktree status.
// A rename or copy adds the original path as a second record, which must be consumed
// with the first so it does not become an entry of its own.

const NUL = "\u0000";
const UNTRACKED = "?";
const CLEAN = " ";
const PATH_OFFSET = 3; // "XY " before the path

const RENAME_STATUSES = new Set(["R", "C"]);

// The seven pairs git uses for a file a merge could not settle. `U` on either side is
// six of them; the seventh is `AA`, where both sides added a file of the same name and
// neither letter is a U. Read as a set rather than as a test for U, because that
// seventh is exactly the one a hand-written test forgets.
const UNMERGED_CODES = new Set(["DD", "AU", "UD", "UA", "DU", "AA", "UU"]);

/**
 * Parse porcelain status output.
 * @param {string} text NUL-separated records
 * @returns {Array<{index: string, worktree: string, path: string, origPath: string|null}>}
 */
function parseStatus(text) {
  if (!text) {
    return [];
  }

  const records = text.split(NUL).filter((record) => record.length > 0);
  const entries = [];

  for (let cursor = 0; cursor < records.length; cursor += 1) {
    const record = records[cursor];
    if (record.length < PATH_OFFSET) {
      continue;
    }

    const index = record[0];
    const worktree = record[1];
    const path = record.slice(PATH_OFFSET);

    let origPath = null;
    if (RENAME_STATUSES.has(index) || RENAME_STATUSES.has(worktree)) {
      // The next record holds the original path
      cursor += 1;
      origPath = records[cursor] === undefined ? null : records[cursor];
    }

    entries.push({ index, worktree, path, origPath });
  }

  return entries;
}

/** Whether the entry has changes in the index. */
function isStaged(entry) {
  return entry.index !== CLEAN && entry.index !== UNTRACKED;
}

/** Whether the entry has changes in the worktree that are not staged. */
function isUnstaged(entry) {
  return entry.worktree !== CLEAN && entry.worktree !== UNTRACKED;
}

/** Whether git does not track the file at all. */
function isUntracked(entry) {
  return entry.index === UNTRACKED && entry.worktree === UNTRACKED;
}

/** The two-letter status as git prints it. */
function statusLabel(entry) {
  return entry.index + entry.worktree;
}

/**
 * Whether git could not settle this file: both sides of a merge are in the index.
 * A file in this state has no single version to stage or diff — see lib/merge.
 */
function isUnmerged(entry) {
  return UNMERGED_CODES.has(statusLabel(entry));
}

module.exports = {
  isStaged,
  isUnmerged,
  isUnstaged,
  isUntracked,
  parseStatus,
  statusLabel,
};
