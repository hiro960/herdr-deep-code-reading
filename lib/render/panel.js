"use strict";

// The file panel down the left of the diff: one row per changed file, its git status,
// and how much of it changed.

const { paint, theme } = require("../ansi");
const { abbreviatePath } = require("../path-display");
const { fitToWidth, padToWidth } = require("../text");
const { COMMENT_MARK, cell } = require("./cells");

// A file the reader has been through. It takes the place of the line counts, which
// are a measure of how much there is left to read.
const VIEWED_MARK = "\u2713";

const STATS_WIDTH = 10;
const PANEL_MARKER_WIDTH = 2;
const STATUS_WIDTH = 2;
// Width a panel row spends on anything but the name and the stats:
// marker(1) + space(1) + status(2) + space(1) + space before the stats(1)
const PANEL_FIXED_WIDTH = 6;

const STATUS_COLORS = {
  A: theme.statusAddedFg,
  D: theme.statusDeletedFg,
  R: theme.statusRenamedFg,
  M: theme.statusModifiedFg,
};

const UNTRACKED_STATUS = "??";

/**
 * Colour the two-letter git status: the index column reads as staged, the worktree
 * column as not yet staged, so they get different colours.
 */
function renderStatus(status) {
  const text = fitToWidth(status, STATUS_WIDTH);

  if (text === UNTRACKED_STATUS) {
    return paint(text, { fg: theme.noteFg, bold: true });
  }

  const indexChar = text[0];
  const worktreeChar = text[1];
  return (
    paint(indexChar, { fg: theme.statusAddedFg, bold: true }) +
    paint(worktreeChar, { fg: STATUS_COLORS[worktreeChar] || theme.statusModifiedFg, bold: true })
  );
}

/**
 * What the right of a row says about the file.
 *
 * Comments first: a file with a note on it is unfinished business whether or not it
 * has been read through. Then the mark, which stands in for the counts — how much
 * there is to read is not a question about a file already read.
 */
function statsFor(entry) {
  if (entry.comments > 0) {
    return `${COMMENT_MARK}${entry.comments}`;
  }
  if (entry.viewed === true) {
    return VIEWED_MARK;
  }
  return `+${entry.added} -${entry.deleted}`;
}

/** Render one row of the file panel. */
function renderPanelRow(entry, width, isSelected, isFocused) {
  const stats = statsFor(entry);
  // Layout: marker(1) + space(1) + status(2) + space(1) + name + space(1) + stats
  const nameWidth = Math.max(0, width - STATS_WIDTH - PANEL_FIXED_WIDTH);
  const marker = isSelected && isFocused ? "▸" : " ";
  const status = fitToWidth(entry.status, STATUS_WIDTH);
  // Drop directories rather than the file name, which is what identifies the row
  const name = padToWidth(abbreviatePath(entry.label, nameWidth), nameWidth);
  const trailing = fitToWidth(stats, STATS_WIDTH);

  if (isSelected) {
    const style = { bg: theme.panelSelectedBg, fg: theme.panelSelectedFg };
    return cell(`${marker} ${status} ${name} ${trailing}`, width, style);
  }

  // A file already read recedes: it is still there to go back to, and it is no longer
  // one of the things asking to be looked at
  const style = entry.viewed === true ? { fg: theme.panelFg, dim: true } : { fg: theme.panelFg };
  const head = paint(`${marker} `, style) + renderStatus(status);
  const tail = cell(` ${name} ${trailing}`, width - PANEL_MARKER_WIDTH - STATUS_WIDTH, style);
  return head + tail;
}

module.exports = { VIEWED_MARK, renderPanelRow, renderStatus };
