"use strict";

// How the log screen divides the terminal.
//
// Four panes, in two halves. Across the top: the branch list, and the graph beside it.
// Underneath: the file panel and the diff of whatever commit the graph is pointing at —
// the same two the diff view has always drawn, at the same widths, because they are the
// same two panes and the reader has already learned where they are.
//
// The divisions degrade the way ../layout's do: the branch column goes first, then the
// diff underneath, so that whichever pane is left is one worth reading rather than four
// too narrow to be.

const { SEPARATOR_WIDTH, resolveLayout } = require("./layout");

// Columns the branch list takes. Enough for `origin/feature/something` abbreviated,
// and no more: it is a list to recognise a name in, not to read one from.
const BRANCH_WIDTH = 24;
// Below this, the graph alone gets the width. A branch column on a terminal this
// narrow costs the graph the room its subjects need.
const BRANCH_MIN_COLUMNS = 120;

// The horizontal rule between the graph and the diff below it.
const DIVIDER_ROWS = 1;

// Rows each half needs before it is worth drawing at all: enough graph to see a merge
// in, enough diff to see a hunk in.
const LOG_MIN_HEIGHT = 4;
const DIFF_MIN_HEIGHT = 4;

// The share of the body the graph takes when there is room to choose. The smaller
// share deliberately: the graph is how a commit is chosen, and the diff is what is
// then read.
const LOG_SHARE = 0.35;

/**
 * Split the body between the graph and the diff under it.
 *
 * A terminal too short for both gives the whole of it to the graph. Two panes of two
 * rows each is not a compromise between them, it is neither — and the graph is the one
 * that can still be used alone, because Enter opens a commit in the whole pane.
 *
 * @returns {{logHeight: number, diffHeight: number, showDiff: boolean}}
 */
function splitHeight(bodyHeight) {
  const body = Math.max(1, bodyHeight);
  const usable = body - DIVIDER_ROWS;

  if (usable < LOG_MIN_HEIGHT + DIFF_MIN_HEIGHT) {
    return { logHeight: body, diffHeight: 0, showDiff: false };
  }

  const share = Math.floor(usable * LOG_SHARE);
  const logHeight = Math.max(LOG_MIN_HEIGHT, Math.min(share, usable - DIFF_MIN_HEIGHT));

  return { logHeight, diffHeight: usable - logHeight, showDiff: true };
}

/**
 * Decide the log screen's four panes.
 *
 * @param {number} columns Terminal column count
 * @param {number} bodyHeight Rows between the header and the footer
 * @param {string} [diffLayout] The diff layout the reader chose, if they chose one
 * @returns {object} Widths across, heights down, and whether each pane is drawn
 */
function resolveLogLayout(columns, bodyHeight, diffLayout) {
  const showBranches = columns >= BRANCH_MIN_COLUMNS;
  const branchWidth = showBranches ? BRANCH_WIDTH : 0;
  const separator = showBranches ? SEPARATOR_WIDTH : 0;
  // What is left over rather than a width of its own, so the row always adds up to
  // the terminal exactly — an off-by-one here is a frame one column too wide
  const graphWidth = Math.max(1, columns - branchWidth - separator);

  const below = resolveLayout(columns, diffLayout);

  return {
    showBranches,
    branchWidth,
    graphWidth,
    ...splitHeight(bodyHeight),
    showPanel: below.showPanel,
    panelWidth: below.panelWidth,
    diffWidth: below.diffWidth,
    sideBySide: below.sideBySide,
  };
}

module.exports = {
  BRANCH_MIN_COLUMNS,
  BRANCH_WIDTH,
  DIFF_MIN_HEIGHT,
  DIVIDER_ROWS,
  LOG_MIN_HEIGHT,
  resolveLogLayout,
};
