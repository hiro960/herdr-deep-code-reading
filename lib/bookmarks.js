"use strict";

// Places worth coming back to after the pane has closed.
//
// ../jump-history is the other half of this and answers a different question: where
// was I a moment ago. It is a stack, it is emptied by going back through it, and it
// dies with the session. A bookmark is deliberate and outlives the pane — the file
// you will want again tomorrow, in the middle of reading something else today.
//
// A bookmark is anchored the way a comment is: by the text of the line, not only its
// number. Line numbers rot the moment anything above them is edited, and a reader
// sent to line 42 of a file that has since grown a header lands somewhere arbitrary.
// The number is where to start looking; the text is what is being looked for.
//
// The store is one JSON file holding every repository's bookmarks side by side —
// see ./store, which is where the reading and writing of one live.

const { loadEntries, saveEntries, storePathFor } = require("./store");

const STORE_FILENAME = "bookmarks.json";

// A ceiling per repository. High enough that nobody reading normally will meet it,
// low enough that a file this is appended to for a year stays a file worth reading.
const MAX_BOOKMARKS = 200;

/** Where the store lives, given the environment the pane was launched with. */
function storePath(env) {
  return storePathFor(env, STORE_FILENAME);
}

/** Whether a parsed entry is one this can use. A hand-edited file may hold anything. */
function isBookmark(entry) {
  return (
    entry !== null &&
    typeof entry === "object" &&
    typeof entry.path === "string" &&
    entry.path !== "" &&
    Number.isInteger(entry.line) &&
    entry.line > 0 &&
    typeof entry.text === "string"
  );
}

/**
 * Read one repository's bookmarks.
 * @returns {Array<{path: string, line: number, text: string}>}
 */
function loadBookmarks(file, repoDir) {
  return loadEntries(file, repoDir, isBookmark);
}

/**
 * Write one repository's bookmarks, leaving every other repository's alone.
 * @returns {{ok: true}|{ok: false, error: string}}
 */
function saveBookmarks(file, repoDir, bookmarks) {
  return saveEntries(file, repoDir, bookmarks);
}

/** Whether a bookmark names this exact place. */
function isAt(bookmark, filePath, line) {
  return bookmark.path === filePath && bookmark.line === line;
}

/**
 * Add a place, or take it away when it is already saved.
 *
 * One key rather than two. A list that only grows is a list nobody prunes, and the
 * reader who wants a bookmark gone is standing on it — which is exactly where the
 * key that made it was pressed.
 *
 * @returns {{bookmarks: Array<object>, added: boolean}}
 */
function toggleBookmark(bookmarks, place) {
  const at = bookmarks.findIndex((bookmark) => isAt(bookmark, place.path, place.line));

  if (at !== -1) {
    return { bookmarks: bookmarks.filter((_, index) => index !== at), added: false };
  }

  // Newest last, which is the order they were read in. The oldest goes when the
  // list is full: a bookmark nobody has returned to in two hundred saves is the
  // one least likely to be missed.
  const grown = [...bookmarks, place];
  const kept = grown.length <= MAX_BOOKMARKS ? grown : grown.slice(grown.length - MAX_BOOKMARKS);
  return { bookmarks: kept, added: true };
}

/**
 * The line a bookmark points at now, in a file that may have been edited since.
 *
 * The recorded line is checked first, because most of the time nothing has moved.
 * Failing that, the nearest line carrying the same text wins — a file that grew a
 * header moves everything below it by the same amount, so the nearest match is
 * almost always the right one. A bookmark whose line is gone altogether keeps its
 * number, clamped: the neighbourhood is still more use than the top of the file.
 *
 * @param {Array<string>} lines The file as it is now
 * @returns {number} A 1-based line number
 */
function bookmarkLine(bookmark, lines) {
  if (lines.length === 0) {
    return 1;
  }
  if (lines[bookmark.line - 1] === bookmark.text) {
    return bookmark.line;
  }

  let nearest = -1;
  let distance = Infinity;
  lines.forEach((text, index) => {
    if (text !== bookmark.text) {
      return;
    }
    const away = Math.abs(index + 1 - bookmark.line);
    if (away < distance) {
      distance = away;
      nearest = index + 1;
    }
  });

  if (nearest !== -1) {
    return nearest;
  }
  return Math.min(bookmark.line, lines.length);
}

/** Bookmarks as the rows a result list is built from. */
function bookmarkHits(bookmarks) {
  return bookmarks.map((bookmark) => ({
    path: bookmark.path,
    line: bookmark.line,
    text: bookmark.text,
  }));
}

module.exports = {
  MAX_BOOKMARKS,
  STORE_FILENAME,
  bookmarkHits,
  bookmarkLine,
  loadBookmarks,
  saveBookmarks,
  storePath,
  toggleBookmark,
};
