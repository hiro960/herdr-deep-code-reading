"use strict";

// Which pane an action opens, and what each screen it can open on is called.
//
// The plugin owns one pane, opened on one of three things: a diff, the file browser,
// or the log. The diff modes all differ only in the diff they load.

const REVIEW_PANE = "review";

// The mode a pane opens in when nothing says otherwise. It is also the only mode
// whose file list lines up with `git status`, which is why it is the only one that
// offers the staging keys — see reduceGit.
const DEFAULT_MODE = "review";

const BROWSE_MODE = "files";
const LOG_MODE = "log";

// Every mode opens the same pane. They differ in what it shows first: a diff, the file
// browser, or the log. Sharing one pane is what lets comments from all three go out
// together, so this is a set of known modes rather than a map to different panes.
const KNOWN_MODES = new Set([DEFAULT_MODE, "staged", "branch", BROWSE_MODE, LOG_MODE]);

/** The pane entrypoint a mode opens, or null when the mode is unknown. */
function entrypointFor(mode) {
  return KNOWN_MODES.has(mode) ? REVIEW_PANE : null;
}

/** Whether a mode is one the manifest declares. */
function isKnownMode(mode) {
  return entrypointFor(mode) !== null;
}

/** Whether the pane should open on the file browser rather than a diff. */
function startsInBrowser(mode) {
  return mode === BROWSE_MODE;
}

/** Whether the pane should open on the log rather than a diff. */
function startsInLog(mode) {
  return mode === LOG_MODE;
}

module.exports = {
  BROWSE_MODE,
  DEFAULT_MODE,
  KNOWN_MODES,
  REVIEW_PANE,
  entrypointFor,
  isKnownMode,
  startsInBrowser,
  startsInLog,
};
