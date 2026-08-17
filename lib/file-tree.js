"use strict";

// A directory tree derived from a flat list of repository-relative file paths.
//
// The list comes from git, so `.git` and everything `.gitignore` covers are already
// absent and no filesystem walk is needed. A directory exists here only because a
// file inside it does, which is what git tracks anyway.

const SEPARATOR = "/";

function compareNames(a, b) {
  return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
}

/**
 * The entries directly inside a directory.
 * @param {Array<string>} paths Every repository-relative file path
 * @param {string} dir Repository-relative directory, "" for the root
 * @returns {Array<{name: string, path: string, isDirectory: boolean}>}
 *   Directories first, each group sorted by name
 */
function listDirectory(paths, dir) {
  const prefix = dir === "" ? "" : dir + SEPARATOR;
  const directories = new Set();
  const files = [];

  for (const filePath of paths) {
    if (!filePath.startsWith(prefix)) {
      continue;
    }

    const rest = filePath.slice(prefix.length);
    const slash = rest.indexOf(SEPARATOR);

    if (slash === -1) {
      files.push({ name: rest, path: filePath, isDirectory: false });
      continue;
    }

    directories.add(rest.slice(0, slash));
  }

  const directoryEntries = [...directories]
    .map((name) => ({ name, path: prefix + name, isDirectory: true }))
    .sort(compareNames);

  return [...directoryEntries, ...files.sort(compareNames)];
}

/** The parent of a directory. The root is its own parent. */
function parentOf(dir) {
  const slash = dir.lastIndexOf(SEPARATOR);
  if (slash === -1) {
    return "";
  }
  return dir.slice(0, slash);
}

module.exports = { listDirectory, parentOf };
