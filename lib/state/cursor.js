"use strict";

// Where the reader is, and every way of moving it.
//
// Two cursors: a row in the list on screen, and a column along the line that row
// carries. A run of marked rows is a third thing the same keys move, so it lives
// here too. Nothing here decides what the rows are — see ./rows.

const { anchorFromRow } = require("../comments");
const { findMatch } = require("../find");
const { clampColumn, moveWord, wordAt } = require("../line-cursor");
const { prepareLine } = require("../text");
const { cellOfRow } = require("../view-model");
const { diffWidthsFor, firstDiffRow, rowsForSelection } = require("./rows");
const {
  MESSAGE_FIND_WRAPPED_BOTTOM,
  MESSAGE_FIND_WRAPPED_TOP,
  MESSAGE_NOTHING_TO_FIND,
  MESSAGE_NO_LINE,
  clearTransient,
  withMessage,
} = require("./messages");

/** Keep the cursor inside the visible window. */
function scrollToCursor(scroll, cursor, viewport) {
  if (cursor < scroll) {
    return cursor;
  }
  if (cursor >= scroll + viewport) {
    return cursor - viewport + 1;
  }
  return scroll;
}

/** Move the file selection, resetting the diff position. */
function withSelection(state, nextIndex) {
  const clamped = Math.max(0, Math.min(nextIndex, state.files.length - 1));
  if (clamped === state.selectedIndex) {
    return state;
  }
  const rows = rowsForSelection(state.files, clamped, state.sideBySide, diffWidthsFor(state));
  return {
    ...clearTransient(state),
    selectedIndex: clamped,
    rows,
    scroll: 0,
    cursor: firstDiffRow(rows),
  };
}

/** The cell the cursor is on, or null when the row carries no line. */
function cursorCell(state) {
  return cellOfRow(state.rows[state.cursor]);
}

/** The line under the cursor, prepared exactly as the renderer will draw it. */
function cursorLineText(state) {
  const cell = cursorCell(state);
  return cell === null ? null : prepareLine(cell.text);
}

/** Put the cursor on a row and the screen at a scroll, with the column made to fit. */
function placedAt(state, cursor, scroll) {
  const moved = { ...clearTransient(state), cursor, scroll };

  // The column outlives the row it was set on, so a move onto a shorter line pulls
  // it back rather than leaving it pointing past the end
  return { ...moved, column: clampColumn(cursorLineText(moved), moved.column || 0) };
}

/** A row index the rows in hand actually have. */
function clampCursor(state, nextCursor) {
  return Math.max(0, Math.min(nextCursor, state.rows.length - 1));
}

/** Move the diff cursor, scrolling to follow it. */
function withCursor(state, nextCursor, viewport) {
  const clamped = clampCursor(state, nextCursor);
  return placedAt(state, clamped, scrollToCursor(state.scroll, clamped, viewport));
}

// Where a jumped-to line is left on the screen: a third of the way down, so that
// twice as much of what follows it is visible as of what leads up to it. A definition
// is read downwards, and the lines above it are context rather than the answer.
const JUMP_LEAD = 3;

/**
 * Where the screen rests when the cursor arrives somewhere it was not.
 *
 * Stepping scrolls by the least it can, which is right for a key held down and wrong
 * for a jump: the least a jump can scroll puts the line on the last row of the body,
 * with the whole of what came before it on screen and none of the function it named.
 * So a jump places the screen instead of nudging it — and stops at either end, because
 * scrolling past the top to centre line 3 would show rows that do not exist.
 */
function restingScroll(cursor, total, viewport) {
  const last = Math.max(0, total - viewport);
  return Math.min(Math.max(0, cursor - Math.floor(viewport / JUMP_LEAD)), last);
}

/**
 * Move the cursor somewhere it was not, and put the screen around it.
 * This is what following a name, opening a result and going to a bookmark all do;
 * every key that steps a row at a time goes through withCursor instead.
 */
function jumpToCursor(state, nextCursor, viewport) {
  const clamped = clampCursor(state, nextCursor);
  return placedAt(state, clamped, restingScroll(clamped, state.rows.length, viewport));
}

/** Move along the line under the cursor. */
function withColumn(state, nextColumn) {
  const column = clampColumn(cursorLineText(state), nextColumn);
  if (column === state.column) {
    return clearTransient(state);
  }
  return { ...clearTransient(state), column };
}

/** Step one character sideways. */
function moveColumnBy(state, delta) {
  return withColumn(state, (state.column || 0) + delta);
}

/** Step to the start of the next or previous identifier. */
function moveWordBy(state, delta) {
  const text = cursorLineText(state);
  if (text === null) {
    return clearTransient(state);
  }
  return withColumn(state, moveWord(text, state.column || 0, delta));
}

/**
 * Whether a run of rows is currently marked.
 * Hand-built states in tests predate the field, so its absence reads as "nothing
 * marked" rather than as a selection anchored at NaN.
 */
function hasSelection(state) {
  return state.selectionAnchor !== null && state.selectionAnchor !== undefined;
}

/**
 * The rows a comment would cover: the selected run, or the row under the cursor.
 * @returns {Array<object>} In screen order, whichever end the selection started at
 */
function selectedRows(state) {
  if (!hasSelection(state)) {
    return [state.rows[state.cursor]];
  }
  const from = Math.min(state.selectionAnchor, state.cursor);
  const to = Math.max(state.selectionAnchor, state.cursor);
  return state.rows.slice(from, to + 1);
}

/** Start marking a run of lines, or drop the run already being marked. */
function toggleSelection(state) {
  if (hasSelection(state)) {
    return { ...clearTransient(state), selectionAnchor: null };
  }
  if (anchorFromRow(state.rows[state.cursor]) === null) {
    return withMessage(state, MESSAGE_NO_LINE);
  }
  return { ...clearTransient(state), selectionAnchor: state.cursor };
}

/**
 * The identifier the cursor is on, as text, or an empty string.
 * What a key that opens a field prefilled with "the thing you are looking at" needs.
 */
function wordUnderCursor(state) {
  const text = cursorLineText(state);
  const word = text === null ? null : wordAt(text, state.column || 0);
  return word === null ? "" : word.text;
}

/** Move the cursor by a number of rows, staying inside the list. */
function moveCursorBy(state, delta, viewport) {
  return withCursor(state, state.cursor + delta, viewport);
}

/**
 * Move the cursor to where a query appears next, in either direction.
 *
 * Both the search that has just been typed and the two keys that repeat it come
 * through here, so the query is a parameter rather than read off the state: `/`
 * knows what was typed before the state carries it, and `n` only knows what the
 * state remembers.
 *
 * The column moves with the row, onto the match itself. It is what the reader is
 * looking for, so it is what the word cursor should be sitting on — and a jump that
 * left the column at the start of the line would make the next `n` on a line with two
 * matches go round the whole file to come back to the second one.
 *
 * @param {string} query Literal text, exactly as it was typed
 * @param {number} delta 1 to look forward, -1 to look back
 */
function withMatch(state, query, delta, viewport) {
  if (!query) {
    return withMessage(state, MESSAGE_NOTHING_TO_FIND);
  }

  const from = { row: state.cursor, column: state.column || 0 };
  const found = findMatch(state.rows, query, from, delta);

  if (found === null) {
    return withMessage(state, `No matches for ${query}`);
  }

  // The message is set after the move, not before: moving the cursor is what clears
  // the last one, and it would take this one with it
  const moved = withCursor({ ...state, column: found.column }, found.row, viewport);
  if (!found.wrapped) {
    return moved;
  }

  const wrapped = delta > 0 ? MESSAGE_FIND_WRAPPED_TOP : MESSAGE_FIND_WRAPPED_BOTTOM;
  return { ...moved, message: wrapped };
}

module.exports = {
  cursorLineText,
  jumpToCursor,
  wordUnderCursor,
  hasSelection,
  moveColumnBy,
  moveCursorBy,
  moveWordBy,
  scrollToCursor,
  selectedRows,
  toggleSelection,
  withCursor,
  withMatch,
  withSelection,
};
