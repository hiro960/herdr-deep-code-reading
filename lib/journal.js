"use strict";

// Where the reading has been.
//
// ./jump-history is the other half of this and answers a different question: where was
// I a moment ago. It is a stack, it empties as it is walked back, and it dies with the
// pane. This is the record of what was opened and in what order — kept, so that a
// reading spread over a week can be read back at the end of it, and written out as one
// document by lib/state/views/export.
//
// Only the deliberate opens are here: a file chosen in the browser, a commit chosen in
// the log or in a history list. Moving the graph cursor loads a commit and following a
// name loads a file, and neither is a thing the reader decided to read — a record of
// every jump is a record nobody reads back.
//
// An entry has no time on it until it is saved. The reducers are pure and a clock is
// the world; lib/run/effects stamps what it is about to write and puts the stamped list
// back on the state, so what is in hand and what is on disk never disagree.
//
// One constraint on where a visit can be recorded: a state carries one effect, so a
// transition that already asks the world for something cannot also ask for this.

const { loadEntries, saveEntries, storePathFor } = require("./store");

const STORE_FILENAME = "journal.json";

const KIND_FILE = "file";
const KIND_COMMIT = "commit";

// A ceiling per repository. Long enough to hold months of reading, short enough that
// the file stays one a person can open — and the export is a document to read rather
// than a log to grep.
const MAX_ENTRIES = 1000;

/** Where the store lives, given the environment the pane was launched with. */
function storePath(env) {
  return storePathFor(env, STORE_FILENAME);
}

/** Whether a parsed entry is one this can use. A hand-edited file may hold anything. */
function isEntry(entry) {
  if (entry === null || typeof entry !== "object") {
    return false;
  }
  if (entry.kind === KIND_FILE) {
    return typeof entry.path === "string" && entry.path !== "";
  }
  return entry.kind === KIND_COMMIT && typeof entry.sha === "string" && entry.sha !== "";
}

/** Read one repository's reading. */
function loadJournal(file, repoDir) {
  return loadEntries(file, repoDir, isEntry);
}

/** Write one repository's reading, leaving every other repository's alone. */
function saveJournal(file, repoDir, entries) {
  return saveEntries(file, repoDir, entries);
}

/** What two entries have to agree on to be the same place. */
function isSamePlace(one, other) {
  if (one === undefined || one.kind !== other.kind) {
    return false;
  }
  return one.kind === KIND_FILE ? one.path === other.path : one.sha === other.sha;
}

/**
 * Record a visit.
 *
 * The same place twice in a row is one entry: stepping out of a file and back into it
 * is one file read, and a record that says otherwise is a record of keystrokes. The
 * same place come back to after reading something else is worth having twice — that is
 * a reader going back to check something, which is exactly what a journal is for.
 */
function appendEntry(entries, entry) {
  if (isSamePlace(entries[entries.length - 1], entry)) {
    return entries;
  }

  const grown = [...entries, entry];
  return grown.length <= MAX_ENTRIES ? grown : grown.slice(grown.length - MAX_ENTRIES);
}

/** A file the reader opened. */
function fileEntry(filePath) {
  return { kind: KIND_FILE, path: filePath };
}

/**
 * A commit the reader opened.
 * The parents travel with it because what a commit's diff is against depends on them —
 * see lib/git — so a commit reached from this list opens the way it did the first time.
 */
function commitEntry(commit) {
  return {
    kind: KIND_COMMIT,
    sha: commit.sha,
    shortSha: commit.shortSha,
    subject: commit.subject,
    parents: commit.parents || [],
  };
}

/**
 * The reading as the rows a result list is built from.
 *
 * Two kinds of place, and both already have a shape a list can open: a file is a path
 * and a line, and a commit carries `isCommit` and opens a diff — see lib/history's
 * commitHits, which this follows.
 */
function journalHits(entries) {
  return entries.map((entry) => {
    if (entry.kind === KIND_FILE) {
      return { path: entry.path, line: 1, text: entry.path };
    }
    return {
      path: null,
      line: null,
      label: entry.shortSha || entry.sha.slice(0, 7),
      text: entry.subject || "",
      isCommit: true,
      commit: {
        sha: entry.sha,
        shortSha: entry.shortSha || entry.sha.slice(0, 7),
        subject: entry.subject || "",
        parents: entry.parents || [],
      },
    };
  });
}

module.exports = {
  KIND_COMMIT,
  KIND_FILE,
  MAX_ENTRIES,
  STORE_FILENAME,
  appendEntry,
  commitEntry,
  fileEntry,
  journalHits,
  loadJournal,
  saveJournal,
  storePath,
};
