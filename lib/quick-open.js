"use strict";

// Finding a file, or a definition, by typing part of its name.
//
// The list it produces is the same shape a search result is — path, line, text — so
// it travels through the view, the movement keys and the jump that already exist.
// Everything here is pure; the grep a symbol query needs is the caller's to run.

const { filterByName } = require("./fuzzy");
const { buildOutline } = require("./outline");
const { detectLanguage } = require("./syntax");

// A query for a symbol rather than a path, the way an editor's quick-open marks one
const SYMBOL_PREFIX = "@";
// A grep for one or two characters answers with most of the repository, so the list
// would be noise and the search would not be worth its process
const MIN_SYMBOL_QUERY = 2;
// Enough to scroll through, few enough that the whole listing of a large repository
// is not built into rows on every keystroke. What is left out is reported.
const MAX_RESULTS = 500;

/** Whether a query is asking for a symbol rather than a file. */
function isSymbolQuery(text) {
  return text.startsWith(SYMBOL_PREFIX);
}

/** The part of a symbol query that names the symbol. */
function symbolQuery(text) {
  return text.slice(SYMBOL_PREFIX.length).trim();
}

/** Whether a symbol query is worth the grep it would cost. */
function isSymbolQueryReady(text) {
  return symbolQuery(text).length >= MIN_SYMBOL_QUERY;
}

/**
 * Files whose path matches, best first.
 *
 * The whole path is matched, not just the file name, so `lisv` finds
 * `lib/state/views.js` — the separator counts as a word boundary, which is what
 * makes an abbreviation of the directories work.
 *
 * @param {Array<string>} paths Every repository-relative path
 * @param {string} query What has been typed
 * @returns {{hits: Array<object>, total: number}} total is before the cap
 */
function matchPaths(paths, query) {
  const matched = filterByName(
    paths.map((path) => ({ name: path, path })),
    query.trim()
  );

  return {
    // An empty text is what marks a row as naming a file rather than a line in one.
    // `isFile` says the same thing to the transition that opens it, which has to know:
    // choosing a file by its path is a reader deciding to read it, and that is what the
    // record of the reading is made of — see ../journal.
    hits: matched
      .slice(0, MAX_RESULTS)
      .map((entry) => ({ path: entry.path, line: 1, text: "", isFile: true })),
    total: matched.length,
  };
}

/**
 * The grep hits that declare something whose name contains the query.
 *
 * git grep finds every line the name appears on; the outline patterns say which of
 * them declares it. The same heuristic the outline is built from, asked across the
 * repository instead of down one file.
 *
 * @param {Array<object>} hits What runSearch returned
 * @param {string} query The symbol being looked for
 * @returns {{hits: Array<object>, total: number}}
 */
function matchSymbols(hits, query) {
  const needle = query.trim().toLowerCase();
  const found = [];

  for (const hit of hits) {
    const [entry] = buildOutline([hit.text], detectLanguage(hit.path), hit.path);
    if (entry === undefined || !entry.name.toLowerCase().includes(needle)) {
      continue;
    }
    found.push({ path: hit.path, line: hit.line, text: hit.text, name: entry.name });
  }

  return { hits: found.slice(0, MAX_RESULTS), total: found.length };
}

/**
 * The hits a longer literal query would have found, out of the ones already in hand.
 *
 * `git grep -F` matches literal text, so every line holding "abc" also holds "ab":
 * the answer to a longer query is a subset of the answer to the query it grew out of.
 * Typing forward can be answered from what the last search already found instead of
 * starting another process on every keystroke.
 *
 * The caller has to have checked that the earlier answer was complete — narrowing a
 * list the cap cut short would hide matches that never reached it.
 *
 * @param {Array<object>} hits What an earlier, shorter search returned
 * @param {string} needle The longer query
 */
function narrowedHits(hits, needle) {
  const lowered = needle.toLowerCase();
  return hits.filter((hit) => hit.text.toLowerCase().includes(lowered));
}

/**
 * Whether a cached search can answer for a query without running another.
 *
 * Two conditions, both necessary: the new query has to contain the old one, so its
 * answer is a subset of what is already held, and the old answer has to be everything
 * there was rather than the first capful of it.
 *
 * @param {{needle: string, hits: Array<object>, complete: boolean}|null} cached
 */
function canNarrow(cached, needle) {
  if (cached === null || cached === undefined || !cached.complete) {
    return false;
  }
  return needle.toLowerCase().includes(cached.needle.toLowerCase());
}

/**
 * What the header calls the list, including what the cap left out.
 * A count that silently stops at the cap reads as "that is all there is".
 */
function quickOpenTitle(query, total, shown) {
  const kind = isSymbolQuery(query) ? "symbol" : "file";
  const count = total > shown ? `${shown} of ${total}` : String(total);
  const what = query === "" ? "every file" : `${kind}: ${query}`;
  return `${what}  (${count})`;
}

module.exports = {
  MIN_SYMBOL_QUERY,
  canNarrow,
  isSymbolQuery,
  isSymbolQueryReady,
  matchPaths,
  matchSymbols,
  narrowedHits,
  quickOpenTitle,
  symbolQuery,
};
