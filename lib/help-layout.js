"use strict";

// Fitting the key list into the rows a footer is allowed.
//
// The footer is the only place a key is ever advertised, so it carries all of them
// rather than the few that fit on one row: a reader who does not know a key exists
// will not go looking for it. It wraps instead of truncating, and the frame gives it
// however many rows that takes.

// Two spaces separate one key from the next, which is what makes an item findable
const ITEM_SEPARATOR = "  ";
// Widths here count characters rather than terminal cells. Every footer is written
// in ASCII, where the two are the same; a footer in prose that is not would need
// lib/text's measurement instead.
// A ceiling, not a target: past this the footer is eating the file it describes.
const MAX_HELP_ROWS = 4;
const MIN_HELP_ROWS = 1;
// What the last row says when the list did not fit in the ceiling. The footer's whole
// promise is that a key it does not name might as well not exist, so a list quietly
// clipped at the bottom of the screen is the one failure it cannot have — this is the
// key that shows the rest.
const OVERFLOW = "\u2026 ? keys";

/** Split a footer into its items. */
function itemsOf(help) {
  return help.split(ITEM_SEPARATOR).filter((item) => item !== "");
}

/**
 * Wrap a footer to a width, breaking only between items.
 *
 * An item longer than the width goes on a row of its own and is left to the renderer
 * to clip: breaking inside "Tab contents/diff" would make it unreadable, and no
 * terminal narrow enough for that is wide enough to review a diff in.
 *
 * @param {string} help The footer text, items separated by two spaces
 * @param {number} columns Terminal width
 * @param {number} [maxRows] Ceiling on the rows used; defaults to MAX_HELP_ROWS
 * @returns {Array<string>} At least one row, at most maxRows
 */
function wrapHelp(help, columns, maxRows) {
  const limit = maxRows === undefined ? MAX_HELP_ROWS : Math.max(MIN_HELP_ROWS, maxRows);
  const width = Math.max(1, columns);
  const rows = [];
  let current = "";

  for (const item of itemsOf(help)) {
    const candidate = current === "" ? item : current + ITEM_SEPARATOR + item;

    if (candidate.length <= width || current === "") {
      current = candidate;
      continue;
    }
    if (rows.length + 1 >= limit) {
      // No more rows to give. Rather than letting the renderer clip the rest away in
      // silence, the row ends by naming the key that shows all of them.
      rows.push(overflowed(current, width));
      return rows;
    }
    rows.push(current);
    current = item;
  }

  rows.push(current);
  return rows;
}

/**
 * A last row that says there is more, in the room it has.
 *
 * Whole items are dropped to make that room rather than characters: half of `K peek`
 * is `K pee`, which reads as a key nobody has and is worse than the key not being
 * there at all. What is dropped here is already past the ceiling and named by the
 * marker, so losing one more of them costs nothing a reader can use.
 */
function overflowed(row, width) {
  const room = width - OVERFLOW.length - ITEM_SEPARATOR.length;
  if (room < 1) {
    return OVERFLOW;
  }

  let kept = "";
  for (const item of row.split(ITEM_SEPARATOR)) {
    const candidate = kept === "" ? item : kept + ITEM_SEPARATOR + item;
    if (candidate.length > room) {
      break;
    }
    kept = candidate;
  }

  return kept === "" ? OVERFLOW : `${kept}${ITEM_SEPARATOR}${OVERFLOW}`;
}

/**
 * How many rows a footer needs at a width.
 * The frame and the scroll model both size the body from this, so it has one home.
 */
function helpRowCount(help, columns, maxRows) {
  return wrapHelp(help, columns, maxRows).length;
}

module.exports = { MAX_HELP_ROWS, OVERFLOW, helpRowCount, wrapHelp };
