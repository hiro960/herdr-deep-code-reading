"use strict";

// A stack of places worth coming back to.
//
// Reading a codebase is a walk: a search hit opens a file, a definition jump leaves
// that file for another, and the way back matters as much as the way in. Without a
// record of it, following a hit meant losing the result list that produced it.
//
// A place is the navigational slice of the state and nothing else — no comments, no
// input, no effect. Everything in that slice is already immutable, so a snapshot
// copies references rather than data and restoring one is a spread.

// Deep enough for a long reading session, shallow enough that the rows it holds onto
// cannot grow without bound.
const MAX_DEPTH = 50;

// The fields that say what is on screen and where the reader is in it. Rows are kept
// so that coming back does not re-read the file or re-run the diff.
const PLACE_FIELDS = [
  "view",
  // Which diff is loaded, not only which view is drawing it. A commit opened from
  // the log replaces the diff the pane was showing, so coming back has to bring the
  // old one with it — the mode alone would say "working tree" over a commit's files.
  "mode",
  "commit",
  "title",
  "files",
  "fileSummaries",
  "rows",
  // The width those rows were wrapped to. Coming back after a resize has to know
  // that they were built for a terminal this one is no longer the same size as.
  "columns",
  // And which diff layout they were built in, which the width no longer answers on
  // its own: a reader who chose the other one between leaving and coming back would
  // otherwise be given paired rows in a stacked diff. The choice itself is not a
  // place — going back is not meant to undo it.
  "sideBySide",
  "scroll",
  "cursor",
  "column",
  "selectionAnchor",
  "selectedIndex",
  "openPath",
  "readMode",
  "browse",
  "preview",
  // The log's four panes, which are a place the same way the browser's directory is:
  // a commit opened from the graph replaces the diff under it, and coming back has to
  // find the graph where it was left, on the commit it was opened from.
  "log",
  "hits",
  "searchQuery",
  // What the header calls a list. The search view carries the outline and the
  // imports list too, so leaving one of those for a search and coming back would
  // otherwise put the outline's name over the search's hits.
  "listTitle",
];

/** Snapshot where the reader is now. */
function placeOf(state) {
  const place = {};
  for (const field of PLACE_FIELDS) {
    place[field] = state[field];
  }
  return place;
}

/**
 * Record where the reader is, so the next jump can be undone.
 * @returns {Array<object>} A new stack; the oldest place is dropped at the limit
 */
function pushPlace(history, state) {
  const grown = [...history, placeOf(state)];
  return grown.length <= MAX_DEPTH ? grown : grown.slice(grown.length - MAX_DEPTH);
}

/**
 * Take the most recent place off the stack.
 * @returns {{place: object|null, history: Array<object>}} place is null when empty
 */
function popPlace(history) {
  if (history.length === 0) {
    return { place: null, history };
  }
  return { place: history[history.length - 1], history: history.slice(0, -1) };
}

/** Put a state back where a place says it was. */
function restorePlace(state, place) {
  return { ...state, ...place };
}

module.exports = { popPlace, pushPlace, restorePlace };
