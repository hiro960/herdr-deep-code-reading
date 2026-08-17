"use strict";

// Breaking one long line into the several a screen can show.
//
// Measured in terminal cells, not characters, because the lines that need this are
// usually the ones full of full-width text: a Japanese sentence is half as many
// characters as it is columns, and wrapping by character count would cut it in the
// wrong place every time.
//
// The break is hard — anywhere a character ends. Code has no reliable word to break
// at, and the text this exists for is written without spaces at all.

const { charWidth } = require("./text");

/**
 * Where a line has to be cut to fit a width.
 *
 * Ranges index the string by character, so the caller can slice both the text and
 * anything it has alongside — syntax tokens, say — with the same numbers. A
 * full-width character that would straddle the edge starts the next segment rather
 * than being split down the middle — so a character wider than the whole width gets
 * a segment of its own and overflows it, there being no half of it to show.
 *
 * @param {string} text One line, already prepared for display
 * @param {number} width Display columns available
 * @returns {Array<{from: number, to: number}>} At least one range, always
 */
function wrapSegments(text, width) {
  if (typeof text !== "string" || text === "") {
    return [{ from: 0, to: 0 }];
  }
  if (!Number.isFinite(width) || width < 1) {
    return [{ from: 0, to: text.length }];
  }

  const segments = [];
  let from = 0;
  let used = 0;
  let index = 0;

  while (index < text.length) {
    // Step by code point: a surrogate pair is one character, two units long
    const point = String.fromCodePoint(text.codePointAt(index));
    const cells = charWidth(point);

    if (used + cells > width && index > from) {
      segments.push({ from, to: index });
      from = index;
      used = 0;
    }

    used += cells;
    index += point.length;
  }

  segments.push({ from, to: text.length });
  return segments;
}

/** Whether a line needs more than one row at a width. */
function needsWrapping(text, width) {
  return wrapSegments(text, width).length > 1;
}

/**
 * Cut a token list to a character range.
 * Tokens tile the line in order, so the range is walked once alongside them.
 *
 * @param {Array<{text: string, type: string}>|null} tokens
 * @returns {Array<{text: string, type: string}>|null} null in, null out
 */
function sliceTokens(tokens, from, to) {
  if (tokens === null || tokens === undefined) {
    return tokens;
  }

  const sliced = [];
  let at = 0;

  for (const token of tokens) {
    const start = at;
    const end = at + token.text.length;
    at = end;

    if (end <= from || start >= to) {
      continue;
    }
    const text = token.text.slice(Math.max(0, from - start), Math.min(token.text.length, to - start));
    if (text !== "") {
      sliced.push({ text, type: token.type });
    }
  }

  return sliced;
}

/**
 * Cut a list of highlighted spans to a character range, re-based on it.
 *
 * The same job sliceTokens does, for the other thing a line carries alongside its
 * text. A span that straddles the cut appears on both rows, each time covering only
 * the part of it that row shows — which is what a highlighted word broken over a
 * wrap should look like.
 *
 * @param {Array<{start: number, end: number}>|undefined} spans Offsets into the line
 * @returns {Array<{start: number, end: number}>|undefined} undefined in, undefined out
 */
function sliceSpans(spans, from, to) {
  if (spans === null || spans === undefined) {
    return spans;
  }

  const sliced = [];

  for (const span of spans) {
    const start = Math.max(span.start, from);
    const end = Math.min(span.end, to);

    if (end > start) {
      sliced.push({ start: start - from, end: end - from });
    }
  }

  return sliced;
}

module.exports = { needsWrapping, sliceSpans, sliceTokens, wrapSegments };
