"use strict";

// The two sides git left in a file it could not merge.
//
// A conflicted file is not a broken file: it is both versions, one after the other,
// between markers. `<<<<<<<` opens the side already here, `=======` divides it from the
// side that arrived, and `>>>>>>>` closes. With `merge.conflictStyle` set to diff3 there
// is a third part between them — what both sides started from — which is often the piece
// that says which of the other two is right.
//
// This reads that back, so the pane can draw the file as what it is rather than as text
// with punctuation in it: which side each line belongs to, and where each conflict
// begins. Nothing here writes. Choosing a side is git's job — see ./git-merge — and
// choosing part of one is the editor's, which is the reader's own.
//
// The markers are only markers inside an open conflict. `=======` under a line of
// markdown is a heading, and a file of prose is exactly the kind of thing two people
// edit at once, so a reader working through a real conflict must not be shown a false
// one three screens further down.

// git writes seven of each by default, and `merge.conflictMarkerSize` makes them
// longer. Seven or more, followed by the end of the line or the label git puts there.
const START = /^<{7,}(\s|$)/;
const BASE = /^\|{7,}(\s|$)/;
const MIDDLE = /^={7,}(\s|$)/;
const END = /^>{7,}(\s|$)/;

// What a line is. The three markers are named apart from the text between them: they
// are git's own words rather than anybody's code, and they are drawn as such.
const CONFLICT_START = "start";
const CONFLICT_OURS = "ours";
const CONFLICT_BASE_START = "base-start";
const CONFLICT_BASE = "base";
const CONFLICT_MIDDLE = "middle";
const CONFLICT_THEIRS = "theirs";
const CONFLICT_END = "end";

/**
 * Which side each line of a file belongs to.
 *
 * A line outside every conflict answers null, which is most of any real file.
 *
 * @param {Array<string>} lines The file, one string per line
 * @returns {Array<string|null>} One entry per line, in the same order
 */
function sideOfLines(lines) {
  const sides = new Array(lines.length).fill(null);
  // Which part of a conflict the reading is inside, or null between them. This is what
  // makes a marker a marker: outside a conflict, `=======` is a line of the file.
  let inside = null;

  for (let at = 0; at < lines.length; at += 1) {
    const line = lines[at];

    if (inside === null) {
      if (START.test(line)) {
        sides[at] = CONFLICT_START;
        inside = CONFLICT_OURS;
      }
      continue;
    }

    if (inside === CONFLICT_OURS && BASE.test(line)) {
      sides[at] = CONFLICT_BASE_START;
      inside = CONFLICT_BASE;
      continue;
    }
    if ((inside === CONFLICT_OURS || inside === CONFLICT_BASE) && MIDDLE.test(line)) {
      sides[at] = CONFLICT_MIDDLE;
      inside = CONFLICT_THEIRS;
      continue;
    }
    if (inside === CONFLICT_THEIRS && END.test(line)) {
      sides[at] = CONFLICT_END;
      inside = null;
      continue;
    }

    // Anything else between the markers is one side's own text. A conflict left
    // unclosed at the end of the file keeps its side to the last line, because that
    // is what the file says.
    sides[at] = inside;
  }

  return sides;
}

/**
 * Whether a file still holds a conflict git left in it.
 *
 * Asked of the opening marker alone. A stray `=======` is a line of markdown often
 * enough to be worth nothing as evidence, and the opening marker is the one no
 * ordinary file carries by accident.
 */
function hasConflictMarkers(lines) {
  return lines.some((line) => START.test(line));
}

/** How many conflicts a file holds, which is how many the reader has left to settle. */
function countConflicts(lines) {
  return lines.filter((line) => START.test(line)).length;
}

/**
 * The line the first conflict opens on, so that opening a file lands on it.
 * A file whose conflict was settled by taking a side has none left, and the top of it
 * is where a file opens anyway.
 * @returns {number} A line number, or 1 when there is no conflict in it
 */
function firstConflictLine(lines) {
  const at = lines.findIndex((line) => START.test(line));
  return at === -1 ? 1 : at + 1;
}

/**
 * Mark each display row with the side its line belongs to.
 *
 * The rows are already built and already wrapped, so this only says what each of them
 * is; a wrapped line's every row carries the same side, because they are the same line.
 * A row belonging to no conflict is returned untouched — the file is mostly those, and
 * copying every one of them to add nothing would be a new array for no reason.
 *
 * @param {Array<object>} rows Rows from lib/file-view's buildContentRows
 * @param {Array<string|null>} sides From sideOfLines, indexed by line number - 1
 */
function withConflictSides(rows, sides) {
  return rows.map((row) => {
    if (row.kind !== "line" || row.cell === undefined) {
      return row;
    }
    const side = sides[row.cell.num - 1];
    return side === null || side === undefined
      ? row
      : { ...row, cell: { ...row.cell, conflict: side } };
  });
}

/**
 * The row each conflict starts on, for the keys that step between them.
 * A file of four conflicts is four places to go, and scrolling to find the next one is
 * what those keys are for.
 */
function conflictRows(rows) {
  const found = [];
  for (const [at, row] of rows.entries()) {
    if (row.kind === "line" && row.cell !== undefined && row.cell.conflict === CONFLICT_START) {
      found.push(at);
    }
  }
  return found;
}

module.exports = {
  CONFLICT_BASE,
  CONFLICT_BASE_START,
  CONFLICT_END,
  CONFLICT_MIDDLE,
  CONFLICT_OURS,
  CONFLICT_START,
  CONFLICT_THEIRS,
  conflictRows,
  countConflicts,
  firstConflictLine,
  hasConflictMarkers,
  sideOfLines,
  withConflictSides,
};
