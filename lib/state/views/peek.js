"use strict";

// Reading a definition without going to it.
//
// Enter follows the name under the cursor, and that is the right key for "I am going
// to read this now". It is the wrong one for "what is this", which is the question a
// reader asks ten times a page — because following it costs the place they were
// reading, and Ctrl+O is a way back rather than a way not to have left.
//
// `K` is vim's key for the same idea and this is the same idea: show me what this is,
// where I am. The definition is put on the screen in place of the body and the next
// key takes it away again. Nothing is pushed onto the history, the cursor does not
// move, and there is nothing to come back from.

const { SIDE_OLD, anchorFromRow } = require("../../comments");
const { readFileLines } = require("../../file-view");
const { FALLBACK_COLUMNS } = require("../../layout");
const { wordAt } = require("../../line-cursor");
const { notesAt } = require("../../notes");
const { definesName } = require("../../outline");
const { runSearch } = require("../../search");
const { detectLanguage } = require("../../syntax");
const { prepareLine } = require("../../text");
const { wrapSegments } = require("../../wrap");
const { cursorLineText } = require("../cursor");
const { currentFilePath } = require("../files");
const { MESSAGE_NO_WORD, clearTransient, withMessage } = require("../messages");

// How much of the definition to show. Enough for a signature and the first few lines
// of a body, which is what tells a reader what something is; more than that and they
// wanted to go there after all, which is the other key.
const PEEK_LINES = 12;

// What a peeked note is wrapped to: the pane's width, less the gutter and the two
// columns a message row indents by — see lib/render/diff-rows.renderDiffBody.
const NOTE_MARGIN = 6;
const MIN_NOTE_WIDTH = 20;

/** The lines around a definition, numbered as the file numbers them. */
function linesAround(repoDir, filePath, line) {
  const result = readFileLines(repoDir, filePath);
  if (!result.ok) {
    return null;
  }

  const from = Math.max(0, line - 1);
  return result.lines.slice(from, from + PEEK_LINES).map((text, index) => ({
    kind: "line",
    cell: { num: from + index + 1, text: prepareLine(text), type: "context" },
  }));
}

/**
 * The notes the cursor is on, wherever the cursor happens to be.
 *
 * Two kinds of row can carry one. A line of a file or a diff carries the notes written
 * against that line, found the way the gutter finds them — the new side only, because
 * whatever wrote a note was looking at the file rather than at a diff of it. A row of
 * the note list carries its own, which is what lets `K` read out a note from the list
 * of them without going to the line first.
 *
 * @returns {Array<object>} Empty where there is no note to read
 */
function notesUnderCursor(state) {
  const row = state.rows[state.cursor];

  if (row !== undefined && row.kind === "hit" && row.hit.note !== undefined) {
    return [row.hit.note];
  }

  const anchor = anchorFromRow(row);
  const file = currentFilePath(state);
  if (anchor === null || file === null || file === undefined || anchor.side === SIDE_OLD) {
    return [];
  }

  return notesAt(state.notes || [], file, anchor.start);
}

/**
 * Read a note out, in place of the body.
 *
 * Wrapped here rather than left to the frame, because the rows a peek is built from are
 * the message kind and a message is one row long by nature. An agent writing a
 * paragraph without a line break in it would otherwise have four thousand characters
 * cut to the width of the pane.
 */
function noteRows(notes, columns) {
  const width = Math.max(MIN_NOTE_WIDTH, (columns || FALLBACK_COLUMNS) - NOTE_MARGIN);

  return notes.flatMap((note) => [
    { kind: "note", text: `— ${note.from || "agent"}` },
    ...note.text
      .split("\n")
      .flatMap((line) =>
        wrapSegments(line, width).map((segment) => ({
          kind: "note",
          text: line.slice(segment.from, segment.to),
        }))
      ),
  ]);
}

/** Show what was answered about this line. */
function peekNotes(state, notes) {
  const [first] = notes;
  const more = notes.length === 1 ? "" : `  (${notes.length})`;

  return {
    ...clearTransient(state),
    peek: {
      title: `${first.path}:${first.line}${more}`,
      rows: noteRows(notes, state.columns),
    },
  };
}

/**
 * Show what is on this line: what somebody answered about it, or what the name under
 * the cursor is.
 *
 * The note comes first where there is one. `◆` in the gutter says somebody has already
 * answered a question about this line, and what a reader wants when they ask about a
 * line carrying that is the answer — the definition is what `Enter` goes to and what
 * this shows when there is nothing newer to say.
 */
function peekHere(state) {
  const notes = notesUnderCursor(state);
  return notes.length === 0 ? peekDefinition(state) : peekNotes(state, notes);
}

/**
 * Show what the name under the cursor is.
 *
 * The same search `Enter` follows, stopped one step earlier. Where that jumps to the
 * one definition it found, this reads it out; where it opens a list of several, this
 * says how many there are and shows the first, because a glance is a glance.
 */
function peekDefinition(state) {
  const text = cursorLineText(state);
  const word = text === null ? null : wordAt(text, state.column || 0);

  if (word === null) {
    return withMessage(state, MESSAGE_NO_WORD);
  }

  const result = runSearch(state.repoDir, word.text);
  if (!result.ok) {
    return withMessage(state, `Could not look for ${word.text}: ${result.error}`);
  }

  const definitions = result.hits.filter((hit) =>
    definesName(hit.text, word.text, detectLanguage(hit.path))
  );
  if (definitions.length === 0) {
    return withMessage(state, `No definition found for ${word.text}`);
  }

  const [first] = definitions;
  const rows = linesAround(state.repoDir, first.path, first.line);
  if (rows === null) {
    return withMessage(state, `Could not read ${first.path}`);
  }

  const more = definitions.length === 1 ? "" : `  (1 of ${definitions.length})`;
  return {
    ...clearTransient(state),
    peek: { title: `${first.path}:${first.line}${more}`, rows },
  };
}

/**
 * Put the definition away.
 * Any key at all, because a glance is over the moment the reader has had it and
 * making them learn a second key to close a thing they opened by accident is unkind.
 */
function closePeek(state) {
  return state.peek === null || state.peek === undefined ? state : { ...state, peek: null };
}

module.exports = { PEEK_LINES, closePeek, peekDefinition, peekHere };
