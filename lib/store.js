"use strict";

// One JSON file per kind of thing worth remembering, keyed by repository.
//
// $HERDR_PLUGIN_STATE_DIR belongs to the plugin rather than to one repository, so
// every store here holds every repository's entries side by side and hands back only
// the ones asked for. Writing one repository's list leaves the others exactly as they
// were, which is what lets two panes on two repositories share a file.
//
// Nothing in a store is the reader's work in the sense a comment is: it is a note
// about where they have been. So a file that cannot be read is an empty list rather
// than a reason to refuse to open the pane, and the next save rewrites it.

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

// What a store and the exported review are written with. A store names paths inside
// the reader's repository and the export quotes the code itself, and neither is any of
// the other accounts on the machine's business.
const DIRECTORY_MODE = 0o700;
const FILE_MODE = 0o600;

/**
 * Where the plugin keeps things when Herdr did not give the pane a directory.
 *
 * Not the temporary directory itself. On a Linux host that is shared with every other
 * account on the machine, so a fixed name in it is readable by all of them — and it is
 * a name anyone can leave a symlink under for this write to follow. A directory of the
 * plugin's own, named for the account that owns it and created with DIRECTORY_MODE, is
 * a place only one user can reach.
 */
function fallbackDirectory() {
  const owner = typeof process.getuid === "function" ? process.getuid() : "user";
  return path.join(os.tmpdir(), `herdr-deep-code-reading-${owner}`);
}

/** The directory this pane's state belongs in. */
function stateDirectory(env) {
  return (env && env.HERDR_PLUGIN_STATE_DIR) || fallbackDirectory();
}

/** Where a store lives, given the environment the pane was launched with. */
function storePathFor(env, filename) {
  return path.join(stateDirectory(env), filename);
}

/** The whole store, or an empty one when there is nothing readable there. */
function readStore(file) {
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    // No file yet on a first run, or one that has gone bad. Both mean the same here.
    return {};
  }

  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {};
  }
  return parsed;
}

/**
 * One repository's entries, with anything malformed left out.
 * A hand-edited file may hold anything at all, and the caller says what a valid
 * entry looks like.
 *
 * @param {function(object): boolean} isValid
 * @returns {Array<object>}
 */
function loadEntries(file, repoDir, isValid) {
  const forRepo = readStore(file)[repoDir];
  return Array.isArray(forRepo) ? forRepo.filter(isValid) : [];
}

/**
 * Write one repository's entries, leaving every other repository's alone.
 * @returns {{ok: true}|{ok: false, error: string}}
 */
function saveEntries(file, repoDir, entries) {
  const next = { ...readStore(file), [repoDir]: entries };

  try {
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: DIRECTORY_MODE });
    fs.writeFileSync(file, JSON.stringify(next, null, 2) + "\n", { mode: FILE_MODE });
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

module.exports = {
  DIRECTORY_MODE,
  FILE_MODE,
  loadEntries,
  saveEntries,
  stateDirectory,
  storePathFor,
};
