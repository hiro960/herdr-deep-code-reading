"use strict";

// Application state and its transitions. Everything here is pure: a key press maps
// to a new state, and anything needing the outside world is reported as an effect
// for the caller to perform.
//
// The state layer is one module per job, under ./state:
//
//   messages.js     what the footer says when a key cannot do its usual work, and the
//                   two ways of putting one on a state
//   files.js        which file a state is pointing at, and what the panel says of each
//   rows.js         turning the repository into rows, and the paths a row stands for
//   commit-diff.js  putting one commit's diff on a state, which two views both do
//   cursor.js       where the reader is: the row, the column, the marked run
//   log.js          the log's four panes, and the cursor in each of them
//   views.js        opening a file, a list, the browser, the diff; and going back
//   composing.js    the text field, and what accepting it does
//   reducers.js     a key press to the next state, one reducer per view
//
// They form a chain in that order — each may use what is above it and nothing
// below — which is what keeps the browser and the reader from requiring each other
// just because both can open a file. This file is the way in, and re-exports only
// what the pane and the tests actually call.
//
// The names a reducer switches on are in ../view-names, which depends on nothing, so
// asking which view is showing costs no dependency at all. ./state/files is there for
// the same reason: which file a state points at is a fact about a diff rather than
// about a frame, and eight modules of this layer would otherwise require the model
// built from them to ask it.

const { helpText, stickyFor, toScreenModel } = require("./screen-model");
const { firstDiffRow, rowsForSelection } = require("./state/rows");
const { createState, drawnAt, reloaded, reloadedInPlace, withLayout } = require("./state/views");
const { reduce } = require("./state/reducers");

module.exports = {
  createState,
  drawnAt,
  firstDiffRow,
  helpText,
  reduce,
  reloaded,
  reloadedInPlace,
  rowsForSelection,
  stickyFor,
  toScreenModel,
  withLayout,
};
