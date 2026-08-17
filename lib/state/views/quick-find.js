"use strict";

// The quick find: one field that opens a file by part of its path, or a definition by
// `@name`.
//
// Paths are matched in memory on every keystroke, which is free. A symbol needs a
// grep, so the grep is asked for once and narrowed as the query grows — typing forward
// only ever narrows an answer, and a process per keystroke is a noticeable stutter on
// a repository large enough that finding a symbol in it was the point.

const {
  MIN_SYMBOL_QUERY,
  canNarrow,
  isSymbolQuery,
  isSymbolQueryReady,
  matchPaths,
  matchSymbols,
  narrowedHits,
  quickOpenTitle,
  symbolQuery,
} = require("../../quick-open");
const { buildResultRows, runSearch } = require("../../search");
const { INPUT_OPEN } = require("../../view-names");
const { withRepoPaths } = require("../rows");
const { openList } = require("./lists");

/**
 * Open the quick find, listing every file in the repository.
 *
 * One push onto the history, here and not on every keystroke: the list is replaced
 * as the query is typed, and a history of half-typed queries would flush the places
 * the reader actually wants back.
 */
function openQuickFind(state) {
  const loaded = withRepoPaths(state);
  // The cached grep says what the repository held while the last quick find was open.
  // How long the reader spent away since is not something this can know, so a new
  // session starts by asking git again.
  const opened = openList({ ...loaded, symbolSearch: null }, "", [], []);

  return {
    ...withQuickFind(opened, ""),
    input: { kind: INPUT_OPEN, text: "" },
  };
}

/** An empty list with something to say instead of results. */
function quickFindNote(state, query, text) {
  return {
    ...state,
    listTitle: quickOpenTitle(query, 0, 0),
    hits: [],
    rows: [{ kind: "note", text }],
    cursor: 0,
    scroll: 0,
  };
}

/**
 * The grep lines a symbol query needs, from the last search where that is possible.
 *
 * Typing forward into a query only ever narrows its answer, so the previous search
 * already holds every line the longer one would find — as long as it held all of them
 * rather than the first capful.
 *
 * @returns {{ok: true, hits: Array<object>, complete: boolean}|{ok: false, error: string}}
 */
function symbolLines(state, needle) {
  if (canNarrow(state.symbolSearch, needle)) {
    return { ok: true, hits: narrowedHits(state.symbolSearch.hits, needle), complete: true };
  }

  const result = runSearch(state.repoDir, needle, { ignoreCase: true });
  if (!result.ok) {
    return { ok: false, error: result.error };
  }
  return { ok: true, hits: result.hits, complete: result.hits.length === result.total };
}

/**
 * Re-run the quick find for what has been typed so far.
 *
 * Paths are matched in memory on every keystroke, which is free. A symbol needs a
 * grep, so it waits until the query is long enough to be worth one — and says so
 * rather than showing an empty list. Past that, the grep is asked once and narrowed
 * as the query grows: a process per keystroke is a noticeable stutter on a repository
 * large enough that finding a symbol in it was the point.
 */
function withQuickFind(state, query) {
  if (!isSymbolQuery(query)) {
    const { hits, total } = matchPaths(state.repoPaths || [], query);
    return showQuickFind(state, query, hits, total);
  }

  if (!isSymbolQueryReady(query)) {
    return quickFindNote(
      state,
      query,
      `Type at least ${MIN_SYMBOL_QUERY} characters to find a symbol`
    );
  }

  const needle = symbolQuery(query);
  const lines = symbolLines(state, needle);
  if (!lines.ok) {
    return quickFindNote(state, query, `Could not look for ${needle}: ${lines.error}`);
  }

  const searched = {
    ...state,
    symbolSearch: { needle, hits: lines.hits, complete: lines.complete },
  };
  const { hits, total } = matchSymbols(lines.hits, needle);
  return showQuickFind(searched, query, hits, total);
}

/** Put a set of quick find results on screen, keeping the cursor on a real one. */
function showQuickFind(state, query, hits, total) {
  const rows = buildResultRows(hits);

  return {
    ...state,
    listTitle: quickOpenTitle(query, total, hits.length),
    hits,
    rows,
    cursor: Math.max(0, rows.findIndex((row) => row.kind === "hit")),
    scroll: 0,
  };
}

module.exports = {
  openQuickFind,
  withQuickFind,
};
