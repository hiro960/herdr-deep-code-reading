"use strict";

// The reading views: a file's own lines, the browser that leads to one, the diff
// waiting behind both, and the way back out of any of them.
//
// These are shared: the browser opens a file the reader then leaves for the search
// that led there. Keeping them together is what stops those views from having to
// require each other.

const { createBrowse, moveBrowse, selectedEntry } = require("../../browse-state");
const { buildContentRows, readFileLines } = require("../../file-view");
const { listDirectory } = require("../../file-tree");
const { fileEntry } = require("../../journal");
const { popPlace, pushPlace, restorePlace } = require("../../jump-history");
const { detectLanguage } = require("../../syntax");
const { VIEW_BROWSE, VIEW_DIFF, VIEW_READ } = require("../../view-names");
const {
  READ_CONTENT,
  READ_DIFF,
  diffWidthsFor,
  firstDiffRow,
  rowsForFile,
  rowsForSelection,
  rowsKeepingLine,
  withRepoPaths,
} = require("../rows");
const {
  MESSAGE_BLAME_IN_CONTENTS,
  MESSAGE_NOTHING_TO_TRACE,
  clearTransient,
  withMessage,
} = require("../messages");
const { recordVisit } = require("../visits");
const { withLayout } = require("./layout");

const PREVIEW_LINE_LIMIT = 300;

/**
 * Read a file and switch to the reading view.
 *
 * Where the reader came from is recorded first: a search hit is opened out of a
 * result list that took a query to produce, and leaving the file has to give it back
 * rather than drop the reader somewhere else.
 */
function openForReading(state, filePath) {
  return {
    ...state,
    history: pushPlace(state.history, state),
    view: VIEW_READ,
    openPath: filePath,
    rows: rowsForFile(state, filePath),
    scroll: 0,
    cursor: 0,
    message: null,
    effect: null,
  };
}

/**
 * Open a file the reader picked out of the browser.
 *
 * The same open, recorded. Every other way into this view arrives at a place rather
 * than at a file — a search hit, a definition, a bookmark, a line of a list — and a
 * record of each of those is a record of keystrokes rather than of reading. Choosing a
 * file and opening it is the decision worth remembering.
 */
function openChosenFile(state, filePath) {
  return recordVisit(openForReading(state, filePath), fileEntry(filePath));
}

/**
 * Go back to the last place worth returning to.
 * Nowhere to go back to is not a failure worth reporting: it is the start of the
 * session, and a key that does nothing there is exactly right.
 */
function jumpBack(state) {
  const { place, history } = popPlace(state.history);
  if (place === null) {
    return state;
  }

  const columns = state.columns;
  const restored = restorePlace({ ...clearTransient(state), history }, place);

  // A place brings its rows back with it, wrapped to the width the terminal had when
  // it was recorded. If the terminal has moved since, drawing them now would cut the
  // end off every piece — so the same path a resize takes puts them right.
  return withLayout(restored, columns === undefined ? restored.columns : columns);
}

/**
 * Leave whatever is open: back where it was opened from, or out to the browser.
 * The browser is the floor under a reading session, so leaving the first file of one
 * lands there rather than nowhere.
 */
function leaveForBrowser(state) {
  const back = jumpBack(state);
  return back === state ? openBrowser(state) : back;
}

/**
 * Turn the blame column on or off.
 *
 * The column is taken out of the width the lines are wrapped to, so this is a rebuild
 * rather than a redraw — and the reader is kept on the line they were on, which after
 * a rewrap is a different row than it was.
 *
 * Only a file's contents can carry it. A diff already says which change each line
 * belongs to: the one on screen.
 */
function toggleBlame(state) {
  if (state.openPath === null || state.openPath === undefined) {
    return withMessage(state, MESSAGE_NOTHING_TO_TRACE);
  }
  if (state.readMode === READ_DIFF) {
    return withMessage(state, MESSAGE_BLAME_IN_CONTENTS);
  }

  const blame = state.blame !== true;
  const next = { ...clearTransient(state), blame };

  return {
    ...next,
    ...rowsKeepingLine(state, next),
    selectionAnchor: null,
    message: blame ? null : "Blame off",
  };
}

/** Flip between a file's contents and its diff, in the reader or the preview. */
function toggleReadMode(state) {
  const readMode = state.readMode === READ_DIFF ? READ_CONTENT : READ_DIFF;
  const next = { ...clearTransient(state), readMode };

  if (state.view === VIEW_READ && state.openPath !== null) {
    return { ...next, rows: rowsForFile(next, state.openPath), scroll: 0, cursor: 0 };
  }

  return withPreview(next);
}

/**
 * Refresh the preview column for whatever the browser has selected.
 * Only the first screenful or so is read: the preview is a glance, not the reader.
 */
function withPreview(state) {
  const entry = selectedEntry(state.browse);

  if (entry === null) {
    return { ...state, preview: null };
  }

  // A directory previews its contents, so the level below is visible before
  // stepping into it
  if (entry.isDirectory) {
    return {
      ...state,
      preview: listDirectory(state.repoPaths || [], entry.path).map((child) => ({
        kind: "entry",
        entry: child,
      })),
    };
  }

  if (state.readMode === READ_DIFF) {
    // The preview column is far too narrow to split in two, so its diff is always
    // unified — which also keeps paired rows out of a column that cannot draw them
    const unified = { ...state, sideBySide: false };
    return { ...state, preview: rowsForFile(unified, entry.path).slice(0, PREVIEW_LINE_LIMIT) };
  }

  const result = readFileLines(state.repoDir, entry.path);
  const capped = result.ok
    ? { ok: true, lines: result.lines.slice(0, PREVIEW_LINE_LIMIT) }
    : result;

  // No width, so no wrapping: the preview is a glance down a narrow column, and a
  // line wrapped into four rows there would push the next file's out of sight for
  // no gain. The reader is where a long line is meant to be read.
  return { ...state, preview: buildContentRows(capped, detectLanguage(entry.path)) };
}

/** Enter the file browser, keeping the diff view's state untouched behind it. */
function openBrowser(state) {
  const loaded = withRepoPaths(state);
  const browse = loaded.browse === null ? createBrowse(loaded.repoPaths, "") : loaded.browse;

  return withPreview({ ...clearTransient(loaded), view: VIEW_BROWSE, browse });
}

/** Return to the diff, rebuilding its rows since the reading view replaced them. */
function openDiff(state) {
  const rows = rowsForSelection(state.files, state.selectedIndex, state.sideBySide, diffWidthsFor(state));

  return {
    ...state,
    view: VIEW_DIFF,
    openPath: null,
    rows,
    scroll: 0,
    cursor: firstDiffRow(rows),
    message: null,
    effect: null,
  };
}

/**
 * Move the browser's selection, refreshing the preview it points at.
 * The other list views page with d/u/g/G, so a long directory does too.
 */
function moveBrowseBy(state, delta) {
  return withPreview({ ...clearTransient(state), browse: moveBrowse(state.browse, delta) });
}

module.exports = {
  jumpBack,
  leaveForBrowser,
  moveBrowseBy,
  openBrowser,
  openChosenFile,
  openDiff,
  openForReading,
  toggleBlame,
  toggleReadMode,
  withPreview,
};
