"use strict";

// What the terminal's width does to the rows, and what a key that overrules it does.
//
// The two diff layouts build rows differently, so a width change is a rebuild rather
// than a redraw — and a rebuild has to put the reader back where they were. That is
// the whole of this module: remembering a place in terms that survive the rebuild,
// and finding it again afterwards.

const {
  FALLBACK_COLUMNS,
  LAYOUT_SPLIT,
  LAYOUT_STACKED,
  diffTextWidths,
  readTextWidth,
  resolveLayout,
} = require("../../layout");
const { anchorFromRow } = require("../../comments");
const { firstDiffRow, rowsFor } = require("../rows");
const { MESSAGE_NO_SPLIT_ROOM, clearTransient, withMessage } = require("../messages");

/**
 * Where the cursor is, in terms a rebuilt row list can be searched by.
 *
 * A row index means nothing across a rebuild, and a line number means nothing across
 * the two-column layout, which numbers both sides. An anchor is what every row can
 * answer with — the side and the line — so it is what the cursor is remembered as.
 */
function positionUnderCursor(state) {
  const anchor = anchorFromRow(state.rows[state.cursor]);
  return anchor === null ? null : { side: anchor.side, start: anchor.start };
}

/**
 * The row a remembered position lands on, or -1.
 *
 * Crossing the two-column boundary pairs and unpairs lines, so a deleted line read
 * on the old side in one layout is read on the new side in the other and is not
 * found. That falls back to the top of the diff, which is what it did before any of
 * this — a layout flip has always been a fresh start.
 */
function rowOfPosition(rows, position) {
  return rows.findIndex((row) => {
    const anchor = anchorFromRow(row);
    return anchor !== null && anchor.side === position.side && anchor.start === position.start;
  });
}

/** Whether two sets of text widths would wrap a line the same way. */
function sameDiffWidths(a, b) {
  return a.unified === b.unified && a.left === b.left && a.right === b.right;
}

/**
 * Follow a terminal width change. The two diff layouts build rows differently, so
 * the rows are rebuilt whenever the layout flips — from whatever the view is on.
 *
 * A layout the reader chose is carried through the resize rather than recomputed
 * from the new width: a choice a dragged window edge undid would not be one. The
 * width still has the last word on a chosen split, which needs room to be drawn in.
 */
function withLayout(state, columns) {
  const sideBySide = resolveLayout(columns, state.layout).sideBySide;
  // Only the reader's rows are wrapped to a width. The diff's and the browser's are
  // the same list however wide the terminal is, and a result list is one row per
  // place, so nothing but the reader has to be rebuilt when the width alone moves.
  const was = state.columns || columns;
  const sameWrap =
    readTextWidth(columns) === readTextWidth(was) &&
    sameDiffWidths(diffTextWidths(resolveLayout(columns).diffWidth, sideBySide),
                   diffTextWidths(resolveLayout(was).diffWidth, state.sideBySide));

  if (sideBySide === state.sideBySide && sameWrap) {
    return { ...state, columns };
  }

  const position = positionUnderCursor(state);
  const offset = Math.max(0, state.cursor - state.scroll);
  const resized = { ...state, columns, sideBySide };
  const rows = rowsFor(resized);

  // A list of places is one row per place at any width, so rowsFor hands the same
  // rows straight back. Nothing was rebuilt, so there is nothing for the cursor to
  // be lost in — and it stays where the reader left it, marked run included. Finding
  // it again by line would fail anyway: a result row carries no line of its own, so
  // the search below would throw the reader to the top of the list every time a
  // window edge moved. The new width and layout are still recorded, because the diff
  // waiting behind the list will be drawn at them.
  if (rows === state.rows) {
    return resized;
  }

  // Dragging a terminal wider fires a resize for every column it passes through, so
  // the row the reader was on has to survive the rebuild — being thrown back to the
  // top of a long file once per column is not a way to read one. The line is found
  // again by number, and put back at the height on screen it was already at.
  const found = position === null ? -1 : rowOfPosition(rows, position);
  const cursor = found === -1 ? firstDiffRow(rows) : found;

  // A marked run is a pair of indexes into the old rows. A resize arrives from the
  // terminal rather than from a key, so it never passes the reducer that would
  // otherwise notice — and a run left pointing into rebuilt rows would put the next
  // comment on lines nobody chose.
  return {
    ...resized,
    rows,
    scroll: Math.max(0, cursor - offset),
    cursor,
    selectionAnchor: null,
  };
}

/**
 * Switch the diff between its two layouts, and keep it there.
 *
 * The terminal's width picks one when the pane opens, and it is only ever a guess
 * at what the reader wants: a wide pane is not always a reason to compare in two
 * columns, and a rename or a reindented block reads better as one list of lines.
 * The choice is remembered on the state, so a later resize follows it.
 *
 * Only a split can be refused, and only for want of room to draw one in — saying so
 * is more use than two columns too narrow to read.
 */
function toggleDiffLayout(state) {
  const layout = state.sideBySide ? LAYOUT_STACKED : LAYOUT_SPLIT;
  const columns = state.columns || FALLBACK_COLUMNS;
  const chosen = withLayout({ ...clearTransient(state), layout }, columns);

  if (chosen.sideBySide === state.sideBySide) {
    return withMessage(state, MESSAGE_NO_SPLIT_ROOM);
  }
  return chosen;
}

/**
 * The state as it has to be to be drawn at a width.
 *
 * A row is wrapped once, to the width the state was carrying when it was built, and
 * drawn later at whatever the terminal is now. The two are the same number as long as
 * every resize is seen — and one is not: the pane is sized after the process has read
 * its width and before it has begun listening, so a pane that arrives one column
 * narrower than it started keeps wrapping to a width it no longer has. Every wrapped
 * row is then one column too wide for the row it is drawn into, and the character that
 * falls off the end is gone rather than moved.
 *
 * So the frame asks rather than assumes. A width that has not moved gives the same
 * state back, which is every frame but the few after a resize.
 */
function drawnAt(state, columns) {
  return state.columns === columns ? state : withLayout(state, columns);
}

module.exports = {
  FALLBACK_COLUMNS,
  drawnAt,
  toggleDiffLayout,
  withLayout,
};
