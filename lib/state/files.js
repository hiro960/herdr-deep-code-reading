"use strict";

// Which file a state is pointing at, and what the panel has to say about each one.
//
// These three are asked by the state layer and answered for the renderer, and they
// used to live in ../screen-model because the renderer is where the answers are drawn.
// That put eight modules of the state layer requiring the model built from them — the
// bottom of the layer depending on the top of it, which is the inversion ../view-names
// was pulled out to end for six string constants. This is the same move for three
// functions: they are facts about a diff, not about a frame, so they live below
// everything that wants them and ../screen-model has them from here.
//
// Nothing here depends on anything in ./ — only on the diff modules beneath the whole
// state layer — which is what lets ./rows use it.

const { countChanges, fileLabel, fileStatus } = require("../view-model");
const { VIEW_READ } = require("../view-names");

/**
 * Repo-relative path of a diff entry, as comments record it.
 * @param {object|null} file A file from parseUnifiedDiff
 * @returns {string|null} null when there is no file
 */
function pathOf(file) {
  if (file === undefined || file === null) {
    return null;
  }
  return file.newPath || file.oldPath || null;
}

/**
 * The file the comment keys act on.
 * Reading a file and reviewing a diff both anchor comments, to different paths.
 * @returns {string|null}
 */
function currentFilePath(state) {
  if (state.view === VIEW_READ) {
    return state.openPath;
  }
  return pathOf(state.files[state.selectedIndex]);
}

/**
 * Per-file panel data, computed once per diff load.
 * Counting hunk lines on every frame would cost the whole diff on every keystroke,
 * and none of it changes until the files are reloaded.
 * @returns {Array<object>} One summary per file, in the diff's order
 */
function buildFileSummaries(files) {
  return files.map((file) => ({
    path: pathOf(file),
    label: fileLabel(file),
    // The two-letter git status separates staged from unstaged; fall back to the
    // single letter derived from the diff when status is unavailable
    status: file.gitStatus || fileStatus(file),
    ...countChanges(file),
  }));
}

module.exports = {
  buildFileSummaries,
  currentFilePath,
  pathOf,
};
