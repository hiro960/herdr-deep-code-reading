"use strict";

// The row above the body and the rows below it: what the pane is showing, the text
// field when one is open, and the key list.
//
// The footer's height is the one number the scroll model and the drawn frame both
// have to agree on, so chromeRows lives here with the thing it is measuring.

const { paint, theme } = require("../ansi");
const { helpRowCount, wrapHelp } = require("../help-layout");
const { displayWidth, fitToWidth, padToWidth, sanitize, truncateToWidth } = require("../text");
const { cell } = require("./cells");

const HEADER_ROWS = 1;
// The rows a text field takes: it is always one line, whatever the help beneath it
// would have needed.
const INPUT_ROWS = 1;
// One row for the thing the cursor is inside, when there is one — see lib/sticky
const STICKY_ROWS = 1;
// Not an arrow: what is pinned is above the reader in the file, and pointing at it
// would say it is somewhere to go rather than somewhere they already are.
const STICKY_MARK = "\u2502";

const PICKER_TITLE = "Send comments to";
// Shown where a comment carries a line break, so a paragraph is legible on one row
const LINE_BREAK_MARK = "⏎";
const CARET = "_";

// Every kind of field but the comment, which names the lines it is about instead.
// A kind missing from here falls back to that label and asks about lines a filter or
// a query does not have — see test/render.test.js, which holds this table to the
// kinds lib/view-names defines.
const INPUT_LABELS = {
  commit: " commit message > ",
  create: " new file > ",
  filter: " filter names > ",
  find: " find in file > ",
  open: " open > ",
  search: " search in files > ",
  pickaxe: " history of > ",
  ask: " ask the agent > ",
};

// The search field is the one field with two modes, and which one it is in changes
// what every character of the query means. So the label says it rather than leaving
// the reader to remember whether they pressed Ctrl+R.
const SEARCH_REGEX_LABEL = " search in files (regex) > ";
const PICKAXE_REGEX_LABEL = " history of (regex) > ";

/** The label a field is drawn behind, including anything about its current mode. */
function inputLabel(input) {
  if (input.kind === "search" && input.regex === true) {
    return SEARCH_REGEX_LABEL;
  }
  if (input.kind === "pickaxe" && input.regex === true) {
    return PICKAXE_REGEX_LABEL;
  }
  return INPUT_LABELS[input.kind] || commentInputLabel(input);
}

function renderHeader(model, columns) {
  const left = ` ${model.title}`;
  const right = `${model.subtitle} `;
  const gap = Math.max(1, columns - displayWidth(left) - displayWidth(right));
  return cell(left + " ".repeat(gap) + right, columns, {
    bg: theme.headerBg,
    fg: theme.headerFg,
    bold: true,
  });
}

/** Where a comment being written is anchored, shown beside what is typed. */
function commentInputLabel(input) {
  const range = input.start === input.end ? input.start : `${input.start}-${input.end}`;
  return ` comment ${input.file}:${range} > `;
}

/**
 * The tail of what has been typed, so the caret stays on screen.
 *
 * The field is one row of a footer, and a comment can now run to a paragraph. Line
 * breaks are shown rather than obeyed — a footer has one row to give — and what
 * scrolls out is the beginning, because the end is where the reader is.
 */
function renderTypedText(text, width) {
  const flat = text.split("\n").join(LINE_BREAK_MARK) + CARET;
  if (displayWidth(flat) <= width) {
    return padToWidth(flat, width);
  }

  // Reverse, clip to the width, reverse back: the same trick the path elider uses
  const tail = [...truncateToWidth([...flat].reverse().join(""), width)].reverse().join("");
  return padToWidth(tail, width);
}

/**
 * The footer's rows before they are painted.
 *
 * The height comes from the key list alone, never from the message. A footer that
 * grew a row when something happened would reflow the whole body under the reader
 * and snap back on the next keystroke — including while a quit prompt is asking
 * them to read it. So a message takes the first row and the keys keep the rest.
 *
 * The keys keep the rest by being wrapped again into it, rather than by losing the
 * row the message took. Dropping that row dropped whatever was on it — which is the
 * front of the list, where the keys a view is actually about are: `o`, `t` and
 * `space` in the conflict list, the movement keys everywhere else. Re-wrapped, they
 * flow up into the rows that are left, and what no longer fits ends in `… ? keys` the
 * way it does at any other width. The footer's promise is that a key it does not name
 * might as well not exist, and a message is not a reason to stop keeping it.
 */
function footerLines(model, columns) {
  const width = Math.max(1, columns - 1);
  const help = model.help || "";
  const rows = wrapHelp(help, width);

  if (!model.message) {
    return rows;
  }

  // A message is the one thing on screen that is neither a key list nor a line of a
  // file: it is assembled from a commit subject, a path, or git's own error text, and
  // any of those can carry a character that would move the cursor rather than be
  // drawn. Stripping them is what keeps a row exactly as wide as it was measured to
  // be — the invariant every other part of the frame is built on.
  const said = sanitize(model.message);

  // A key list that was one row has no second row to be re-wrapped into. On a terminal
  // wide enough for that, the message is the whole footer for the few seconds it is up
  // — which is what the timeout in bin/review.js is for.
  if (rows.length <= 1) {
    return [said];
  }

  return [said, ...wrapHelp(help, width, rows.length - 1)];
}

/**
 * The footer's rows.
 *
 * A text field is one row. Otherwise the full key list wraps to as many rows as it
 * needs, because a key nobody is shown is a key nobody presses.
 *
 * @returns {Array<string>} One entry per screen row, each exactly `columns` wide
 */
function renderFooter(model, columns) {
  if (model.input !== null && model.input !== undefined) {
    const label = inputLabel(model.input);
    const fitted = fitToWidth(label, Math.min(displayWidth(label), columns));
    const typed = renderTypedText(model.input.text, Math.max(0, columns - displayWidth(fitted)));
    return [paint(fitted + typed, { bg: theme.headerBg, fg: theme.headerFg })];
  }

  return footerLines(model, columns).map((line) =>
    cell(" " + line, columns, { fg: theme.footerFg, dim: true })
  );
}

/**
 * The rows a frame spends on chrome at a given width.
 *
 * Two things decide it and nothing else: whether a text field is open, and how many
 * rows the key list wraps to. The scroll model and the drawn frame must agree on the
 * answer, so it has one home and bin/review.js calls it too — with those two fields
 * rather than a whole frame's worth of model, which is all this ever reads.
 *
 * @param {{help: string, input: object|null}} model
 */
function chromeRows(model, columns) {
  // The pinned line is chrome: it takes a row from the body the way a message does,
  // and the scroll model has to size itself from the same count the frame draws with.
  const sticky = model && model.sticky ? STICKY_ROWS : 0;

  if (model && model.input !== null && model.input !== undefined) {
    return HEADER_ROWS + sticky + INPUT_ROWS;
  }
  const help = model ? model.help || "" : "";
  return HEADER_ROWS + sticky + helpRowCount(help, Math.max(1, columns - 1));
}

/**
 * The thing the cursor is inside, held above the body while the inside of it scrolls.
 *
 * Drawn as chrome rather than as content: it takes a row from the body, which is what
 * the row it is standing in for would have cost anyway, and it is painted on the
 * filler's ground so that it reads as held rather than as the next line of the file.
 */
function renderSticky(text, columns) {
  return cell(` ${STICKY_MARK} ${text}`, columns, { bg: theme.fillerBg, fg: theme.hunkFg });
}

/**
 * Rows of a peeked definition, shown in place of the diff while it is open.
 * A heading saying where it came from, then the lines themselves — which are already
 * rows, so they are handed on as they are and drawn by the machinery every row uses.
 */
function peekRows(peek) {
  return [{ kind: "note", text: peek.title }, ...peek.rows];
}

/** Rows of the agent picker, shown in place of the diff while it is open. */
function pickerRows(picker) {
  const rows = [{ kind: "note", text: `${PICKER_TITLE} (${picker.count})` }];
  picker.agents.forEach((agent, index) => {
    rows.push({ kind: "note", text: `${index + 1}  ${agent.label}` });
  });
  return rows;
}

module.exports = {
  renderSticky,
  chromeRows,
  footerLines,
  peekRows,
  pickerRows,
  renderFooter,
  renderHeader,
};
