"use strict";

// Finding typed text in the rows already on screen.
//
// The rows are the file as the reader sees it — wrapped into pieces, and in whichever
// layout a diff is being shown in — so scanning them is what makes a jump land where
// the text actually is on screen.
//
// Nothing is remembered between presses: a match is worked out again from the rows in
// front of the reader every time. A row index is only true of the row list it came
// from, and that list is rebuilt by a resize, by a rewrap, and by the switch between a
// file's contents and its diff — so keeping one would eventually point at a line
// nobody searched for. The query is the only thing worth holding on to.

const { cellOfRow } = require("./view-model");

/** The text of a row where the column cursor can reach it, or null. */
function textOfRow(row) {
  const cell = cellOfRow(row);
  return cell === null || cell.text === undefined ? null : cell.text;
}

/** First match in a row at or after a column, or -1. */
function matchForward(row, query, fromColumn) {
  const text = textOfRow(row);
  return text === null ? -1 : text.indexOf(query, Math.max(0, fromColumn));
}

/** Last match in a row starting before a column, or -1. */
function matchBackward(row, query, beforeColumn) {
  const text = textOfRow(row);
  if (text === null) {
    return -1;
  }
  const limit = Math.min(beforeColumn, text.length) - 1;
  return limit < 0 ? -1 : text.lastIndexOf(query, limit);
}

/** The first match in a row, from whichever end the search is coming from. */
function matchInRow(row, query, delta) {
  return delta > 0 ? matchForward(row, query, 0) : matchBackward(row, query, Infinity);
}

/**
 * Scan a run of rows, in the direction the search is going.
 * @returns {{row: number, column: number}|null}
 */
function scan(rows, query, from, to, delta) {
  for (let index = from; index !== to + delta; index += delta) {
    const column = matchInRow(rows[index], query, delta);
    if (column !== -1) {
      return { row: index, column };
    }
  }
  return null;
}

/**
 * Where a query next appears, starting from where the reader is.
 *
 * The row under the cursor is searched from the column the cursor is on rather than
 * from its start, so two matches on one line are two places to stop rather than one.
 * Running off either end comes back round to the other, and says that it did: a jump
 * that lands above where the reader was looking is otherwise hard to read as a jump.
 *
 * @param {Array<object>} rows The rows on screen
 * @param {string} query Literal text, exactly as it was typed
 * @param {{row: number, column: number}} from Where to start, exclusive
 * @param {number} delta 1 to look forward, -1 to look back
 * @returns {{row: number, column: number, wrapped: boolean}|null} null when the query
 *   is in none of the rows
 */
function findMatch(rows, query, from, delta) {
  if (!query || rows.length === 0) {
    return null;
  }

  const last = rows.length - 1;
  const row = Math.max(0, Math.min(from.row, last));
  const column = Math.max(0, from.column || 0);

  // The rest of the row the cursor is on, past the match it may already be sitting on
  const here =
    delta > 0
      ? matchForward(rows[row], query, column + 1)
      : matchBackward(rows[row], query, column);
  if (here !== -1) {
    return { row, column: here, wrapped: false };
  }

  const ahead = delta > 0 ? scan(rows, query, row + 1, last, 1) : scan(rows, query, row - 1, 0, -1);
  if (ahead !== null) {
    return { ...ahead, wrapped: false };
  }

  // Round the end and back to where the reader started, which is included: a file
  // with one match still answers `n` with it rather than claiming there is none
  const around = delta > 0 ? scan(rows, query, 0, row, 1) : scan(rows, query, last, row, -1);
  return around === null ? null : { ...around, wrapped: true };
}

module.exports = { findMatch };
