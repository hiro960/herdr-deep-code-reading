"use strict";

// The saved places, as a list to move through and jump from.
//
// A bookmark is the one kind of place that may be wrong by the time it is used. It
// records the line's own text as well as its number, so the number is where the jump
// starts looking and the text is what it looks for.

const { bookmarkHits, bookmarkLine } = require("../../bookmarks");
const { readFileLines } = require("../../file-view");
const { buildResultRows } = require("../../search");
const { prepareLine } = require("../../text");
const { withMessage } = require("../messages");
const { openList } = require("./lists");
const { jumpToHit } = require("./search");

/**
 * The saved places, as a list to move through and jump from.
 *
 * Opened even when there are none. A key that answers with a message the reader has
 * to catch before it fades is a key they cannot tell from a broken one, and an empty
 * list saying so is the same answer written where it can be read.
 */
function openBookmarks(state) {
  const saved = state.bookmarks || [];
  const hits = bookmarkHits(saved).map((hit) => ({ ...hit, isBookmark: true }));

  return openList(state, `bookmarks  (${hits.length})`, bookmarkRows(hits), hits);
}

/** The rows of the bookmark list, which says so when it is empty. */
function bookmarkRows(hits) {
  if (hits.length === 0) {
    return [{ kind: "note", text: "No bookmarks yet — press m on a line to save one" }];
  }
  return buildResultRows(hits);
}

/**
 * Open a bookmark, following its line to wherever the text has moved.
 *
 * The file is read again rather than the rows being searched: the rows were built
 * for the screen and a wrapped line is several of them, while the anchor is one line
 * of the file. Both sides are prepared the same way, so a tab is the same width in
 * the saved text as in the line being compared to it.
 */
function jumpToBookmark(state, bookmark, viewport) {
  const result = readFileLines(state.repoDir, bookmark.path);
  if (!result.ok) {
    return withMessage(state, result.reason);
  }

  const line = bookmarkLine(bookmark, result.lines.map(prepareLine));
  const moved = line === bookmark.line ? null : `${bookmark.path} moved to line ${line}`;
  const opened = jumpToHit(state, { path: bookmark.path, line }, viewport);

  return moved === null ? opened : { ...opened, message: moved };
}

module.exports = {
  jumpToBookmark,
  openBookmarks,
};
