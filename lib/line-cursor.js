"use strict";

// Where the cursor is along a line, and which word that puts it on.
//
// The row cursor answers "which line"; this answers "which word of it", which is the
// question a jump to a definition has to have an answer for. Offsets here count
// characters of the prepared line — the one with tabs already expanded, which is
// also the one the renderer draws — so a column is the same thing to both layers.

// Deliberately not per-language. Every language this tool highlights writes an
// identifier the same way, and a word cursor that is wrong at the edges is better
// than one that needs a grammar to place.
const IDENTIFIER = /[A-Za-z_$][A-Za-z0-9_$]*/g;

const NO_WORDS = [];

/**
 * The identifiers on a line, in order.
 * @returns {Array<{start: number, end: number, text: string}>} end is exclusive
 */
function wordsIn(text) {
  if (typeof text !== "string" || text === "") {
    return NO_WORDS;
  }

  const words = [];
  // A fresh regex each call: a shared global one carries lastIndex between lines
  const scanner = new RegExp(IDENTIFIER.source, "g");
  let match = scanner.exec(text);

  while (match !== null) {
    words.push({ start: match.index, end: match.index + match[0].length, text: match[0] });
    match = scanner.exec(text);
  }

  return words;
}

/** Keep a column inside the line. A column may sit one past the last character. */
function clampColumn(text, column) {
  const length = typeof text === "string" ? text.length : 0;
  if (!Number.isFinite(column)) {
    return column > 0 ? Math.max(0, length - 1) : 0;
  }
  return Math.max(0, Math.min(Math.trunc(column), Math.max(0, length - 1)));
}

/**
 * The identifier the column sits on.
 * A column in the whitespace between two words belongs to neither: the reader is
 * pointing at nothing, and a jump has nothing to follow.
 * @returns {{start: number, end: number, text: string}|null}
 */
function wordAt(text, column) {
  for (const word of wordsIn(text)) {
    if (column >= word.start && column < word.end) {
      return word;
    }
  }
  return null;
}

/**
 * Move to the start of the next or previous identifier.
 * Running out in either direction parks the cursor at that end of the line, which is
 * what every other movement key in this tool does.
 */
function moveWord(text, column, delta) {
  const words = wordsIn(text);
  if (words.length === 0) {
    return clampColumn(text, column);
  }

  if (delta > 0) {
    const next = words.find((word) => word.start > column);
    return next === undefined ? words[words.length - 1].start : next.start;
  }

  const earlier = words.filter((word) => word.start < column);
  return earlier.length === 0 ? words[0].start : earlier[earlier.length - 1].start;
}

module.exports = { clampColumn, moveWord, wordAt, wordsIn };
