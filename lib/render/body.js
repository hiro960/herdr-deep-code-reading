"use strict";

// One line of the diff body: the file panel down the left, and the diff beside it.
//
// Two screens draw this. The diff view fills the whole body with it, and the log fills
// the half under the graph — the same two panes at the same widths, because they are
// the same two panes and a reader should not have to learn them twice.

const { GUTTER_WIDTH, SEPARATOR_WIDTH } = require("../layout");
const { separator } = require("./cells");
const {
  renderDiffBody,
  renderEmptyDiffRow,
  renderGutter,
  rowHasComment,
  rowHasNote,
} = require("./diff-rows");
const { renderPanelRow } = require("./panel");

/** The file-panel half of one body line, including its separator. */
function renderPanelSegment(model, layout, panelScroll, offset) {
  if (!layout.showPanel) {
    return "";
  }

  const panelBodyWidth = layout.panelWidth - SEPARATOR_WIDTH;
  const index = panelScroll + offset;
  const entry = model.files[index];

  const body =
    entry === undefined
      ? " ".repeat(panelBodyWidth)
      : renderPanelRow(entry, panelBodyWidth, index === model.selectedIndex, model.panelActive !== false);

  return body + separator();
}

/** One line of the body: the panel segment beside the diff segment. */
function renderBodyLine(model, context) {
  const { offset, layout, rows, diffScroll, panelScroll, bodyWidth, showingPicker } = context;
  const panel = renderPanelSegment(model, layout, panelScroll, offset);

  const rowIndex = diffScroll + offset;
  const row = rows[rowIndex];

  if (row === undefined) {
    return panel + " ".repeat(GUTTER_WIDTH) + renderEmptyDiffRow(bodyWidth, layout.sideBySide);
  }

  const isCursor = !showingPicker && rowIndex === model.cursor && model.cursorActive !== false;
  const hasComment = !showingPicker && rowHasComment(row, model.commentKeys);
  const hasNote = !showingPicker && rowHasNote(row, model.noteLines);
  const isSelected =
    !showingPicker &&
    model.selection !== null &&
    model.selection !== undefined &&
    rowIndex >= model.selection.from &&
    rowIndex <= model.selection.to;

  return (
    panel +
    renderGutter(isCursor, hasComment, isSelected, hasNote) +
    renderDiffBody(row, bodyWidth, layout.sideBySide, isCursor ? model.word : null, isCursor)
  );
}

module.exports = { renderBodyLine };
