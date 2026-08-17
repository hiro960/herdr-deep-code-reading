"use strict";

// Looking for text across the repository, and following a name to where it is
// declared. Both end the same way — a file open at a line, with the cursor on it —
// so the jump they share lives here too.

const { rowOfLine } = require("../../file-view");
const { pushPlace } = require("../../jump-history");
const { wordAt } = require("../../line-cursor");
const { definesName } = require("../../outline");
const { buildResultRows, runSearch } = require("../../search");
const { detectLanguage } = require("../../syntax");
const { VIEW_SEARCH } = require("../../view-names");
const { READ_CONTENT } = require("../rows");
const { cursorLineText, jumpToCursor } = require("../cursor");
const { MESSAGE_NO_WORD, withMessage } = require("../messages");
const { openList } = require("./lists");
const { openForReading } = require("./reading");

/**
 * Run a content search and show its hits.
 *
 * @param {{regex?: boolean}} [options] Whether the query is a pattern. The choice is
 *   recorded on the state as well as obeyed: a reader who has switched to patterns is
 *   rarely done after one search, so the next `/` opens in the mode they chose.
 */
function openSearch(state, query, options) {
  const regex = options !== undefined && options.regex === true;
  const result = runSearch(state.repoDir, query, { regex });

  if (!result.ok) {
    return { ...withMessage(state, `Search failed: ${result.error}`), input: null, searchRegex: regex };
  }

  return {
    ...state,
    history: pushPlace(state.history, state),
    input: null,
    view: VIEW_SEARCH,
    listTitle: null,
    searchQuery: query,
    searchRegex: regex,
    hits: result.hits,
    rows: buildResultRows(result.hits),
    scroll: 0,
    cursor: 0,
    message: null,
    effect: null,
  };
}

/**
 * Open a file at one of its lines.
 *
 * A hit's line number counts the lines of the file, not the rows of a diff, so the
 * file opens on its contents however the contents/diff toggle was left. Landing that
 * number in a diff's rows would put the cursor on an unrelated line.
 *
 * The column follows the name when the hit carries one, so a jump to a definition
 * arrives with the definition under the cursor and the next jump ready.
 */
function jumpToHit(state, hit, viewport) {
  const opened = openForReading({ ...state, readMode: READ_CONTENT }, hit.path);
  const placed = jumpToCursor(opened, Math.max(0, rowOfLine(opened.rows, hit.line)), viewport);

  if (!hit.name) {
    return placed;
  }
  return { ...placed, column: columnOfName(cursorLineText(placed), hit.name) };
}

/** Where a name starts on a line, or the start of the line when it is not there. */
function columnOfName(text, name) {
  if (text === null) {
    return 0;
  }
  const at = text.indexOf(name);
  return at === -1 ? 0 : at;
}

/**
 * Follow the identifier under the cursor to where it is defined.
 *
 * git grep finds every line that mentions the name; the definition patterns pick out
 * the one that declares it. One answer is a jump, several are a list, and none falls
 * back to showing every mention — which is what the reader wanted to know anyway, and
 * is more use than being told the search failed.
 */
function followDefinition(state, viewport) {
  const text = cursorLineText(state);
  const word = text === null ? null : wordAt(text, state.column || 0);

  if (word === null) {
    return withMessage(state, MESSAGE_NO_WORD);
  }

  const result = runSearch(state.repoDir, word.text);
  if (!result.ok) {
    return withMessage(state, `Could not look for ${word.text}: ${result.error}`);
  }
  if (result.hits.length === 0) {
    return withMessage(state, `Nothing found for ${word.text}`);
  }

  const named = (hits) => hits.map((hit) => ({ ...hit, name: word.text }));
  const definitions = result.hits.filter((hit) =>
    definesName(hit.text, word.text, detectLanguage(hit.path))
  );

  if (definitions.length === 1) {
    return jumpToHit(state, { ...definitions[0], name: word.text }, viewport);
  }
  if (definitions.length > 1) {
    const hits = named(definitions);
    return openList(state, `definition: ${word.text}  (${hits.length})`, buildResultRows(hits), hits);
  }

  const hits = named(result.hits);
  return openList(state, `references: ${word.text}  (${hits.length})`, buildResultRows(hits), hits);
}

module.exports = {
  followDefinition,
  jumpToHit,
  openSearch,
};
