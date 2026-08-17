"use strict";

// Which words of a changed line actually changed.
//
// The line colour says "this line is different", and that is all it says: a renamed
// variable and a rewritten expression are the same shade of red. This narrows it to
// the part that moved.
//
// The method is git's own contrib/diff-highlight: tokenise both lines, walk in from
// the front while the tokens agree, walk in from the back while they agree, and call
// what is left the change. It is linear, it needs nothing installed, and — the reason
// to prefer it to an edit-distance — it never claims a word changed when it did not.
// Where it is coarse it is coarse honestly: two lines that were reworked all through
// get one long span rather than a scattering of guesses.
//
// Two guards keep it from being noise. A line rewritten from end to end gets no spans
// at all, because highlighting nine tenths of a line says nothing the colour has not
// already said. And a very long line is left alone: a minified bundle on one line is
// not something anybody is reading word by word.

const { prepareLine } = require("./text");

// A word in any script, a run of whitespace, or one character of anything else.
// Splitting on ASCII word characters alone would make a Japanese line one token per
// character, and the walk would then stop at the first character that differs rather
// than at the first word.
const TOKEN = /[\p{L}\p{N}_]+|\s+|./gu;

// Past this, the walk is not worth doing and the answer would not be read anyway
const MAX_LINE_LENGTH = 1000;
// A change covering more of the line than this is the whole line, and saying so with
// a highlight adds nothing to saying it with the colour
const WHOLE_LINE_RATIO = 0.7;

/**
 * Break a line into the units a highlight may start and end on.
 * @returns {Array<{text: string, start: number, end: number}>}
 */
function tokenize(text) {
  const tokens = [];

  for (const match of text.matchAll(TOKEN)) {
    tokens.push({ text: match[0], start: match.index, end: match.index + match[0].length });
  }

  return tokens;
}

/** How many tokens at the front of both lists are the same. */
function commonPrefix(before, after) {
  const limit = Math.min(before.length, after.length);
  let at = 0;

  while (at < limit && before[at].text === after[at].text) {
    at += 1;
  }

  return at;
}

/** How many tokens at the back of both lists are the same, without overlapping the front. */
function commonSuffix(before, after, prefix) {
  const limit = Math.min(before.length, after.length) - prefix;
  let at = 0;

  while (
    at < limit &&
    before[before.length - 1 - at].text === after[after.length - 1 - at].text
  ) {
    at += 1;
  }

  return at;
}

/**
 * The one span the middle of a token list covers, or nothing when it is empty.
 * @returns {Array<{start: number, end: number}>} None or one; a list because that is
 *   what the caller paints with, and because a later refinement may find more than one
 */
function middleSpan(tokens, prefix, suffix) {
  const from = prefix;
  const to = tokens.length - suffix;

  if (to <= from) {
    return [];
  }
  return [{ start: tokens[from].start, end: tokens[to - 1].end }];
}

/** How much of a line a span covers, from 0 to 1. An empty line is covered entirely. */
function coverage(spans, length) {
  if (spans.length === 0) {
    return 0;
  }
  if (length === 0) {
    return 1;
  }
  return (spans[0].end - spans[0].start) / length;
}

/**
 * The parts of two lines that differ.
 *
 * @param {string} before The removed line's text
 * @param {string} after The added line's text
 * @returns {{old: Array<{start,end}>, new: Array<{start,end}>}} Character offsets into
 *   each line. Empty on both sides when there is nothing worth pointing at.
 */
function wordSpans(before, after) {
  const nothing = { old: [], new: [] };

  if (before === after) {
    return nothing;
  }
  if (before.length > MAX_LINE_LENGTH || after.length > MAX_LINE_LENGTH) {
    return nothing;
  }

  const oldTokens = tokenize(before);
  const newTokens = tokenize(after);
  const prefix = commonPrefix(oldTokens, newTokens);
  const suffix = commonSuffix(oldTokens, newTokens, prefix);

  const spans = {
    old: middleSpan(oldTokens, prefix, suffix),
    new: middleSpan(newTokens, prefix, suffix),
  };

  // Both sides have to be worth reading. A short line whose every token changed is
  // covered entirely on both sides, and that is the case this drops.
  if (
    coverage(spans.old, before.length) > WHOLE_LINE_RATIO &&
    coverage(spans.new, after.length) > WHOLE_LINE_RATIO
  ) {
    return nothing;
  }

  return spans;
}

/**
 * Which removed lines of a hunk answer to which added ones.
 *
 * A run of removals followed by an equally long run of additions is read as that many
 * edits, one line for one line. A run of three becoming a run of one is a rewrite:
 * there is no honest way to say which of the three the survivor came from, so nothing
 * is paired and nothing is highlighted. git's diff-highlight draws the line in the
 * same place, for the same reason.
 *
 * @param {Array<{type: string}>} lines A hunk's lines, in order
 * @returns {Array<[number, number]>} Index pairs into that list, removed then added
 */
function pairedLines(lines) {
  const pairs = [];
  let at = 0;

  while (at < lines.length) {
    if (lines[at].type !== "del") {
      at += 1;
      continue;
    }

    let removed = at;
    while (removed < lines.length && lines[removed].type === "del") {
      removed += 1;
    }

    let added = removed;
    while (added < lines.length && lines[added].type === "add") {
      added += 1;
    }

    const removedCount = removed - at;
    const addedCount = added - removed;

    if (removedCount === addedCount) {
      for (let step = 0; step < removedCount; step += 1) {
        pairs.push([at + step, removed + step]);
      }
    }

    at = added > removed ? added : removed;
  }

  return pairs;
}

/**
 * Write the spans onto the lines of every hunk of every file.
 *
 * The offsets are into the line as the screen will have it — tabs already expanded —
 * because that is what everything downstream slices and paints. Computing them against
 * the raw text would put every span on a tab-indented line in the wrong place.
 *
 * The files are changed in place, once, on the way out of the parser. Doing it per
 * frame would mean walking every line of the diff on every keystroke.
 *
 * @param {Array<object>} files Files from parseUnifiedDiff
 * @returns {Array<object>} The same files
 */
function markWordSpans(files) {
  for (const file of files) {
    for (const hunk of file.hunks) {
      for (const [removed, added] of pairedLines(hunk.lines)) {
        const before = hunk.lines[removed];
        const after = hunk.lines[added];
        const spans = wordSpans(prepareLine(before.text), prepareLine(after.text));

        if (spans.old.length > 0) {
          before.spans = spans.old;
        }
        if (spans.new.length > 0) {
          after.spans = spans.new;
        }
      }
    }
  }

  return files;
}

/**
 * Carry a line's word spans onto the cell built from it, when it has any.
 *
 * Both layouts build fresh cells out of the parsed lines, and both have to bring this
 * along: it belongs to the line rather than to the layout. The key is left off
 * entirely when there is nothing to say, the way `blame` is — a cell carrying
 * `spans: undefined` is a cell that no longer equals the one a test wrote out by hand.
 */
function withSpans(cell, line) {
  return line.spans === undefined ? cell : { ...cell, spans: line.spans };
}

module.exports = {
  markWordSpans,
  pairedLines,
  tokenize,
  withSpans,
  wordSpans,
};
