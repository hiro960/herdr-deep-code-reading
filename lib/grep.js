"use strict";

// Searching a directory git has never heard of.
//
// `git grep` answers for a repository: it knows which files are worth reading, skips
// the binary ones, and is written in C. A plain directory has nobody to ask, so the
// files are walked and read here instead — see ./walk for what the walk covers.
//
// The answer wears exactly the shape git's does, so that following a name, listing its
// uses, the imports list, the quick find and the browser's own search all go on working
// without knowing which of the two answered them. `total` counts everything found and
// `hits` is capped, because a caller can only tell a complete answer from a stopped one
// if the count is of what was there rather than of what was handed back.

const fs = require("node:fs");
const path = require("node:path");

const { walkFiles } = require("./walk");

// The same two guards the reader applies to a file it is about to draw: anything past
// them is not text somebody wrote, and a search through it would answer with noise.
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const NUL_BYTE = 0;
const BINARY_SNIFF_BYTES = 8192;

/** Whether the first few bytes of a file look like text. */
function looksLikeText(buffer) {
  const end = Math.min(buffer.length, BINARY_SNIFF_BYTES);
  for (let at = 0; at < end; at += 1) {
    if (buffer[at] === NUL_BYTE) {
      return false;
    }
  }
  return true;
}

/** One file's lines, or null where it is not one to search. */
function textLinesOf(fullPath) {
  let stats;
  try {
    stats = fs.statSync(fullPath);
  } catch {
    return null; // Gone between the walk and here, which is not a failure of the search
  }
  if (!stats.isFile() || stats.size > MAX_FILE_BYTES) {
    return null;
  }

  try {
    const buffer = fs.readFileSync(fullPath);
    return looksLikeText(buffer) ? buffer.toString("utf8").split("\n") : null;
  } catch {
    return null;
  }
}

/**
 * What a query matches a line by.
 *
 * A pattern is read by JavaScript rather than by git, which reads an extended regular
 * expression — they agree on everything a reader is likely to type and part company at
 * the edges, `\d` among them. Saying so beats pretending the two are one language.
 *
 * @returns {{ok: true, matches: function}|{ok: false, error: string}}
 */
function matcherFor(needle, options) {
  const ignoreCase = options && options.ignoreCase === true;

  if (options && options.regex === true) {
    try {
      const pattern = new RegExp(needle, ignoreCase ? "i" : "");
      return { ok: true, matches: (line) => pattern.test(line) };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  }

  if (!ignoreCase) {
    return { ok: true, matches: (line) => line.includes(needle) };
  }
  const lowered = needle.toLowerCase();
  return { ok: true, matches: (line) => line.toLowerCase().includes(lowered) };
}

/** Whether a path is a directory this process can list. */
function isReadableDirectory(root) {
  try {
    return fs.statSync(root).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Search every file under a directory for text.
 *
 * @param {string} root The directory being read
 * @param {string} query Literal text, unless a pattern was asked for
 * @param {{ignoreCase?: boolean, regex?: boolean}} [options] As runSearch's
 * @param {number} cap How many hits to hand back; everything found is still counted
 * @returns {{ok: boolean, hits: Array<object>, total: number, error: string|null}}
 */
function searchFiles(root, query, options, cap) {
  const needle = (query || "").trim();
  if (needle === "") {
    return { ok: false, hits: [], total: 0, error: "nothing to search for" };
  }

  const matcher = matcherFor(needle, options);
  if (!matcher.ok) {
    return { ok: false, hits: [], total: 0, error: matcher.error };
  }

  // A directory that is not there is not a search with no matches: nothing was looked
  // at, and saying "nothing found" would be an answer about files nobody read.
  if (!isReadableDirectory(root)) {
    return { ok: false, hits: [], total: 0, error: `cannot read ${root}` };
  }

  const limit = cap === undefined ? Infinity : cap;
  const hits = [];
  let total = 0;

  for (const relative of walkFiles(root).paths) {
    const lines = textLinesOf(path.join(root, relative));
    if (lines === null) {
      continue;
    }

    lines.forEach((text, index) => {
      if (!matcher.matches(text)) {
        return;
      }
      total += 1;
      if (hits.length < limit) {
        hits.push({ path: relative, line: index + 1, text });
      }
    });
  }

  return { ok: true, hits, total, error: null };
}

module.exports = { searchFiles };
