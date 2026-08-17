"use strict";

// Turning the repository into rows, and the paths a row stands for.
//
// The bottom of the state layer: nothing here knows which view is showing or where
// the cursor is, only how a file becomes a list of screen rows.

const git = require("../git");
const { buildContentRows, readFileLines, rowOfLine } = require("../file-view");
const { MIN_TEXT_WIDTH, diffTextWidths, readTextWidth, resolveLayout } = require("../layout");
const { BLAME_WIDTH, loadBlame } = require("../blame");
const { buildFileRows, cellOfRow } = require("../view-model");
const { detectLanguage } = require("../syntax");
const { buildFileSummaries, pathOf } = require("./files");
const { VIEW_CONFLICTS, VIEW_READ, VIEW_SEARCH } = require("../view-names");
const { sideOfLines, withConflictSides } = require("../conflict");
const { NOTE_FILE_UNCHANGED, NOTE_NO_CHANGES } = require("./messages");

const READ_CONTENT = "content";
const READ_DIFF = "diff";

/**
 * Display rows for the selected file. One element is one screen row.
 * @param {object} [widths] Text columns a row's content gets; omit to leave long
 *   lines uncut, which is what a hand-built state in a test wants
 */
function rowsForSelection(files, index, isSideBySide, widths) {
  const file = files[index];
  if (file === undefined) {
    return [{ kind: "note", text: NOTE_NO_CHANGES }];
  }
  return buildFileRows(file, isSideBySide, widths);
}

/**
 * The columns a diff row's content gets in a state.
 *
 * The diff view keeps a panel beside it and the reading view does not, so the width
 * a diff is drawn at depends on which of them is showing it.
 */
function diffWidthsFor(state) {
  if (state.columns === undefined || state.columns === null) {
    return undefined;
  }
  const area =
    state.view === VIEW_READ ? state.columns : resolveLayout(state.columns).diffWidth;
  return diffTextWidths(area, state.sideBySide);
}

/**
 * Every path a staging operation has to cover.
 * A rename is two index entries — the new path added and the old one deleted — so
 * staging only the new path would leave the deletion behind as an unstaged change.
 */
function pathsOf(file) {
  if (file === undefined || file === null) {
    return [];
  }
  if (file.isRenamed && file.newPath && file.oldPath) {
    return [file.newPath, file.oldPath];
  }
  const single = pathOf(file);
  return single === null ? [] : [single];
}

/** First row index that carries a diff line, so the cursor never starts on a header. */
function firstDiffRow(rows) {
  const index = rows.findIndex((row) => row.kind === "pair" || row.kind === "line");
  return index === -1 ? 0 : index;
}

/**
 * Put a freshly loaded diff on a state.
 *
 * Six fields move together whenever the files do — what the panel says about each of
 * them, which one is selected, its rows, and where the cursor and the window sit in
 * those rows — and a reload that set `files` and forgot `fileSummaries` would leave the
 * panel describing the previous diff. Reloading and opening a commit both landed here
 * by writing the six out; this is the one place that knows they belong to each other.
 *
 * The caller says which file is selected and keeps whatever else its own transition is
 * about — the mode, the title, the history — around the outside of this.
 *
 * @param {Array<object>} files A freshly parsed diff
 * @param {number} index Which of them the panel points at
 */
function withFiles(state, files, index) {
  const rows = rowsForSelection(files, index, state.sideBySide, diffWidthsFor(state));

  return {
    ...state,
    files,
    fileSummaries: buildFileSummaries(files),
    selectedIndex: index,
    rows,
    scroll: 0,
    cursor: firstDiffRow(rows),
  };
}

/** The repository's file list, fetched the first time the browser is opened. */
function withRepoPaths(state) {
  if (state.repoPaths !== null) {
    return state;
  }
  return { ...state, repoPaths: git.listRepoPaths(state.repoDir) };
}

/**
 * The blame labels for a file, when the reader has the layer on.
 *
 * A file git cannot blame — untracked, or never committed — quietly goes without
 * rather than refusing to open. The reader asked for a layer over the file, not for
 * the file to be withheld because the layer has nothing to say about it.
 *
 * @returns {Map<number, string>|null} null when the layer is off or unavailable
 */
function blameLabels(state, filePath) {
  if (state.blame !== true) {
    return null;
  }
  const result = loadBlame(state.repoDir, filePath);
  return result.ok ? result.labels : null;
}

/**
 * Whether this file is one the merge in progress could not settle.
 * Asked of the list the state already carries rather than of git: the rows are built
 * on every keystroke that moves through a file, and a process per keystroke to ask
 * something that changes only when a key resolves something is a process wasted.
 */
function isConflicted(state, filePath) {
  const merge = state.merge;
  if (merge === null || merge === undefined || merge.merging !== true) {
    return false;
  }
  return (merge.conflicts || []).some(
    (conflict) => conflict.path === filePath && conflict.resolved !== true
  );
}

/**
 * Rows for one file, in whichever reading mode is active.
 * The diff mode answers "what changed here" without leaving the browser, and its
 * rows carry the same anchors, so a comment works either way.
 */
function rowsForFile(state, filePath) {
  if (state.readMode !== READ_DIFF) {
    // The blame column is taken out of the width before the wrap rather than drawn
    // over it afterwards: a row is exactly as wide as it was measured to be, which
    // is the invariant every other part of the frame is built on.
    const labels = blameLabels(state, filePath);
    const room = readTextWidth(state.columns) - (labels === null ? 0 : BLAME_WIDTH);
    const result = readFileLines(state.repoDir, filePath);

    // Wrapped to the columns the renderer will draw into, so a long line becomes
    // several rows instead of being cut off with the rest thrown away
    const rows = buildContentRows(
      result,
      detectLanguage(filePath),
      Math.max(MIN_TEXT_WIDTH, room),
      labels
    );

    // A file a merge could not settle holds both versions between markers. Which side
    // each line came from is read off the file itself rather than out of git, and it is
    // read here so that every row carries it — see lib/conflict.
    if (!result.ok || !isConflicted(state, filePath)) {
      return rows;
    }
    return withConflictSides(rows, sideOfLines(result.lines));
  }

  try {
    const file = git.loadFileDiff(state.repoDir, state.mode, filePath, state.commit);
    if (file === null) {
      return [{ kind: "note", text: NOTE_FILE_UNCHANGED }];
    }
    return buildFileRows(file, state.sideBySide, diffWidthsFor(state));
  } catch (error) {
    return [{ kind: "note", text: `Could not diff this file: ${error.message}` }];
  }
}

/**
 * Rebuild the open file's rows and leave the reader looking at the same line.
 *
 * Two things rebuild a file the reader is standing in — turning the blame column on,
 * and reloading after the file changed on disk — and both have to answer the same
 * question afterwards: the row indexes have all moved, so where is the line that was
 * under the cursor now, and how far down the screen was it. A file that lost that line
 * while it was being edited has no answer, and the top is where a file opens anyway.
 *
 * @param {object} previous The state the reader is looking at, for the line and the height
 * @param {object} next The state the rows are built from, which is what changed
 * @returns {{rows: Array<object>, cursor: number, scroll: number}}
 */
function rowsKeepingLine(previous, next) {
  const cell = cellOfRow(previous.rows[previous.cursor]);
  const line = cell === null || cell.num === undefined ? null : cell.num;
  const rows = rowsForFile(next, previous.openPath);
  const found = line === null ? -1 : rowOfLine(rows, line);
  const cursor = found === -1 ? 0 : found;
  // How far down the screen the reader was, kept so the rebuild does not scroll under them
  const offset = Math.max(0, previous.cursor - previous.scroll);

  return { rows, cursor, scroll: Math.max(0, cursor - offset) };
}

/**
 * The rows the current view should be showing.
 *
 * Every view draws from a different source, so anything that rebuilds rows has to
 * ask here rather than assume the diff. Rebuilding from the diff while the reader
 * is open would put one file's lines on screen under another file's name.
 */
function rowsFor(state) {
  if (state.view === VIEW_READ && state.openPath !== null) {
    return rowsForFile(state, state.openPath);
  }
  if (state.view === VIEW_SEARCH || state.view === VIEW_CONFLICTS) {
    // A list of places is one row per place at any width, so no layout change can
    // invalidate it — which also keeps the grouped lists the outline and the
    // imports view build from being flattened back into plain results. The conflict
    // list is one of those lists: a file and what is wrong with it, one to a row.
    return state.rows;
  }
  return rowsForSelection(state.files, state.selectedIndex, state.sideBySide, diffWidthsFor(state));
}

module.exports = {
  READ_CONTENT,
  diffWidthsFor,
  READ_DIFF,
  firstDiffRow,
  pathsOf,
  rowsFor,
  rowsForFile,
  rowsForSelection,
  rowsKeepingLine,
  withFiles,
  withRepoPaths,
};
