"use strict";

// Turns a parsed diff into the flat list of rows the screen scrolls through.
// Pure functions only: no ANSI, no terminal size.

const { buildSideBySideRows } = require("./side-by-side");
const { buildUnifiedRows } = require("./unified");
const { anchorFromRow } = require("./comments");
const { prepareLine } = require("./text");
const { sliceSpans, wrapSegments } = require("./wrap");

const STATUS_ADDED = "A";
const STATUS_DELETED = "D";
const STATUS_RENAMED = "R";
const STATUS_MODIFIED = "M";

const NOTE_BINARY = "Binary file — no diff shown";
const NOTE_EMPTY = "No changes";

/** Status letter for a file. */
function fileStatus(file) {
  if (file.isNew) {
    return STATUS_ADDED;
  }
  if (file.isDeleted) {
    return STATUS_DELETED;
  }
  if (file.isRenamed) {
    return STATUS_RENAMED;
  }
  return STATUS_MODIFIED;
}

/** Label shown in the file panel. */
function fileLabel(file) {
  if (file.isRenamed && file.oldPath && file.newPath) {
    return `${file.oldPath} → ${file.newPath}`;
  }
  return file.newPath || file.oldPath || "(unknown path)";
}

/** Count added and deleted lines in a file. */
function countChanges(file) {
  let added = 0;
  let deleted = 0;

  for (const hunk of file.hunks) {
    for (const line of hunk.lines) {
      if (line.type === "add") {
        added += 1;
      } else if (line.type === "del") {
        deleted += 1;
      }
    }
  }

  return { added, deleted };
}

/**
 * The cell of a row the column cursor can reach, or null when a row carries none.
 *
 * A two-column row shows a deleted line beside the line that replaced it, and only
 * one of the two can have the cursor on it: the new side is the one a reader is
 * following, and the old side answers only when there is nothing new on that row.
 * Everything that asks a row for "the line the reader is on" — the cursor, the word
 * it is highlighting, a search for text — has to give the same answer, so they all
 * ask here.
 */
function cellOfRow(row) {
  if (row === undefined || row === null) {
    return null;
  }
  if (row.kind === "line") {
    return row.cell || null;
  }
  if (row.kind === "pair") {
    return row.right || row.left || null;
  }
  return null;
}

/** Text of a hunk header row. */
function hunkHeaderText(hunk) {
  const range = `@@ -${hunk.oldStart},${hunk.oldCount} +${hunk.newStart},${hunk.newCount} @@`;
  return hunk.header ? `${range} ${hunk.header}` : range;
}

/**
 * The pieces one diff line is shown in, at a width.
 *
 * The text is prepared first — tabs expanded — so a column means the same thing here
 * as it does to the renderer, and `full` keeps the line as the file has it so a
 * comment still quotes the file rather than the screen.
 *
 * @returns {Array<object>} Cells, one per row, the first alone carrying the number
 */
function cellPieces(cell, width) {
  if (cell === null || cell === undefined) {
    return [null];
  }

  const prepared = prepareLine(cell.text);

  return wrapSegments(prepared, width).map((segment, index) => ({
    ...cell,
    text: prepared.slice(segment.from, segment.to),
    // The spans are offsets into the whole prepared line, so each row keeps only the
    // part of them it actually shows — see lib/wrap.sliceSpans
    spans: sliceSpans(cell.spans, segment.from, segment.to),
    full: cell.text,
    continues: index > 0,
  }));
}

/**
 * Wrap a unified row into the rows it needs.
 * Every one of them answers with the anchor of the line it belongs to, so a comment
 * written on the third row of a wrapped line is a comment on that line.
 */
function wrappedLineRows(line, width) {
  const anchor = anchorFromRow({ kind: "line", cell: line });

  return cellPieces(line, width).map((cell) => ({ kind: "line", anchor, cell }));
}

/**
 * Wrap a two-column row into the rows it needs.
 *
 * Each side is wrapped to its own column, then the two runs are set beside each
 * other. They rarely come out the same length — a line and the line that replaced it
 * are different lengths — so whichever runs out first leaves the filler an absent
 * side already shows.
 */
function wrappedPairRows(pair, widths) {
  const anchor = anchorFromRow({ kind: "pair", left: pair.left, right: pair.right });
  const left = cellPieces(pair.left, widths.left);
  const right = cellPieces(pair.right, widths.right);
  const rows = [];

  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    rows.push({
      kind: "pair",
      anchor,
      left: index < left.length ? left[index] : null,
      right: index < right.length ? right[index] : null,
    });
  }

  return rows;
}

/**
 * Convert a hunk body into display rows. The layout decides how rows are built.
 * @param {object} [widths] Text columns a row's content gets; omit to leave long
 *   lines uncut, which is what a preview column wants
 */
function hunkBodyRows(hunk, isSideBySide, widths) {
  if (isSideBySide) {
    const room = widths || { left: Infinity, right: Infinity };
    return buildSideBySideRows(hunk).flatMap((pair) => wrappedPairRows(pair, room));
  }

  // The unified layout never pairs lines: pairing would drop the deleted line
  const room = widths && widths.unified !== undefined ? widths.unified : Infinity;
  return buildUnifiedRows(hunk).flatMap((line) => wrappedLineRows(line, room));
}

/**
 * Build the scrollable row list for one file.
 * One element maps to exactly one screen row, so the layout matters here.
 * @param {object} file A file produced by parseUnifiedDiff
 * @param {boolean} [isSideBySide] True for the two-column layout (default)
 * @param {object} [widths] Text columns a row's content gets; omit to leave long
 *   lines uncut
 * @returns {Array<{kind: "hunk"|"pair"|"line"|"note"}>}
 */
function buildFileRows(file, isSideBySide, widths) {
  if (file.isBinary) {
    return [{ kind: "note", text: NOTE_BINARY }];
  }
  // A file that could not be read says why. Without this it would fall through to
  // "No changes", which is the one thing a file the reviewer just wrote is not.
  if (file.note) {
    return [{ kind: "note", text: file.note }];
  }

  const sideBySide = isSideBySide === undefined ? true : isSideBySide;
  const rows = [];

  for (const hunk of file.hunks) {
    rows.push({ kind: "hunk", text: hunkHeaderText(hunk) });
    rows.push(...hunkBodyRows(hunk, sideBySide, widths));
  }

  if (rows.length === 0) {
    return [{ kind: "note", text: NOTE_EMPTY }];
  }

  return rows;
}

module.exports = {
  buildFileRows,
  cellOfRow,
  countChanges,
  fileLabel,
  fileStatus,
};
