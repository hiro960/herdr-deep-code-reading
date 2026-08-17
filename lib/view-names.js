"use strict";

// What is on screen, named.
//
// Six views and eight text fields, as the strings the state carries and the reducers
// switch on. Nothing here but the names.
//
// They live apart from the model built for the renderer because everything in the
// state layer needs the names and none of it needs the model. A reducer asking which
// view is showing used to require the screen model to find out, which had the bottom
// of the state layer depending on the top of it for six string constants.

const VIEW_DIFF = "diff";
const VIEW_BROWSE = "browse";
const VIEW_READ = "read";
const VIEW_SEARCH = "search";
// Every comment written so far, listed — see lib/state/views/sheet.js
const VIEW_COMMENTS = "comments";
// The log is the one view drawn from four panes rather than one list, so it carries a
// sub-state of its own — see lib/state/log.js.
const VIEW_LOG = "log";
// What a merge could not settle, and the keys that settle it — see
// lib/state/views/conflicts.js. The one view that is a job rather than a reading.
const VIEW_CONFLICTS = "conflicts";

const INPUT_COMMENT = "comment";
const INPUT_COMMIT = "commit";
const INPUT_FILTER = "filter";
const INPUT_FIND = "find";
const INPUT_SEARCH = "search";
const INPUT_OPEN = "open";
// The pickaxe: text to look for in the history rather than in the working tree
const INPUT_PICKAXE = "pickaxe";
// A question about the line under the cursor, for an agent in another pane
const INPUT_ASK = "ask";
// Whose commits the graph should show
const INPUT_AUTHOR = "author";
// The name of a file that does not exist yet — see lib/state/views/create.js
const INPUT_CREATE = "create";

module.exports = {
  INPUT_ASK,
  INPUT_AUTHOR,
  INPUT_COMMENT,
  INPUT_CREATE,
  INPUT_COMMIT,
  INPUT_FILTER,
  INPUT_FIND,
  INPUT_OPEN,
  INPUT_PICKAXE,
  INPUT_SEARCH,
  VIEW_BROWSE,
  VIEW_COMMENTS,
  VIEW_CONFLICTS,
  VIEW_DIFF,
  VIEW_LOG,
  VIEW_READ,
  VIEW_SEARCH,
};
