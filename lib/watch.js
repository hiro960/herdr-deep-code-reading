"use strict";

// Noticing that the repository has moved under the reader.
//
// The case this exists for is the one the plugin is built around: an agent in another
// pane is editing the files being read here. Pressing `r` to find out what it did is
// the sort of thing a tool should do for you.
//
// It polls rather than watching the filesystem. fs.watch's recursive mode is not
// available on Linux before Node 20, and the manifest promises Linux on Node 18 — so
// the portable answer is the only answer. What is polled is a fingerprint rather than
// the diff itself: two short git commands and a stat per changed file, against
// re-parsing a whole diff every second.
//
// `git status` alone is not enough. Its letters say a file is modified, not what is
// in it, so an agent's second edit to an already-modified file would leave the
// fingerprint untouched and the reader looking at stale lines. The mtime and size of
// each path git names are what close that hole, and there are only ever a few of them.

const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");

const { runGit } = require("./git");
const { parseStatus } = require("./status");

// How often the repository is asked whether it has changed. Fast enough that an
// agent's edit shows up while the reader is still looking at the file, slow enough
// that two git processes per tick are nothing.
const WATCH_INTERVAL_MS = 1500;

/** The mtime and size of one path, or a marker for a path that is not there. */
function stampOf(repoDir, relativePath) {
  return stampAt(path.join(repoDir, relativePath), relativePath);
}

/** The same, for a path that is not inside the repository. */
function stampAt(fullPath, label) {
  try {
    const stats = fs.statSync(fullPath);
    return `${label}:${stats.mtimeMs}:${stats.size}`;
  } catch {
    // Deleted between `git status` listing it and this asking, or — for the notes —
    // never written at all. That it is not there is itself the fact worth recording.
    return `${label}:gone`;
  }
}

/**
 * A short string that changes whenever anything the pane shows has changed.
 *
 * Four things go into it: which commit HEAD is on, what `git status` says about the
 * working tree, the mtime and size of every path status named, and the notes file.
 *
 * The notes are the one thing here that is not in the repository. They are written by
 * an agent in another pane, outside the working tree entirely, and a watch that did
 * not look at them would leave an answer sitting on disk until the reader pressed `r`
 * — which is the keystroke this exists to save.
 *
 * @param {string} [notesFile] Where the notes are, when the pane knows
 * @returns {string|null} null when git could not answer, which is not a change
 */
function fingerprint(repoDir, notesFile, repository) {
  // A directory git has never heard of has no status to take. What it does have is the
  // one file the watch looks at that is not in the repository anyway — where an agent
  // writes its answers — and that is the half of the watch worth keeping here: having
  // just asked is the moment a reader most wants to be told.
  if (repository === false) {
    return createHash("sha1").update(stampAt(notesFile || "", "notes")).digest("hex");
  }

  const status = runGit(repoDir, [
    "status",
    "--porcelain=v1",
    "-z",
    "--untracked-files=all",
  ]);
  if (status.status !== 0) {
    return null;
  }

  // A repository with no commits has no HEAD, and that is a state rather than a
  // failure — the first commit made in another pane has to be noticed too.
  const head = runGit(repoDir, ["rev-parse", "--verify", "--quiet", "HEAD"]);
  const stamps = parseStatus(status.stdout).map((entry) => stampOf(repoDir, entry.path));

  return createHash("sha1")
    .update(head.stdout)
    .update(status.stdout)
    .update(stamps.join("\n"))
    .update(notesFile ? stampAt(notesFile, "notes") : "")
    .digest("hex");
}

/**
 * Whether a tick should be allowed to reload.
 *
 * Two things are worth waiting for. A text field means the reader is halfway through
 * writing a comment or a commit message, and rebuilding the rows under them would
 * take the lines the comment is anchored to out from under it. A picker is a question
 * they have been asked and not yet answered.
 *
 * Nothing is lost by waiting: the fingerprint is not recorded when a tick is skipped,
 * so the change is still there to be found on the tick after the field closes.
 */
function canReload(state) {
  return state.input === null && state.picker === null;
}

module.exports = { WATCH_INTERVAL_MS, canReload, fingerprint };
