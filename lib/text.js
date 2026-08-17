"use strict";

// Display-width helpers.
// Columns are measured in terminal cells rather than characters so that CJK text
// and emoji in a diff do not push the layout out of alignment.

const WIDE_CHAR_RANGES = [
  [0x1100, 0x115f], // Hangul Jamo
  [0x2e80, 0x303e], // CJK Radicals Supplement through CJK Symbols
  [0x3041, 0x33ff], // Kana through CJK Compatibility
  [0x3400, 0x4dbf], // CJK Extension A
  [0x4e00, 0x9fff], // CJK Unified Ideographs
  [0xa000, 0xa4cf], // Yi Syllables
  [0xa960, 0xa97f], // Hangul Jamo Extended-A
  [0xac00, 0xd7a3], // Hangul Syllables
  [0xf900, 0xfaff], // CJK Compatibility Ideographs
  [0xfe10, 0xfe19], // Vertical Forms
  [0xfe30, 0xfe6f], // CJK Compatibility Forms
  [0xff00, 0xff60], // Fullwidth Forms (halfwidth kana at 0xFF61+ is excluded)
  [0xffe0, 0xffe6], // Fullwidth Signs
  [0x1f004, 0x1f004], // Mahjong Red Dragon
  [0x1f0cf, 0x1f0cf], // Playing Card Black Joker
  [0x1f18e, 0x1f18e], // Negative Squared AB
  [0x1f191, 0x1f19a], // Squared CL through Squared VS
  [0x1f200, 0x1f2ff], // Enclosed Ideographic Supplement
  [0x1f300, 0x1f64f], // Emoji
  [0x1f680, 0x1f6ff], // Transport and Map Symbols
  [0x1f7e0, 0x1f7eb], // Coloured circles and squares
  [0x1f900, 0x1f9ff], // Supplemental Symbols and Pictographs
  [0x1fa70, 0x1faff], // Symbols and Pictographs Extended-A
  [0x20000, 0x2fffd], // CJK Extension B and beyond
  [0x30000, 0x3fffd],
];

const ZERO_WIDTH = /^[\p{Mn}\p{Me}\p{Cf}]$/u;
// Everything a terminal would act on rather than draw. C1 (U+0080–U+009F) is in the
// range with C0 and DEL: a terminal reading UTF-8 may still read U+009B as CSI and
// U+009D as OSC, so a guard written against the escape character alone would let the
// same sequence through in its eight-bit spelling.
//
// The bidi controls are stripped for the same reason, one step further out. U+202A to
// U+202E embed and override, U+2066 to U+2069 isolate: all nine are drawn as nothing
// and reorder what comes after them, so a line can appear on screen in an order it was
// not written in — a comment marker that is really inside the string, a return that is
// really after it. This is the tool a reader uses to find out what a change really
// does, and a character whose only effect is to make that answer wrong has no business
// reaching the screen, or the batch that goes to an agent. U+200E and U+200F are left
// alone: they lean on a neighbour and reorder nothing.
const CONTROL_CHARS = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g;

const FIRST_ASCII_PRINTABLE = 0x20;
const DELETE_CODE_POINT = 0x7f;
const WIDE_WIDTH = 2;
const NARROW_WIDTH = 1;
const ZERO = 0;

function isWideCodePoint(codePoint) {
  for (const [start, end] of WIDE_CHAR_RANGES) {
    if (codePoint >= start && codePoint <= end) {
      return true;
    }
  }
  return false;
}

/**
 * Display width of a single code point.
 * Source code is overwhelmingly printable ASCII, and every one of those characters
 * is one cell wide, so that case answers before the property regex is consulted.
 */
function charWidth(char) {
  const codePoint = char.codePointAt(0);
  if (codePoint >= FIRST_ASCII_PRINTABLE && codePoint < DELETE_CODE_POINT) {
    return NARROW_WIDTH;
  }
  if (ZERO_WIDTH.test(char)) {
    return ZERO;
  }
  return isWideCodePoint(codePoint) ? WIDE_WIDTH : NARROW_WIDTH;
}

/** Display width of a whole string. */
function displayWidth(text) {
  let width = 0;
  for (const char of text) {
    width += charWidth(char);
  }
  return width;
}

/** Expand tabs to the next tab stop, measured in display columns. */
function expandTabs(text, tabWidth) {
  let out = "";
  let column = 0;

  for (const char of text) {
    if (char === "\t") {
      const spaces = tabWidth - (column % tabWidth);
      out += " ".repeat(spaces);
      column += spaces;
      continue;
    }
    out += char;
    column += charWidth(char);
  }

  return out;
}

/** Truncate to a display width without splitting a full-width character. */
function truncateToWidth(text, maxWidth) {
  if (maxWidth <= 0) {
    return "";
  }

  let out = "";
  let width = 0;

  for (const char of text) {
    const next = width + charWidth(char);
    if (next > maxWidth) {
      break;
    }
    out += char;
    width = next;
  }

  return out;
}

/** Pad on the right up to a display width. Longer strings are returned untouched. */
function padToWidth(text, width) {
  const current = displayWidth(text);
  if (current >= width) {
    return text;
  }
  return text + " ".repeat(width - current);
}

/**
 * Fit text to an exact display width: clip what overflows, pad what falls short.
 * The order matters — truncating after padding would undo the padding — so it is
 * expressed once here rather than at each call site.
 *
 * Control characters are stripped first, and this is the one place every cell of every
 * frame passes through, which is why they are stripped here rather than at the dozen
 * call sites above it.
 *
 * A diff line and a file line arrive already prepared, so for them this is a second
 * pass over text that has none. Everything else on screen does not: a file name, a
 * commit subject, an author, the label an agent wrote beside a note. All four come
 * back from git or from a file verbatim — `git`'s -z output is unquoted by definition —
 * and a pane that drew them would be a pane the repository can repaint, in a program
 * whose whole purpose is to show a reader what a change really does.
 *
 * It is also what keeps the width honest. An escape counts as a column to anything
 * measuring characters and none to the terminal drawing them, so a row carrying one
 * came out narrower than the frame had allowed for.
 */
function fitToWidth(text, width) {
  return padToWidth(truncateToWidth(sanitize(text), width), width);
}

/** Strip control characters that would corrupt the display. Tabs are left to expandTabs. */
function sanitize(text) {
  return text.replace(CONTROL_CHARS, "");
}

const TAB_WIDTH = 4;

/**
 * A line as it will be shown: no control characters, tabs expanded.
 *
 * The renderer draws this and the cursor counts columns into it, so the two have to
 * agree on what a line looks like. Doing it in one place is what makes a column mean
 * the same thing on screen as it does in the state.
 */
function prepareLine(text) {
  return expandTabs(sanitize(text), TAB_WIDTH);
}

module.exports = {
  charWidth,
  displayWidth,
  expandTabs,
  fitToWidth,
  padToWidth,
  prepareLine,
  sanitize,
  truncateToWidth,
};
