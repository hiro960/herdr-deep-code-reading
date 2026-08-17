"use strict";

// Assembles one frame of the screen into a single string.
// Nothing is written to the terminal here; the caller writes the frame in one go.
//
// The drawing itself is under ./render, one module per part of the screen:
//
//   cells.js      a cell of an exact width, the marks, and the word highlight
//   scroll.js     where a list sits under its window
//   diff-rows.js  one row of the body, in any of the shapes a body row takes
//   panel.js      the file panel down the left of the diff
//   body.js       the panel and the diff side by side, which two screens draw
//   browse.js     the browser's three columns
//   log.js        the log's four panes
//   chrome.js     the header, the text field, and the key list
//
// This file is what puts them side by side and stacks the result into a frame. It is
// also the way in: bin/review.js and the tests call it, and nothing else needs to
// know the parts have their own files.

const { moveTo, screen } = require("./ansi");
const { GUTTER_WIDTH, resolveLayout } = require("./layout");
const { renderBodyLine } = require("./render/body");
const { renderBrowseBody } = require("./render/browse");
const { renderLogBody } = require("./render/log");
const {
  chromeRows,
  peekRows,
  pickerRows,
  renderFooter,
  renderHeader,
  renderSticky,
} = require("./render/chrome");
const { clampScroll, panelScrollFor } = require("./render/scroll");
const { VIEW_BROWSE, VIEW_LOG, VIEW_READ, VIEW_SEARCH } = require("./view-names");

/** Turn the assembled lines into one writable frame. */
function frameFrom(lines) {
  return (
    screen.home +
    lines.map((line, index) => moveTo(index + 1, 1) + line + screen.eraseToEnd).join("")
  );
}

/**
 * Take the diff layout from the rows on screen rather than from the width.
 *
 * The width still says whether there is a panel and how much is left for the diff,
 * but the reader can have chosen the layout the rows were built in — and drawing a
 * column separator beside rows built without one is what asking the width twice
 * would cost. A model without the field is one from a test that predates it.
 */
function withChosenLayout(layout, model) {
  return model.sideBySide === undefined ? layout : { ...layout, sideBySide: model.sideBySide };
}

/**
 * Assemble one frame from the screen model.
 * @param {object} model Everything the frame needs
 * @param {{columns: number, rows: number}} size Terminal size
 * @returns {string} A string ready to write to the terminal
 */
function renderScreen(model, size) {
  const bodyHeight = Math.max(1, size.rows - chromeRows(model, size.columns));
  const showingPicker = model.picker !== null && model.picker !== undefined;

  // Reading a file gets the whole width: there is no second column to compare against
  const isReading = model.view === VIEW_READ || model.view === VIEW_SEARCH;
  const layout = isReading
    ? { ...resolveLayout(size.columns), showPanel: false, sideBySide: false, diffWidth: size.columns }
    : withChosenLayout(resolveLayout(size.columns), model);

  // A peek stands in front of the body the way the picker does: it is a glance, and
  // the next key takes it away — see lib/state/views/peek.js
  const peeking = model.peek !== null && model.peek !== undefined;
  const overlaid = showingPicker || peeking;
  const rows = showingPicker
    ? pickerRows(model.picker)
    : peeking
      ? peekRows(model.peek)
      : model.rows;
  const diffScroll = overlaid ? 0 : clampScroll(model.scroll, rows.length, bodyHeight);
  const panelScroll = panelScrollFor(model.selectedIndex, model.files.length, bodyHeight);
  const bodyWidth = Math.max(1, layout.diffWidth - GUTTER_WIDTH);

  const lines = [renderHeader(model, size.columns)];

  // Directly under the header, so that what the cursor is inside sits above the
  // inside of it rather than somewhere in the middle of the frame
  if (model.sticky) {
    lines.push(renderSticky(model.sticky, size.columns));
  }

  if (model.view === VIEW_BROWSE && model.browse) {
    lines.push(...renderBrowseBody(model, size.columns, bodyHeight));
    lines.push(...renderFooter(model, size.columns));
    return frameFrom(lines);
  }

  // The log draws four panes rather than the two below, and an open picker still takes
  // the screen from all of them — it is a question about where a batch is going, and
  // whatever is behind it can wait for the answer.
  if (model.view === VIEW_LOG && model.log && !showingPicker) {
    lines.push(...renderLogBody(model, size.columns, bodyHeight));
    lines.push(...renderFooter(model, size.columns));
    return frameFrom(lines);
  }

  for (let offset = 0; offset < bodyHeight; offset += 1) {
    lines.push(
      renderBodyLine(model, {
        offset,
        layout,
        rows,
        diffScroll,
        panelScroll,
        bodyWidth,
        showingPicker: overlaid,
      })
    );
  }

  lines.push(...renderFooter(model, size.columns));

  return frameFrom(lines);
}

module.exports = {
  chromeRows,
  renderScreen,
};
