"use strict";

// Subsequence matching for the file filter.
//
// Every query character has to appear in order, which is what makes "aps" find
// "app-state.js". Scoring then favours the matches a reader would have meant:
// contiguous runs, word boundaries, and matches near the start of the name.

const SCORE_BASE = 1;
const SCORE_CONSECUTIVE = 8;
const SCORE_BOUNDARY = 6;
const PENALTY_PER_LEADING_CHAR = 1;
const MAX_LEADING_PENALTY = 20;

const BOUNDARY_CHARS = new Set(["/", "-", "_", ".", " "]);

/** Whether the character at an index starts a new word. */
function isBoundary(text, index) {
  if (index === 0) {
    return true;
  }
  if (BOUNDARY_CHARS.has(text[index - 1])) {
    return true;
  }
  // camelCase: a capital after a lowercase starts a word
  return text[index - 1] === text[index - 1].toLowerCase() && text[index] !== text[index].toLowerCase();
}

/**
 * Lower a string without moving anything in it.
 *
 * Scoring compares against the lowered copy but asks the original what starts a word,
 * so a position has to mean the same thing in both. Almost every string lowers to the
 * same length, and that is one native call. A few characters do not — U+0130 lowers
 * to an `i` and a combining dot — and one of those in a path would push every
 * position after it along, leaving the boundary check reading the wrong character for
 * the rest of the name. Those characters are left as they are: not lowering one costs
 * a case-insensitive match on that character alone, where lowering it would quietly
 * misplace everything after it.
 */
function loweredInPlace(text) {
  const lowered = text.toLowerCase();
  if (lowered.length === text.length) {
    return lowered;
  }

  let out = "";
  for (const char of text) {
    const low = char.toLowerCase();
    out += low.length === char.length ? low : char;
  }
  return out;
}

/**
 * Score how well a name matches a query.
 * @returns {number|null} Higher is better; null when the query does not match
 */
function matchScore(name, query) {
  if (query === "") {
    return 0;
  }

  const haystack = loweredInPlace(name);
  const needle = loweredInPlace(query);

  let score = 0;
  let searchFrom = 0;
  // Where the previous match ended rather than where it began: a character outside
  // the basic plane is two units wide, so a run through one is only consecutive when
  // the next match starts where the last one finished.
  //
  // It starts at 0 so that a match on the first character counts as a run of its own.
  // A name that simply starts with what was typed is the one the reader meant, and it
  // has been scored that way since the beginning.
  let previousEnd = 0;
  let firstIndex = -1;

  for (const char of needle) {
    const found = haystack.indexOf(char, searchFrom);
    if (found === -1) {
      return null;
    }
    if (firstIndex === -1) {
      firstIndex = found;
    }

    score += SCORE_BASE;
    if (found === previousEnd) {
      score += SCORE_CONSECUTIVE;
    }
    if (isBoundary(name, found)) {
      score += SCORE_BOUNDARY;
    }

    previousEnd = found + char.length;
    searchFrom = previousEnd;
  }

  // A match that starts late in the name is usually the weaker one. Where it starts
  // is where the first character was found, which the search above already knows —
  // asking the string again would answer in units rather than characters.
  return score - Math.min(firstIndex * PENALTY_PER_LEADING_CHAR, MAX_LEADING_PENALTY);
}

/**
 * Keep the entries whose name matches, best first.
 * An empty query returns every entry in its original order.
 * @param {Array<{name: string}>} entries
 * @param {string} query
 * @returns {Array<object>} A new array; the input is untouched
 */
function filterByName(entries, query) {
  if (query === "") {
    return [...entries];
  }

  return entries
    .map((entry) => ({ entry, score: matchScore(entry.name, query) }))
    .filter((scored) => scored.score !== null)
    .sort((a, b) => b.score - a.score)
    .map((scored) => scored.entry);
}

module.exports = { filterByName, matchScore };
