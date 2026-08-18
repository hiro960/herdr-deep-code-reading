"use strict";

// Searching file contents, as opposed to the browser's filter over file names.
//
// `git grep` does the work: it already knows which files are in the repository and
// which `.gitignore` excludes, and it skips binaries on its own.

const { resolveRepoRoot, runGit } = require("./git");
const { searchFiles } = require("./grep");

const NUL = "\u0000";
const MAX_HITS = 500;
const NO_MATCH_EXIT_CODE = 1;

const NOTE_NO_MATCHES = "No matches";

/**
 * Read `git grep -z -n` output.
 * The NUL separators are what make a path containing a colon safe to read.
 * @returns {Array<{path: string, line: number, text: string}>}
 */
function parseGrepOutput(stdout) {
  if (!stdout) {
    return [];
  }

  const hits = [];

  for (const record of stdout.split("\n")) {
    if (record === "") {
      continue;
    }

    const first = record.indexOf(NUL);
    const second = record.indexOf(NUL, first + 1);
    if (first === -1 || second === -1) {
      continue; // Not a record git produced; skip rather than guess
    }

    const line = Number(record.slice(first + 1, second));
    if (!Number.isInteger(line)) {
      continue;
    }

    hits.push({
      path: record.slice(0, first),
      line,
      text: record.slice(second + 1),
    });
  }

  return hits;
}

/**
 * Search the repository for literal text.
 *
 * @param {string} repoDir Repository root
 * @param {string} query Literal text, unless a pattern was asked for
 * @param {{ignoreCase?: boolean, regex?: boolean}} [options] Case is honoured unless
 *   told otherwise, because `/` searches for what was typed. A name being looked up
 *   is the other case: nobody types the capitals of a symbol they are trying to find.
 *   `regex` reads the query as an extended regular expression instead of literal
 *   text; it is off by default, because a reader searching for `a.js` or `foo(1)`
 *   means those characters rather than a pattern that happens to be spelled with them.
 * @returns {{ok: boolean, hits: Array<object>, total: number, error: string|null}}
 *   total counts what was found before the cap, so a caller can tell a complete
 *   answer from one that stopped at MAX_HITS
 */
function runSearch(repoDir, query, options) {
  const needle = query.trim();
  if (needle === "") {
    return { ok: false, hits: [], total: 0, error: "nothing to search for" };
  }

  // A directory git has never heard of is read rather than grepped — see ./grep, which
  // answers in exactly this shape. Asked here rather than passed down from the state so
  // that all six callers go on saying only what they want found: one `rev-parse` costs
  // nothing beside the search either answer is about to do.
  if (resolveRepoRoot(repoDir) === null) {
    return searchFiles(repoDir, needle, options, MAX_HITS);
  }

  let result;
  try {
    result = runGit(repoDir, [
      "grep",
      "--no-color",
      "-z", // NUL between path, line, and text
      "-n", // line numbers
      "-I", // skip binary files
      // -F reads the query as literal text, -E as an extended regular expression.
      // git rejects an unparseable pattern with a message of its own, which is a
      // better account of what is wrong than anything this could write.
      options && options.regex ? "-E" : "-F",
      ...(options && options.ignoreCase ? ["-i"] : []),
      "--untracked", // the browser lists untracked files, so search them too
      "-e",
      needle,
    ]);
  } catch (error) {
    return { ok: false, hits: [], total: 0, error: error.message };
  }

  // git grep exits 1 when it simply found nothing, which is not a failure
  if (result.status === NO_MATCH_EXIT_CODE) {
    return { ok: true, hits: [], total: 0, error: null };
  }
  if (result.status !== 0) {
    const detail = (result.stderr || "").trim();
    return { ok: false, hits: [], total: 0, error: detail || `exit code ${result.status}` };
  }

  const found = parseGrepOutput(result.stdout);
  return { ok: true, hits: found.slice(0, MAX_HITS), total: found.length, error: null };
}

/** Turn hits into display rows. */
function buildResultRows(hits) {
  if (hits.length === 0) {
    return [{ kind: "note", text: NOTE_NO_MATCHES }];
  }
  return hits.map((hit) => ({ kind: "hit", hit }));
}

module.exports = {
  MAX_HITS,
  buildResultRows,
  parseGrepOutput,
  runSearch,
};
