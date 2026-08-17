"use strict";

// The file browser's three columns: the directory above, the one being read, and a
// glance at whatever the selection points at.
//
// The preview draws through the body's own dispatch rather than a second, narrower
// copy of it — the only row kind it adds is a directory entry, which is the one thing
// the body is never asked to draw.

const { theme } = require("../ansi");
const { resolveBrowseLayout } = require("../layout");
const { truncateToWidth } = require("../text");
const { cell, separator } = require("./cells");
const { renderDiffBody } = require("./diff-rows");
const { panelScrollFor } = require("./scroll");

/** One row of a directory column. Directories are told apart by colour and a slash. */
function renderEntryRow(entry, width, isSelected) {
  if (entry === undefined) {
    return " ".repeat(width);
  }

  const name = entry.isDirectory ? entry.name + "/" : entry.name;
  const style = isSelected
    ? { bg: theme.panelSelectedBg, fg: theme.panelSelectedFg }
    : { fg: entry.isDirectory ? theme.hunkFg : theme.panelFg };

  return cell(" " + truncateToWidth(name, Math.max(0, width - 1)), width, style);
}

/** A column of directory entries, scrolled to keep the selection visible. */
function renderEntryColumn(entries, index, width, height, offset) {
  const scroll = panelScrollFor(index, entries.length, height);
  return renderEntryRow(entries[scroll + offset], width, scroll + offset === index);
}

/**
 * One row of the preview column.
 *
 * A previewed directory contributes entry rows, which only this column knows about.
 * Everything else is a row the body could also be asked to draw, so it goes through
 * the same dispatch rather than a second, narrower copy of it.
 */
function renderPreviewRow(rows, width, offset) {
  const row = rows === null ? undefined : rows[offset];
  if (row === undefined) {
    return " ".repeat(width);
  }
  if (row.kind === "entry") {
    return renderEntryRow(row.entry, width, false);
  }
  return renderDiffBody(row, width, false);
}

/** The file browser: parent, current directory, and a preview of the selection. */
function renderBrowseBody(model, columns, bodyHeight) {
  const browse = resolveBrowseLayout(columns);
  const lines = [];

  for (let offset = 0; offset < bodyHeight; offset += 1) {
    let line = "";

    if (browse.parentWidth > 0) {
      line +=
        renderEntryColumn(
          model.browse.parentEntries,
          model.browse.parentIndex,
          browse.parentWidth,
          bodyHeight,
          offset
        ) + separator();
    }

    line += renderEntryColumn(
      model.browse.entries,
      model.browse.index,
      browse.currentWidth,
      bodyHeight,
      offset
    );

    if (browse.previewWidth > 0) {
      line += separator() + renderPreviewRow(model.preview, browse.previewWidth, offset);
    }

    lines.push(line);
  }

  return lines;
}

module.exports = { renderBrowseBody, renderEntryRow };
