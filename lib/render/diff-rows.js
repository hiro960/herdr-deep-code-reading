"use strict";

// One row of the body, whatever the body is showing.
//
// A diff row in either layout, a line of a file being read, a search hit, a note: all
// four scroll through the same list, so all four are drawn through one dispatch. That
// is what lets the browser's preview column reuse the body's drawing rather than keep
// a second, narrower copy of it.

const { paint, theme } = require("../ansi");
const { SIDE_OLD, SIGNS, anchorFromRow } = require("../comments");
const {
  LINE_NUMBER_WIDTH,
  SIDE_LEAD_WIDTH,
  UNIFIED_LEAD_WIDTH,
  splitColumns,
} = require("../layout");
const { displayWidth, fitToWidth, padToWidth, truncateToWidth } = require("../text");
const { BLAME_WIDTH } = require("../blame");
const {
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
} = require("./cells");

// The space a search hit spends on its leading indent, which the location sits after
const HIT_LOCATION_MARGIN = 1;

// Highlight styles, applied only where no diff background competes with them. The
// colours have their own names in the palette rather than borrowing the panel's: a
// theme has an opinion about what a string looks like that has nothing to do with
// what an added file looks like.
//
// A markdown heading is the one token that is more than a colour. It is a document's
// own table of contents, and a page of prose scrolled past at speed is where that
// matters most — so it takes the keyword's colour and the weight as well.
const TOKEN_STYLES = {
  comment: { fg: theme.tokenComment },
  string: { fg: theme.tokenString },
  number: { fg: theme.tokenNumber },
  keyword: { fg: theme.tokenKeyword },
  heading: { fg: theme.tokenKeyword, bold: true },
};

/**
 * Render one side of a diff row. A null cell is painted as filler.
 * @param {boolean} [isCursor] Whether this row is the one under the cursor
 */
function renderSide(cellData, width, word, isCursor) {
  if (width <= 0) {
    return "";
  }
  if (cellData === null || cellData === undefined) {
    // The filler says "nothing here on this side". On the cursor's row the band says
    // something the reader is looking for right now, so it takes the column.
    const banded = cursorBackground(isCursor);
    return paint(" ".repeat(width), { bg: banded === undefined ? theme.fillerBg : banded });
  }

  const background = cursorBackground(isCursor, cellData.type);
  const number = paint(formatLineNumber(cellData), over({ fg: theme.lineNumberFg }, background));
  const bodyWidth = Math.max(0, width - LINE_NUMBER_WIDTH);
  const style = styleForLineType(cellData.type, isCursor);
  const body = paintRuns(
    " " + prepareContent(cellData.text),
    bodyWidth,
    style,
    lineRuns(cellData.type, cellData.spans, word, style),
    SIDE_LEAD_WIDTH
  );

  return number + body;
}

/**
 * Render a row in the two-column layout.
 * The word cursor follows the new side, which is the one a reader is reading; it
 * falls back to the old side only on a row that has nothing new on it.
 */
function renderPair(row, width, word, isCursor) {
  const { left, right } = splitColumns(width);
  const onRight = row.right !== null && row.right !== undefined;

  return (
    renderSide(row.left, left, onRight ? null : word, isCursor) +
    // The two sides may be a delete and an add, and so two different colours. The rule
    // between them is neither, and takes the plain band rather than picking a side.
    separator(cursorBackground(isCursor)) +
    renderSide(row.right, right, onRight ? word : null, isCursor)
  );
}

/**
 * Paint a line from its syntax tokens, truncating to the available width.
 * Used for file contents, where no diff background colour is in the way.
 */
function renderTokens(tokens, width, background) {
  let painted = "";
  let used = 0;

  for (const token of tokens) {
    if (used >= width) {
      break;
    }
    const text = truncateToWidth(prepareContent(token.text), width - used);
    if (text === "") {
      continue;
    }
    // A token with no style of its own is still part of the row, so it takes the band
    // even though it takes no colour. Without a background, paint() gives the text
    // straight back and this is what it always was.
    painted += paint(text, over(TOKEN_STYLES[token.type] || {}, background));
    used += displayWidth(text);
  }

  return painted + span(" ".repeat(Math.max(0, width - used)), background);
}

/**
 * The blame column, or nothing when the reader has not asked for one.
 *
 * A cell carries `blame` only while the layer is on, so its presence is the switch
 * and its width is fixed — the rows were wrapped to a width that already had this
 * column taken out of it, and a column that changed size would cost every line below
 * it the character the wrap had counted on.
 */
function renderBlame(cellData, background) {
  if (cellData.blame === undefined) {
    return "";
  }
  return paint(
    padToWidth(truncateToWidth(cellData.blame, BLAME_WIDTH), BLAME_WIDTH),
    over({ fg: theme.lineNumberFg, dim: true }, background)
  );
}

/** Columns the blame layer takes from a row, zero when it is off. */
function blameWidthOf(cellData) {
  return cellData.blame === undefined ? 0 : BLAME_WIDTH;
}

/** Render a row in the unified layout, with its +/- sign. */
function renderUnifiedLine(cellData, width, word, isCursor) {
  // A line of a file a merge could not settle carries which side it is on, and takes
  // that side's colour where a diff line would take its own — see ./cells. A file with
  // no conflict in it has none of these, which is every file but the few being settled.
  const background =
    cellData.conflict === undefined
      ? cursorBackground(isCursor, cellData.type)
      : conflictBackground(cellData, isCursor);
  const number = paint(formatLineNumber(cellData), over({ fg: theme.lineNumberFg }, background));
  // A row continuing a wrapped line leaves the sign column blank beside the blank
  // number: the background already says added or deleted, and repeating the sign
  // would read as several lines rather than one
  const sign = cellData.continues ? " " : SIGNS[cellData.type] || " ";
  const blame = renderBlame(cellData, background);
  const bodyWidth = Math.max(0, width - LINE_NUMBER_WIDTH - blameWidthOf(cellData));

  // Highlighting is painted per token, so a word cursor and a highlighted line
  // cannot both colour the same run. The cursor wins: it is what the reader is
  // pointing at, and it is the one that says what Enter would follow.
  //
  // Either way the text starts in the same column and gets the same room. It used
  // to start one column earlier when it was highlighted, which put a wrapped line
  // one column wider than the wrap had allowed for and cost it its last character.
  // A marker is git talking in the middle of somebody's file rather than a line of it,
  // so it is drawn the way the other place git talks is — a hunk header — and never
  // through the highlighter, which would read `<<<<<<< HEAD` as code and colour it.
  const marker = isConflictMarker(cellData);

  if (cellData.tokens && !marker && (word === null || word === undefined)) {
    return (
      number +
      blame +
      span(" " + sign, background) +
      renderTokens(cellData.tokens, Math.max(0, bodyWidth - UNIFIED_LEAD_WIDTH), background)
    );
  }

  const style = marker
    ? over({ fg: theme.hunkFg, bold: true }, background)
    : over(styleForLineType(cellData.type, isCursor), background);
  const body = paintRuns(
    " " + sign + prepareContent(cellData.text),
    bodyWidth,
    style,
    lineRuns(cellData.type, cellData.spans, word, style),
    UNIFIED_LEAD_WIDTH
  );
  return number + blame + body;
}

/**
 * Render the two-column gutter that carries the cursor and comment marks.
 * A selected row keeps the same two columns: the cursor column shows the run, so a
 * marked span reads as one block rather than as a row of unrelated marks.
 */
function renderGutter(isCursor, hasComment, isSelected, hasNote) {
  // The gutter is a margin rather than part of the line, so it takes the plain band
  // whatever the line beside it is. A row of two colours in three columns would read
  // as a seam, and the mark is doing the work here anyway.
  const background = cursorBackground(isCursor);
  const cursorMark = isCursor
    ? paint(CURSOR_MARK, over({ fg: theme.panelFocusFg, bold: true }, background))
    : isSelected
      ? paint(SELECTION_MARK, { fg: theme.statusRenamedFg, bold: true })
      : " ";
  // One column for both, and the reader's own note wins it. A line carrying both is
  // a line they have already answered, and what they wrote is what they will look for.
  const commentMark = hasComment
    ? paint(COMMENT_MARK, over({ fg: theme.statusRenamedFg }, background))
    : hasNote
      ? paint(NOTE_MARK, over({ fg: theme.hunkFg }, background))
      : span(" ", background);
  return cursorMark + commentMark;
}

/** Render an empty diff row, keeping the column separator in the two-column layout. */
function renderEmptyDiffRow(width, isSideBySide) {
  if (!isSideBySide) {
    return " ".repeat(width);
  }
  const { left, right } = splitColumns(width);
  return " ".repeat(left) + separator() + " ".repeat(right);
}

/**
 * One search hit: where it is, then the line it matched.
 *
 * The location is fitted rather than truncated. Truncating a path whose full-width
 * character straddles the half-way mark gives back one column less than was asked
 * for, and the row would then be a column narrower than the terminal.
 */
function renderHitRow(hit, width, background) {
  // A commit carries its own label: it is not at a line of a file, so `path:line`
  // would be `null:null` down the left of the whole list
  const location = hit.label === undefined ? `${hit.path}:${hit.line}` : hit.label;
  const room = Math.max(0, Math.floor(width / 2) - HIT_LOCATION_MARGIN);
  const locationWidth = Math.min(displayWidth(location), room);
  const bodyWidth = Math.max(0, width - locationWidth - HIT_LOCATION_MARGIN);

  return (
    span(" ", background) +
    paint(fitToWidth(location, locationWidth), over({ fg: theme.hunkFg }, background)) +
    cell("  " + prepareContent(hit.text.trim()), bodyWidth, over({ fg: theme.panelFg }, background))
  );
}

/**
 * Render the body of one diff row, excluding the gutter.
 * @param {{start: number, end: number}|null} [word] The word the column cursor is
 *   on, for the cursor's row only
 * @param {boolean} [isCursor] Whether this row is the one under the cursor, which is
 *   drawn with a band of colour across its whole width — see cells.cursorBackground.
 *   Omitted where there is no cursor to draw, as in the browser's preview column.
 */
function renderDiffBody(row, width, isSideBySide, word, isCursor) {
  // The kinds that are not a line of code have no diff type to lift, so they all take
  // the plain band.
  const background = cursorBackground(isCursor);

  if (row.kind === "hunk") {
    return cell(row.text, width, over({ fg: theme.hunkFg, bold: true }, background));
  }
  if (row.kind === "hit") {
    return renderHitRow(row.hit, width, background);
  }
  if (row.kind === "note") {
    return cell("  " + row.text, width, over({ fg: theme.noteFg, dim: true }, background));
  }
  if (row.kind === "line") {
    return renderUnifiedLine(row.cell, width, word, isCursor);
  }
  return renderPair(row, width, word, isCursor);
}

/** Whether a row carries a comment, based on its anchor. */
function rowHasComment(row, commentKeys) {
  if (commentKeys === undefined || commentKeys.size === 0) {
    return false;
  }
  const anchor = anchorFromRow(row);
  return anchor !== null && commentKeys.has(`${anchor.side}:${anchor.start}`);
}

/**
 * Whether a row carries an agent's note.
 * A note has a line and no side: whatever wrote it was looking at the file rather
 * than at a diff of it, so it answers for the new side, which is the file as it is.
 */
function rowHasNote(row, noteLines) {
  if (noteLines === undefined || noteLines.size === 0) {
    return false;
  }
  const anchor = anchorFromRow(row);
  return anchor !== null && anchor.side !== SIDE_OLD && noteLines.has(anchor.start);
}

module.exports = {
  renderDiffBody,
  renderEmptyDiffRow,
  renderGutter,
  renderHitRow,
  rowHasComment,
  rowHasNote,
};
