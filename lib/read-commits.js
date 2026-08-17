"use strict";

// Which commits the reader has been through.
//
// ./viewed answers the same question about the files of one change, and has to work
// for its answer: a working tree moves, so a mark there records what the file looked
// like when it was read and stops being a mark when it changes. A commit is the one
// thing here that cannot change. Its sha is what it is, so a mark is the sha and there
// is nothing to invalidate and nothing to prune — a sha whose commit a rebase left
// behind costs one short string and answers for nothing on screen.
//
// The question it exists for is the one a reader following somebody else's work opens
// with. Forty commits landed this week and eleven have been read; without this, finding
// out which eleven means reading them again.
//
// The store is one JSON file holding every repository's marks — see ./store.

const { loadEntries, saveEntries, storePathFor } = require("./store");

const STORE_FILENAME = "read-commits.json";

// A ceiling per repository. Two reading sessions a week for a decade is well inside
// it, and a store nothing bounds is a store that grows for the life of the repository.
const MAX_MARKS = 2000;

/** Where the store lives, given the environment the pane was launched with. */
function storePath(env) {
  return storePathFor(env, STORE_FILENAME);
}

/** Whether a parsed entry is one this can use. A hand-edited file may hold anything. */
function isMark(entry) {
  return (
    entry !== null &&
    typeof entry === "object" &&
    typeof entry.sha === "string" &&
    entry.sha !== ""
  );
}

/**
 * Read one repository's marks.
 * @returns {Array<{sha: string}>}
 */
function loadReadCommits(file, repoDir) {
  return loadEntries(file, repoDir, isMark);
}

/**
 * Write one repository's marks, leaving every other repository's alone.
 * @returns {{ok: true}|{ok: false, error: string}}
 */
function saveReadCommits(file, repoDir, marks) {
  return saveEntries(file, repoDir, marks);
}

/** Whether this commit is one the reader has been through. */
function isRead(marks, sha) {
  return marks.some((mark) => mark.sha === sha);
}

/**
 * Mark a commit read, or unread when it already is.
 *
 * One key rather than two, for the reason the bookmark key and the file's own read key
 * are one: the reader who wants the mark gone is looking at the commit that carries it.
 *
 * @returns {{marks: Array<{sha: string}>, read: boolean}}
 */
function toggleRead(marks, sha) {
  if (isRead(marks, sha)) {
    return { marks: marks.filter((mark) => mark.sha !== sha), read: false };
  }

  // Newest last, which is the order they were read in. The oldest goes when the list
  // is full: a commit read two thousand commits ago is the one least likely to be
  // asked about again.
  const grown = [...marks, { sha }];
  const kept = grown.length <= MAX_MARKS ? grown : grown.slice(grown.length - MAX_MARKS);
  return { marks: kept, read: true };
}

/** The marks as one lookup, for a frame that asks of every row it draws. */
function readShas(marks) {
  return new Set(marks.map((mark) => mark.sha));
}

/** How many of the commits on screen have been read, for the header to say. */
function readCount(marks, rows) {
  const shas = readShas(marks);
  return rows.filter((row) => row.commit !== null && shas.has(row.commit.sha)).length;
}

module.exports = {
  MAX_MARKS,
  STORE_FILENAME,
  isRead,
  loadReadCommits,
  readCount,
  readShas,
  saveReadCommits,
  storePath,
  toggleRead,
};
