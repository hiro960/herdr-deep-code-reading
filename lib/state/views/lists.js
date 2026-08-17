"use strict";

// A list of places, and the two lists built from the open file's own text.
//
// An outline, a set of imports, a search's hits, a file's commits, a shelf of
// bookmarks — to a reader they are one thing: somewhere to look, and a key that goes
// there. They share the view, the movement keys and the jump, and differ only in what
// the header calls them. `openList` is where they all end, and it is the one function
// here the other view modules reach for. It calls none of them back, which is what
// keeps this module at the bottom of the pile.

const { readFileLines } = require("../../file-view");
const { buildResultRows, runSearch } = require("../../search");
const {
  buildImports,
  buildOutline,
  definesName,
  hasOutline,
  looksLikeImport,
  namesModule,
} = require("../../outline");
const { pushPlace } = require("../../jump-history");
const { detectLanguage } = require("../../syntax");
const { VIEW_SEARCH } = require("../../view-names");
const { wordAt } = require("../../line-cursor");
const { journalHits } = require("../../journal");
const { noteHits } = require("../../notes");
const { cursorLineText } = require("../cursor");
const {
  MESSAGE_NOTHING_READ,
  MESSAGE_NO_NOTES,
  MESSAGE_NO_WORD,
  withMessage,
} = require("../messages");

/**
 * Show a list of places, in the view a search already uses.
 *
 * An outline, a list of imports, and a set of search results are the same thing to a
 * reader: somewhere to look, and a key that goes there. They share the view, the
 * movement keys, and the jump, and differ only in what the header calls them.
 *
 * @param {string} title What the header names the list
 * @param {Array<object>} rows Display rows; the hits among them are jumpable
 */
function openList(state, title, rows, hits) {
  return {
    ...state,
    history: pushPlace(state.history, state),
    view: VIEW_SEARCH,
    listTitle: title,
    hits,
    rows,
    scroll: 0,
    // Open on the first place worth jumping to, past any group heading above it
    cursor: Math.max(0, rows.findIndex((row) => row.kind === "hit")),
    message: null,
    effect: null,
  };
}

/** The definitions the open file declares. */
function openOutline(state) {
  const filePath = state.openPath;
  const result = readFileLines(state.repoDir, filePath);

  if (!result.ok) {
    return withMessage(state, result.reason);
  }

  // Two different empty answers, said apart. A language with no patterns has an empty
  // outline whatever is in the file, and "no definitions found" is a fact about the
  // file that is not true of it — a reader told there is nothing here stops looking,
  // where one told the language is not covered reaches for `/` instead.
  const language = detectLanguage(filePath);
  if (!hasOutline(language)) {
    return withMessage(state, `No outline for ${filePath}: this language has no patterns here yet`);
  }

  const found = buildOutline(result.lines, language, filePath);
  if (found.length === 0) {
    return withMessage(state, `No definitions found in ${filePath}`);
  }

  return openList(state, `outline: ${filePath}  (${found.length})`, buildResultRows(found), found);
}

/** Strip the extension, which is how a specifier usually names a file. */
function moduleStem(filePath) {
  const name = filePath.split("/").pop() || filePath;
  const dot = name.lastIndexOf(".");
  return dot <= 0 ? name : name.slice(0, dot);
}

/**
 * What the open file reaches for, and what reaches for it.
 *
 * Reading a codebase is largely deciding what to read next, and the answer is
 * usually on one of these two lists. The first comes from the file's own lines; the
 * second is a grep for its name, kept down to the lines that look like imports.
 */
function openImports(state) {
  const filePath = state.openPath;
  const result = readFileLines(state.repoDir, filePath);

  if (!result.ok) {
    return withMessage(state, result.reason);
  }

  const imports = buildImports(result.lines, filePath);
  const stem = moduleStem(filePath);
  const search = runSearch(state.repoDir, stem);
  if (!search.ok) {
    return withMessage(state, `Could not look for importers: ${search.error}`);
  }

  // The grep is a substring search, so it also finds the stem inside longer words —
  // `review` lives in `withPreview`. Two questions, then: does the line import
  // something, and is the thing it imports this file.
  const importers = search.hits.filter(
    (hit) => hit.path !== filePath && looksLikeImport(hit.text) && namesModule(hit.text, stem)
  );

  const rows = [
    { kind: "note", text: `imports (${imports.length})` },
    ...buildResultRows(imports).filter((row) => row.kind === "hit"),
    { kind: "note", text: `imported by (${importers.length})` },
    ...buildResultRows(importers).filter((row) => row.kind === "hit"),
  ];

  const hits = [...imports, ...importers];
  return openList(state, `imports: ${filePath}  (${hits.length})`, rows, hits);
}

/**
 * Every note there is, in one list.
 *
 * The gutter has marked a noted line since notes existed, and marking is all it did:
 * the text went to the store and no key put it in front of anybody. This is the list
 * of them — where each one is, what it says, and who said it — and it is the same list
 * a search fills, because to a reader they are the same thing.
 *
 * It answers from every view. A note is about the repository rather than about
 * whichever screen the reader happens to be on when they want to read them back.
 */
function openNotes(state) {
  const notes = state.notes || [];
  if (notes.length === 0) {
    return withMessage(state, MESSAGE_NO_NOTES);
  }

  const hits = noteHits(notes);
  return openList(state, `notes  (${notes.length})`, buildResultRows(hits), hits);
}

/**
 * Where the name under the cursor is used.
 *
 * `Enter` goes to the one line that declares a name; this is every other line that
 * mentions it. A plain search answers with both, and the definition is one row in the
 * middle of a hundred calls — which is the list a reader wanted when they asked the
 * question the other way round.
 *
 * The same grep and the same patterns the definition jump uses, with the test inverted:
 * `git grep` finds every mention, and `definesName` is what separates the one that
 * declares it from the hundred that do not. An import is left in — reaching for a name
 * is a use of it, and `i` is the key that lists imports as imports.
 */
function openReferences(state) {
  const text = cursorLineText(state);
  const word = text === null ? null : wordAt(text, state.column || 0);

  if (word === null) {
    return withMessage(state, MESSAGE_NO_WORD);
  }

  const result = runSearch(state.repoDir, word.text);
  if (!result.ok) {
    return withMessage(state, `Could not look for ${word.text}: ${result.error}`);
  }

  const uses = result.hits.filter(
    (hit) => !definesName(hit.text, word.text, detectLanguage(hit.path))
  );
  if (uses.length === 0) {
    return withMessage(state, `Nothing uses ${word.text}`);
  }

  return openList(state, `uses of ${word.text}  (${uses.length})`, buildResultRows(uses), uses);
}

/**
 * Where the reading has been, oldest first.
 *
 * The files opened and the commits opened, in the order they were, kept across panes —
 * see lib/journal. Enter goes back to one, which is what makes it a list of places
 * rather than a log: yesterday's reading is where today's usually starts.
 */
function openJournal(state) {
  const entries = state.journal || [];
  if (entries.length === 0) {
    return withMessage(state, MESSAGE_NOTHING_READ);
  }

  const hits = journalHits(entries);
  return openList(state, `reading  (${entries.length})`, buildResultRows(hits), hits);
}

/**
 * Every key this view binds, one to a row.
 *
 * The footer is the only place a key is advertised and it has four rows at most, so a
 * narrow terminal can leave the last of them unnamed. This is where the whole list
 * lives when it does not fit — the same list, from the same string, read down a
 * column instead of across a footer.
 */
function openKeys(state, help) {
  const rows = help
    .split("  ")
    .filter((item) => item !== "")
    .map((item) => ({ kind: "note", text: item }));

  return openList(state, `keys  (${rows.length})`, rows, []);
}

module.exports = {
  openJournal,
  openReferences,
  openKeys,
  openImports,
  openList,
  openNotes,
  openOutline,
};
