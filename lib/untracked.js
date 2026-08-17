"use strict";

// The diff of a file git has never seen.
//
// git has no diff to report for an untracked file, and the way round it — asking
// `git diff --no-index` to compare the file against /dev/null — costs one process per
// file. That is what made opening a repository holding three hundred new files take
// two seconds, and made every stage take two more, because staging reloads.
//
// The answer never needed a process. Every line of an untracked file is an added
// line, so the file is read and the diff is built from it here.
//
// The shape is what parseUnifiedDiff produces for the same file, checked against
// git's own output for an ordinary file, an empty one, a binary one, and one with no
// trailing newline.
//
// One difference is deliberate: a symlink is followed to what it points at rather
// than shown as the path it holds, and one pointing outside the repository is refused
// by the same containment check every read goes through. git would print the link's
// target as a line; showing the file the reader would open is the more useful answer,
// and it is the one the rest of this tool already gives.

const { readFileLines } = require("./file-view");

// A whole new file starts at its first line, against nothing on the old side
const NO_OLD_LINES = 0;
const FIRST_LINE = 1;

/**
 * The one hunk that covers a whole file, as an addition.
 * An empty file gets none: git prints the header and stops, there being no line to
 * show, and a hunk with no lines in it would be a hunk header over nothing.
 */
function wholeFileHunk(lines) {
  if (lines.length === 0) {
    return [];
  }

  return [
    {
      oldStart: NO_OLD_LINES,
      oldCount: NO_OLD_LINES,
      newStart: FIRST_LINE,
      newCount: lines.length,
      header: "",
      lines: lines.map((text) => ({ type: "add", text })),
    },
  ];
}

/** A file that is entirely new, with whatever the caller knows about it. */
function addedFile(filePath, known) {
  return {
    oldPath: null,
    newPath: filePath,
    isNew: true,
    isDeleted: false,
    isRenamed: false,
    isBinary: false,
    hunks: [],
    ...known,
  };
}

/**
 * Present a file that has been read as the addition it is.
 *
 * A file that could not be read still becomes an entry, carrying the reason. It used
 * to drop out of the list entirely, which told the reviewer nothing at all about a
 * file that is, after all, one of their own changes.
 *
 * @param {string} filePath Repository-relative path
 * @param {object} result What readFileLines returned
 * @returns {object} An entry in the shape parseUnifiedDiff produces
 */
function buildUntrackedFile(filePath, result) {
  if (result.ok) {
    return addedFile(filePath, { hunks: wholeFileHunk(result.lines) });
  }
  if (result.isBinary) {
    return addedFile(filePath, { isBinary: true });
  }
  return addedFile(filePath, { note: result.reason });
}

/**
 * Read an untracked file and present it as an added file.
 * @returns {object} Never null: a file that cannot be read says so
 */
function untrackedFileDiff(repoDir, filePath) {
  return buildUntrackedFile(filePath, readFileLines(repoDir, filePath));
}

module.exports = { buildUntrackedFile, untrackedFileDiff };
