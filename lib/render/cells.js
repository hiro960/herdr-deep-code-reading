"use strict";

// The pieces every part of a frame is painted from: a cell of an exact width, the
// marks in the gutter, the separator between columns, and the one place a word can be
// highlighted inside text that is already the right size.
//
// Everything above this draws with these, which is what keeps a column meaning the
// same number of terminal cells wherever it is drawn.

const { cursorLine, paint, theme, wordDiff } = require("../ansi");
const { LINE_NUMBER_WIDTH } = require("../layout");
const { fitToWidth, prepareLine } = require("../text");
const {
  CONFLICT_BASE_START,
  CONFLICT_END,
  CONFLICT_MIDDLE,
  CONFLICT_OURS,
  CONFLICT_START,
  CONFLICT_THEIRS,
} = require("../conflict");

const COLUMN_SEPARATOR = "│";
const CURSOR_MARK = "▎";
const SELECTION_MARK = "┃";
const COMMENT_MARK = "●";
// Something an agent wrote, rather than something the reader did
const NOTE_MARK = "◆";

/** Build a cell of exactly the given width: truncate, pad, then style. */
function cell(text, width, style) {
  return paint(fitToWidth(text, width), style || {});
}

/**
 * Prepare diff content for display.
 * Shared with the state layer, so a column means the same thing to both.
 */
function prepareContent(text) {
  return prepareLine(text);
}

/**
 * The colour behind the whole of the row the reader is on, or nothing.
 *
 * A terminal draws every cell at one size, so the row cannot be made taller or wider
 * to say it is the one being read. A band of colour across its full width is what says
 * it instead — and an added or removed line keeps its own hue, lifted rather than
 * overpainted, because the background is what says which of the two it is.
 *
 * This is the one gate on the band: everything that paints part of the cursor's row
 * asks here, so `cursorline = false` in the config turns off all of it at once.
 *
 * @param {boolean} [isCursor] Whether this is the row under the cursor
 * @param {string} [type] The line's diff type, where it has one
 */
function cursorBackground(isCursor, type) {
  if (isCursor !== true || !cursorLine) {
    return undefined;
  }
  if (type === "add") {
    return theme.addCursorBg;
  }
  if (type === "del") {
    return theme.delCursorBg;
  }
  return theme.cursorLineBg;
}

// The two sides of a conflict, and the marker lines git wrote between them. A marker
// is not the file's text — it is git talking, in the middle of somebody's code — so it
// is drawn as the hunk headers are, which is the other place git talks.
const CONFLICT_BACKGROUNDS = {
  [CONFLICT_OURS]: () => theme.conflictOursBg,
  [CONFLICT_THEIRS]: () => theme.conflictTheirsBg,
};

// The lines git wrote itself, which are not the file's text either way
const CONFLICT_MARKERS = new Set([
  CONFLICT_START,
  CONFLICT_BASE_START,
  CONFLICT_MIDDLE,
  CONFLICT_END,
]);

/**
 * The background a line of a conflicted file takes, or nothing.
 *
 * The cursor's band wins where they meet. A conflict block is several lines and its
 * colour is still on the ones above and below, so the row the reader is on is not left
 * unfindable — where an added line, which may be alone, keeps its own hue under the
 * cursor because losing it would lose the only thing saying what the line is.
 *
 * @param {object} cellData A row's cell, which carries `conflict` only inside one
 * @param {boolean} [isCursor] Whether this is the row under the cursor
 */
function conflictBackground(cellData, isCursor) {
  const banded = cursorBackground(isCursor);
  if (banded !== undefined) {
    return banded;
  }

  const side = cellData === null || cellData === undefined ? undefined : cellData.conflict;
  const found = CONFLICT_BACKGROUNDS[side];
  return found === undefined ? undefined : found();
}

/** Whether this line is one of the markers git wrote rather than a line of the file. */
function isConflictMarker(cellData) {
  if (cellData === null || cellData === undefined) {
    return false;
  }
  return CONFLICT_MARKERS.has(cellData.conflict);
}

/**
 * Put a background behind a style that has none.
 *
 * The one place the band is merged into everything else the row is painted with. A
 * style that already names a background keeps it: that background was chosen to say
 * something — an added line, the filler beside a paired row — and the band is not
 * entitled to it.
 */
function over(style, background) {
  if (background === undefined) {
    return style;
  }
  return style.bg === undefined ? { ...style, bg: background } : style;
}

/**
 * A piece of a row with no styling of its own, kept inside the row's background.
 * paint() closes every run with a reset, so a bare string on a banded row is a hole
 * the terminal's own background shows through.
 */
function span(text, background) {
  return background === undefined ? text : paint(text, { bg: background });
}

function separator(background) {
  return paint(COLUMN_SEPARATOR, over({ fg: theme.borderFg }, background));
}

/**
 * The line number column.
 * A row continuing a wrapped line leaves it blank: the number belongs to the line,
 * and repeating it down the run would read as several lines sharing one.
 */
function formatLineNumber(cellData) {
  const num = cellData === null || cellData === undefined ? null : cellData.num;
  const text = num === null || num === undefined || cellData.continues ? "" : String(num);
  return fitToWidth(text, LINE_NUMBER_WIDTH);
}

/**
 * The colour of the words within a changed line that actually changed, or nothing.
 *
 * A third step of the line's own hue rather than a colour of its own: the reader is
 * being told "this part of this removed line", and a fourth colour on the row would
 * make them work out which of the two it belonged to.
 */
function changedWordBackground(type) {
  if (!wordDiff) {
    return undefined;
  }
  if (type === "add") {
    return theme.addWordBg;
  }
  if (type === "del") {
    return theme.delWordBg;
  }
  return undefined;
}

/**
 * The runs to pick out inside one diff line: the words that changed, and the word the
 * column cursor is on. The cursor comes last, so it wins where the two overlap.
 *
 * @param {Array<{start,end}>} [spans] What lib/word-diff found on this line
 * @param {{start,end}|null} [word] Where the column cursor is
 */
function lineRuns(type, spans, word, base) {
  const runs = [];
  const background = changedWordBackground(type);

  if (background !== undefined && spans !== undefined && spans !== null) {
    for (const changed of spans) {
      runs.push({ start: changed.start, end: changed.end, style: { ...base, bg: background } });
    }
  }
  if (word !== null && word !== undefined) {
    runs.push({ start: word.start, end: word.end, style: { ...base, reverse: true } });
  }

  return runs;
}

/** @param {boolean} [isCursor] Whether this line is the one under the cursor */
function styleForLineType(type, isCursor) {
  const banded = cursorBackground(isCursor, type);

  if (type === "add") {
    return { bg: banded === undefined ? theme.addBg : banded, fg: theme.addFg };
  }
  if (type === "del") {
    return { bg: banded === undefined ? theme.delBg : banded, fg: theme.delFg };
  }
  return banded === undefined ? {} : { bg: banded };
}

const LOW_SURROGATE_FIRST = 0xdc00;
const LOW_SURROGATE_LAST = 0xdfff;

/** Whether an index sits between characters rather than inside a surrogate pair. */
function isSplittable(text, index) {
  const code = text.charCodeAt(index);
  return Number.isNaN(code) || code < LOW_SURROGATE_FIRST || code > LOW_SURROGATE_LAST;
}

/**
 * Paint a line with runs picked out inside it.
 *
 * Two things want to mark part of a line: the column cursor, which shows the word
 * Enter would follow, and the word diff, which shows what actually changed. They land
 * on the same line often enough that painting them separately would mean one of them
 * cutting the other's escape sequences in half.
 *
 * The runs have to be cut out of text that is already the right width, or the escapes
 * would be counted as columns and the row would come out short. So the line is fitted
 * first, then the runs are laid over the characters of the fitted text, then it is
 * painted in as many pieces as the runs make — whose widths still add up to the same
 * total, because no character has been added or removed.
 *
 * A run later in the list wins where two overlap, which is how the cursor stays
 * visible on top of a changed word.
 *
 * @param {Array<{start: number, end: number, style: object}>} runs Character offsets
 *   into the line, before `lead`
 * @param {number} lead Columns the caller has already put before the line
 */
function paintRuns(text, width, base, runs, lead) {
  const fitted = fitToWidth(text, width);
  const laid = new Array(fitted.length).fill(base);
  let marked = false;

  for (const run of runs) {
    const from = lead + run.start;
    const to = lead + run.end;

    // Offsets count the same units the run was found in. Cutting between the halves
    // of a surrogate pair would leave a lone surrogate, which is one column wide
    // where the pair was two — so a boundary that lands inside one gives up that run
    // rather than the row's width.
    if (to > fitted.length || to <= from || from < 0) {
      continue;
    }
    if (!isSplittable(fitted, from) || !isSplittable(fitted, to)) {
      continue;
    }

    laid.fill(run.style, from, to);
    marked = true;
  }

  if (!marked) {
    return paint(fitted, base);
  }

  let painted = "";
  let at = 0;

  while (at < fitted.length) {
    let to = at + 1;
    while (to < fitted.length && laid[to] === laid[at]) {
      to += 1;
    }
    painted += paint(fitted.slice(at, to), laid[at]);
    at = to;
  }

  return painted;
}

module.exports = {
  COMMENT_MARK,
  CURSOR_MARK,
  NOTE_MARK,
  SELECTION_MARK,
  cell,
  conflictBackground,
  cursorBackground,
  formatLineNumber,
  isConflictMarker,
  lineRuns,
  over,
  paintRuns,
  prepareContent,
  separator,
  span,
  styleForLineType,
};
