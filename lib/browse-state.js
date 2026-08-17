"use strict";

// The file browser's own state: which directory is open, which entry is selected,
// and the filter narrowing the listing. Pure, like the rest of the state layer.

const { filterByName } = require("./fuzzy");
const { listDirectory, parentOf } = require("./file-tree");

function clampIndex(index, length) {
  if (length === 0) {
    return 0;
  }
  return Math.max(0, Math.min(index, length - 1));
}

function entriesFor(allEntries, filter) {
  return filter === "" ? allEntries : filterByName(allEntries, filter);
}

/**
 * Open a directory with nothing selected but the first entry.
 * The parent listing is derived once here rather than on every frame: it only
 * changes when the directory does, and deriving it walks the whole path list.
 */
function createBrowse(paths, dir) {
  const parentDir = parentOf(dir);
  const parentEntries = dir === "" ? [] : listDirectory(paths, parentDir);

  // The unfiltered listing is kept so typing a filter narrows an array in hand
  // rather than re-walking every path in the repository on each keystroke
  const allEntries = listDirectory(paths, dir);

  return {
    dir,
    allEntries,
    entries: allEntries,
    index: 0,
    filter: "",
    parentEntries,
    parentIndex: parentEntries.findIndex((entry) => entry.path === dir),
  };
}

/** Move the selection, stopping at either end of the listing. */
function moveBrowse(browse, delta) {
  return { ...browse, index: clampIndex(browse.index + delta, browse.entries.length) };
}

/** The entry under the selection, or null when the listing is empty. */
function selectedEntry(browse) {
  const entry = browse.entries[browse.index];
  return entry === undefined ? null : entry;
}

/**
 * Act on the selection: step into a directory, or report the file to open.
 * @returns {{browse: object, openPath: string|null}}
 */
function descend(browse, paths) {
  const entry = selectedEntry(browse);
  if (entry === null) {
    return { browse, openPath: null };
  }
  if (!entry.isDirectory) {
    return { browse, openPath: entry.path };
  }
  return { browse: createBrowse(paths, entry.path), openPath: null };
}

/** Step out to the parent directory, selecting the directory just left. */
function ascend(browse, paths) {
  if (browse.dir === "") {
    return browse;
  }

  const parent = parentOf(browse.dir);
  const next = createBrowse(paths, parent);
  const previous = next.entries.findIndex((entry) => entry.path === browse.dir);

  return previous === -1 ? next : { ...next, index: previous };
}

/**
 * Narrow the listing. An empty query restores it.
 *
 * A narrowed listing is ranked best-first, so the selection goes to the top of it:
 * keeping the old index would leave the highlight — and the preview beside it — on
 * whichever entry happened to land at that position. Clearing the filter is the
 * opposite case: the listing the reader was already looking at comes back, so the
 * selection is only pulled back into range.
 */
function withFilter(browse, filter) {
  const entries = entriesFor(browse.allEntries, filter);
  const index = filter === "" ? clampIndex(browse.index, entries.length) : 0;
  return { ...browse, filter, entries, index };
}

module.exports = {
  ascend,
  createBrowse,
  descend,
  moveBrowse,
  selectedEntry,
  withFilter,
};
