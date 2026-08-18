"use strict";

// Listing a directory git knows nothing about.
//
// The browser, the quick find and the file tree are all built from one flat list of
// paths relative to the root. For a repository git hands that list over: `ls-files`
// covers tracked and untracked files and already leaves out `.git` and everything
// `.gitignore` names. A plain directory has nobody to ask, so it is walked.
//
// The rules are the fewest a reader can hold in their head, because a listing that
// guesses is worse than one that shows what is there:
//
//   - `.git` is never source, at any depth. Nothing else is skipped by name — a
//     directory really does contain its build output, and a walk that quietly decided
//     otherwise would be answering a question nobody asked. A tree with a large
//     `node_modules` in it will meet the cap below and be told so.
//   - A symlink to a directory is not followed. Following one either loops for ever
//     or leaves the root without saying so, and neither is a listing.
//   - The walk stops at a ceiling and reports that it stopped. A silent cap reads as
//     coverage, which is the one thing a listing must not claim falsely.

const fs = require("node:fs");
const path = require("node:path");

// Directories that are never the thing being read.
const SKIPPED_DIRECTORIES = new Set([".git"]);

// How many files a listing may hold. Well past any source tree worth reading in a
// pane, and short of the point where the tree and the fuzzy match stop being instant.
const MAX_WALKED_FILES = 20000;

const SEPARATOR = "/";

/** One directory's entries, or nothing where it cannot be read. */
function entriesOf(directory) {
  try {
    return fs.readdirSync(directory, { withFileTypes: true });
  } catch {
    // A directory that vanished mid-walk, or one this process may not read. Neither is
    // a reason to refuse the whole listing: what was reachable is still worth showing.
    return [];
  }
}

/** Whether a link leads to a file, rather than to a directory or to nothing. */
function pointsAtFile(directory, name) {
  try {
    return fs.statSync(path.join(directory, name)).isFile();
  } catch {
    return false; // A broken link leads nowhere, so there is nothing to list
  }
}

/**
 * Every file under a directory, relative to it.
 *
 * Breadth is walked with an explicit stack rather than by recursion: a deep tree is a
 * thing somebody else made, and a stack overflow is not an answer.
 *
 * @param {string} root Absolute path to the directory being read
 * @returns {{paths: Array<string>, truncated: boolean}} Sorted, root-relative, and
 *   whether the walk stopped at the ceiling before it ran out of files
 */
function walkFiles(root) {
  const paths = [];
  const pending = [""];
  let truncated = false;

  while (pending.length > 0 && !truncated) {
    const relative = pending.pop();
    const absolute = relative === "" ? root : path.join(root, relative);

    for (const entry of entriesOf(absolute)) {
      const name = relative === "" ? entry.name : relative + SEPARATOR + entry.name;

      if (entry.isDirectory()) {
        if (!SKIPPED_DIRECTORIES.has(entry.name)) {
          pending.push(name);
        }
        continue;
      }

      // readdir reports a link as itself rather than as what it points at, so a link
      // has to be asked. One to a file is listed: it reads as that file, which is what
      // the reader opened it for. One to a directory is left out altogether — not
      // walked, for the reason above, and not listed either, because a row that opens
      // as a file and turns out to be a directory is a row that lies.
      if (entry.isSymbolicLink() && !pointsAtFile(absolute, entry.name)) {
        continue;
      }

      paths.push(name);
      if (paths.length >= MAX_WALKED_FILES) {
        truncated = true;
        break;
      }
    }
  }

  return { paths: paths.sort(), truncated };
}

module.exports = { MAX_WALKED_FILES, SKIPPED_DIRECTORIES, walkFiles };
