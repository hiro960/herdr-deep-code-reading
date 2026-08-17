"use strict";

// Resolves the screen layout from the terminal's column count.
// Both the renderer and the state machine need this decision, so it lives in one place.

const PANEL_WIDTH = 34;
const PANEL_MIN_COLUMNS = 100;
const SIDE_BY_SIDE_MIN_COLUMNS = 160;
const MIN_DIFF_WIDTH = 20;

// Columns a row spends before the line itself: the cursor and comment marks, the
// line number, and the lead in front of the text. The renderer draws them and the
// row builder wraps to what is left, so the arithmetic lives here rather than in
// both — and the two leads are named apart because a one-row layout keeps a column
// for the +/- sign that a two-column one has no room for.
const GUTTER_WIDTH = 2;
const LINE_NUMBER_WIDTH = 5;
const SIDE_LEAD_WIDTH = 1;
const UNIFIED_LEAD_WIDTH = 2;
const SEPARATOR_WIDTH = 1;
const MIN_TEXT_WIDTH = 8;

// The width to assume when nobody has said one: a terminal that does not report its
// size, and a state built by a test that had no terminal to ask. Three modules wanted
// this and each declared its own 80, which is three places to find when the answer
// changes — and two of them did not export it, so nothing could have shared it.
const FALLBACK_COLUMNS = 80;

// Width the diff area needs for two columns. Roughly 160 columns including the panel.
const SIDE_BY_SIDE_MIN_DIFF_WIDTH = SIDE_BY_SIDE_MIN_COLUMNS - PANEL_WIDTH;

// The two diff layouts, named so a reader can ask for one. Nothing has to: a pane
// opens in whichever one the terminal has room for, and only a key sets these.
const LAYOUT_SPLIT = "split";
const LAYOUT_STACKED = "stacked";

// Columns a chosen split needs before it can be drawn at all: two columns each
// holding a line number, its lead, and enough text to be worth reading, plus the
// separator between them and the gutter in front. Well below the width the layout
// picks two columns on its own — that one is where comparing is comfortable, this
// one is where it is possible.
const SPLIT_MIN_DIFF_WIDTH =
  GUTTER_WIDTH + SEPARATOR_WIDTH + 2 * (LINE_NUMBER_WIDTH + SIDE_LEAD_WIDTH + MIN_TEXT_WIDTH);

/**
 * Whether the diff is drawn in two columns.
 *
 * The width decides until the reader decides instead. A chosen stack always fits;
 * a chosen split is honoured wherever two columns can be drawn, and refused rather
 * than drawn over itself where they cannot.
 *
 * @param {number} diffWidth Columns the diff area has
 * @param {string} [layout] LAYOUT_SPLIT or LAYOUT_STACKED; omit to let the width decide
 * @returns {boolean}
 */
function splitsIntoColumns(diffWidth, layout) {
  if (layout === LAYOUT_STACKED) {
    return false;
  }
  if (layout === LAYOUT_SPLIT) {
    return diffWidth >= SPLIT_MIN_DIFF_WIDTH;
  }
  return diffWidth >= SIDE_BY_SIDE_MIN_DIFF_WIDTH;
}

/**
 * Decide the screen layout for a given terminal width.
 * @param {number} columns Terminal column count
 * @param {string} [layout] The diff layout the reader chose, if they chose one
 * @returns {{showPanel: boolean, panelWidth: number, diffWidth: number, sideBySide: boolean}}
 */
function resolveLayout(columns, layout) {
  const showPanel = columns >= PANEL_MIN_COLUMNS;
  const panelWidth = showPanel ? PANEL_WIDTH : 0;
  const diffWidth = Math.max(MIN_DIFF_WIDTH, columns - panelWidth);

  return {
    showPanel,
    panelWidth,
    diffWidth,
    sideBySide: splitsIntoColumns(diffWidth, layout),
  };
}

/**
 * Columns a file's own lines get in the reading view.
 *
 * The reader is given the whole width — there is no second column to compare
 * against — so this is everything the chrome does not take. Rows are wrapped to it
 * and drawn at it, which only holds while both sides ask the same question.
 *
 * @param {number} columns Terminal column count
 * @returns {number} Display columns available to the text of one line
 */
function readTextWidth(columns) {
  const chrome = GUTTER_WIDTH + LINE_NUMBER_WIDTH + UNIFIED_LEAD_WIDTH;
  return Math.max(MIN_TEXT_WIDTH, columns - chrome);
}

/** Split a diff area into its two columns, with a separator between them. */
function splitColumns(width) {
  const left = Math.floor((width - SEPARATOR_WIDTH) / 2);
  return { left, right: width - left - SEPARATOR_WIDTH };
}

/**
 * Text columns a diff row's content gets.
 *
 * The same arithmetic the renderer draws with, asked before the rows are built, so a
 * line can be wrapped to the width it will be shown at. Two numbers for the
 * two-column layout because the odd column goes to one side.
 *
 * @param {number} diffWidth Columns the diff area has — the terminal less the panel,
 *   or the whole terminal in the reading view, which has no panel
 * @param {boolean} sideBySide Whether the diff is drawn in two columns
 * @returns {{unified: number}|{left: number, right: number}}
 */
function diffTextWidths(diffWidth, sideBySide) {
  const body = Math.max(1, diffWidth - GUTTER_WIDTH);

  if (!sideBySide) {
    return {
      unified: Math.max(MIN_TEXT_WIDTH, body - LINE_NUMBER_WIDTH - UNIFIED_LEAD_WIDTH),
    };
  }

  const columns = splitColumns(body);
  const textOf = (width) =>
    Math.max(MIN_TEXT_WIDTH, width - LINE_NUMBER_WIDTH - SIDE_LEAD_WIDTH);

  return { left: textOf(columns.left), right: textOf(columns.right) };
}

// The browse view follows yazi's proportions: parent, current, preview.
const BROWSE_RATIO = [1, 4, 3];
const BROWSE_MIN_COLUMNS = 120;
const BROWSE_TWO_COLUMN_MIN = 70;
const BROWSE_SEPARATORS = 2;

/**
 * Column widths for the file browser.
 * A narrow terminal drops the parent column first, then the preview, so the
 * directory being read always keeps the room it needs.
 * @returns {{parentWidth: number, currentWidth: number, previewWidth: number}}
 */
function resolveBrowseLayout(columns) {
  if (columns < BROWSE_TWO_COLUMN_MIN) {
    return { parentWidth: 0, currentWidth: columns, previewWidth: 0 };
  }

  if (columns < BROWSE_MIN_COLUMNS) {
    const currentWidth = Math.floor((columns - 1) / 2);
    return {
      parentWidth: 0,
      currentWidth,
      previewWidth: columns - currentWidth - 1,
    };
  }

  const usable = columns - BROWSE_SEPARATORS;
  const total = BROWSE_RATIO[0] + BROWSE_RATIO[1] + BROWSE_RATIO[2];
  const parentWidth = Math.floor((usable * BROWSE_RATIO[0]) / total);
  const currentWidth = Math.floor((usable * BROWSE_RATIO[1]) / total);

  return {
    parentWidth,
    currentWidth,
    previewWidth: usable - parentWidth - currentWidth,
  };
}

module.exports = {
  BROWSE_TWO_COLUMN_MIN,
  GUTTER_WIDTH,
  LAYOUT_SPLIT,
  LAYOUT_STACKED,
  LINE_NUMBER_WIDTH,
  FALLBACK_COLUMNS,
  MIN_TEXT_WIDTH,
  SEPARATOR_WIDTH,
  SIDE_LEAD_WIDTH,
  UNIFIED_LEAD_WIDTH,
  PANEL_WIDTH,
  SPLIT_MIN_DIFF_WIDTH,
  diffTextWidths,
  readTextWidth,
  resolveBrowseLayout,
  resolveLayout,
  splitColumns,
};
