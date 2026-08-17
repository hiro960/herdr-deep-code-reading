"use strict";

// What an agent has to say about a line, shown beside it.
//
// The plugin has always sent one way. `S` hands a review to a coding agent in another
// pane and nothing comes back — which is half of a conversation, and the wrong half
// for reading unfamiliar code. Reviewing is telling; reading is asking.
//
// A note is a line of a file with something written against it by something that is
// not the reader. It arrives the way everything else about the outside world arrives
// here: as a file, written by whoever has something to say, noticed by the watch, and
// read on the next reload. There is no socket and no protocol — an agent that can run
// one command can leave a note, and bin/note.js is that command.
//
// A note is anchored the way a comment and a bookmark are, by the text of the line as
// well as its number, because the agent that wrote it is about to edit the file it is
// about. The number is where to start looking; the text is what is looked for.

const { loadEntries, saveEntries, storePathFor } = require("./store");

const STORE_FILENAME = "notes.json";

// A ceiling per repository. An agent asked to annotate a large change can write a
// great many of these, and a pane is not improved by ten thousand of them.
const MAX_NOTES = 500;

// And a ceiling on one of them. An answer is a paragraph or two — what a class is for,
// when a branch is taken — and an agent asked to explain a module can write a page.
// Long enough for the answer, short enough that the store stays a file a person can
// open.
const MAX_NOTE_LENGTH = 4000;
// What says the rest was cut. A note that ends mid-sentence with nothing to say so
// reads as an agent that stopped talking.
const TRUNCATION_MARK = "…";

/** Where the store lives, given the environment the pane was launched with. */
function storePath(env) {
  return storePathFor(env, STORE_FILENAME);
}

/** Whether a parsed entry is one this can use. Anything at all may write this file. */
function isNote(entry) {
  return (
    entry !== null &&
    typeof entry === "object" &&
    typeof entry.path === "string" &&
    entry.path !== "" &&
    Number.isInteger(entry.line) &&
    entry.line > 0 &&
    typeof entry.text === "string" &&
    entry.text !== ""
  );
}

/**
 * Read one repository's notes.
 * A file written by something else is a file that may hold anything, so everything
 * that is not a note is left out rather than being a reason to fail.
 */
function loadNotes(file, repoDir) {
  return loadEntries(file, repoDir, isNote);
}

/** Write one repository's notes, leaving every other repository's alone. */
function saveNotes(file, repoDir, notes) {
  return saveEntries(file, repoDir, notes);
}

/**
 * One note's text, cut to what the store keeps.
 *
 * Cut rather than refused. This file is written by something that is not the reader,
 * and an agent asked to explain a module may answer at length; a note dropped for being
 * too long is an answer the reader never learns was given, which is the worse of the
 * two failures by some way.
 */
function trimmedText(text) {
  return text.length <= MAX_NOTE_LENGTH
    ? text
    : text.slice(0, MAX_NOTE_LENGTH) + TRUNCATION_MARK;
}

/**
 * Add a note, dropping the oldest when there are too many.
 * Notes are appended rather than replaced: an agent asked twice about one file has
 * two things to say about it, and the second does not cancel the first.
 */
function addNote(notes, note) {
  const grown = [...notes, { ...note, text: trimmedText(note.text) }];
  return grown.length <= MAX_NOTES ? grown : grown.slice(grown.length - MAX_NOTES);
}

/**
 * The notes written against one line of one file.
 *
 * The new side and no side: whatever wrote a note was looking at the file rather than
 * at a diff of it, so it answers for the file as it is. lib/render/diff-rows.rowHasNote
 * draws the mark from the same rule, and the two have to agree — a line with `◆` in the
 * gutter and nothing to show when it is asked is worse than no mark at all.
 */
function notesAt(notes, filePath, line) {
  return notes.filter((note) => note.path === filePath && note.line === line);
}

/**
 * Notes as the rows a result list is built from.
 *
 * The same shape a search hit and a bookmark wear, because to a reader they are the
 * same thing: somewhere to look, and a key that goes there. The note itself travels
 * on the hit, so the list can read one out without going to find it again.
 */
function noteHits(notes) {
  return notes.map((note) => ({
    path: note.path,
    line: note.line,
    // One row is one line. A note may be a paragraph, and the list is for finding the
    // one to read rather than for reading them.
    text: `${note.text.split("\n")[0]}   — ${note.from || "agent"}`,
    note,
  }));
}

/** Which lines of a file carry a note, as the keys the gutter is drawn from. */
function noteLines(notes, filePath) {
  const lines = new Set();

  for (const note of notes) {
    if (note.path === filePath) {
      lines.add(note.line);
    }
  }

  return lines;
}

module.exports = {
  MAX_NOTES,
  MAX_NOTE_LENGTH,
  addNote,
  loadNotes,
  noteHits,
  noteLines,
  notesAt,
  saveNotes,
  storePath,
};
