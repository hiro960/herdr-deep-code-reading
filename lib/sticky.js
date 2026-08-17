"use strict";

// The thing the cursor is inside, kept on screen while the inside of it scrolls past.
//
// It is the piece of context a reader loses first and misses most. A function long
// enough to need reading carefully is a function long enough that its own name has
// gone off the top by the time you are in the middle of it, and the answer to "what
// is this a part of" is then several keystrokes away — go up, read, come back, find
// your line again.
//
// Two views have an answer and they come by it differently. A diff already has one:
// git writes the enclosing function into every hunk header, and the header is a row
// like any other, so it only has to be found again. A file being read has to be
// looked for, by walking up from the cursor to the nearest line that declares
// something at a shallower indent than the line the cursor is on.
//
// Both walks are bounded. A scope a thousand rows away is not the answer to anything.

const { definitionOn } = require("./outline");
const { cellOfRow } = require("./view-model");

// How far up to look before giving up. Long enough for any function worth pinning,
// short enough that a ten-thousand-row diff does not cost a walk of it per keystroke.
const SEARCH_LIMIT = 1000;

const INDENT = /^[ \t]*/;

/** How far a line is indented, in characters. */
function indentOf(text) {
  return INDENT.exec(text)[0].length;
}

/** The text of a row, when the row is a line of code rather than a heading or a note. */
function lineTextOf(row) {
  if (row === undefined || row === null || (row.kind !== "line" && row.kind !== "pair")) {
    return null;
  }
  const cell = cellOfRow(row);
  return cell === null || cell.text === undefined ? null : cell.text;
}

/**
 * The indentation the cursor is at, ignoring blank lines.
 *
 * A blank line between two statements has no indentation of its own, and taking it at
 * face value would say the reader is at the top level and inside nothing.
 */
function cursorIndent(rows, cursor) {
  for (let at = cursor; at >= 0 && cursor - at < SEARCH_LIMIT; at -= 1) {
    const text = lineTextOf(rows[at]);
    if (text !== null && text.trim() !== "") {
      return indentOf(text);
    }
  }
  return 0;
}

/**
 * The line to pin above the body, or null when the cursor is inside nothing.
 *
 * The cursor's own row is never the answer: a reader sitting on a function's first
 * line can see its name without help, and pinning it there would show the same line
 * twice.
 *
 * @param {Array<object>} rows The rows on screen
 * @param {number} cursor Which of them the cursor is on
 * @param {string} [language] What lib/syntax made of the file, for the definition
 *   patterns. Omitted for a diff, which does not need them.
 * @returns {string|null} The text to pin, already trimmed of its indentation
 */
function stickyText(rows, cursor, language) {
  if (!Array.isArray(rows) || cursor <= 0 || cursor >= rows.length) {
    return null;
  }

  const indent = cursorIndent(rows, cursor);
  const floor = Math.max(0, cursor - SEARCH_LIMIT);

  for (let at = cursor - 1; at >= floor; at -= 1) {
    const row = rows[at];

    // A diff carries its own answer. git puts the enclosing function on every hunk
    // header, and the header is a row like any other once it has scrolled away.
    if (row.kind === "hunk") {
      return row.text;
    }

    const text = lineTextOf(row);
    if (text === null || text.trim() === "") {
      continue;
    }
    // Only something the cursor is inside. The function above the one being read is
    // a sibling, not a parent, and saying otherwise would be worse than saying nothing.
    if (indentOf(text) >= indent) {
      continue;
    }
    if (definitionOn(text, language) !== null) {
      return text.trim();
    }
  }

  return null;
}

module.exports = { SEARCH_LIMIT, stickyText };
