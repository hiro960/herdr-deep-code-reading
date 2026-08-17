"use strict";

// Asking an agent about the code under the cursor.
//
// `S` is the plugin's one existing message and it goes one way: here is my review,
// do something about it. This is the other direction, and on unfamiliar code it is
// the one that matters more. What does this do. When is this branch taken. Why is it
// written like this. The agent in the next pane has the whole repository open and is
// very good at exactly that question.
//
// What is pasted is three things: the lines being asked about, the question, and the
// exact command to answer with. The command is spelled out in full — every path
// absolute, nothing discovered — because the agent's shell is not a plugin process
// and has none of HERDR_PLUGIN_STATE_DIR. An answer written with it lands in the
// notes file, the watch notices, and it appears beside the line it is about.

const path = require("node:path");

const {
  KIND_QUESTION,
  addComment,
  anchorFromRow,
  anchorFromRows,
  describeEntries,
} = require("../../comments");
const { INPUT_ASK } = require("../../view-names");
const { clearTransient, withMessage } = require("../messages");
const { hasSelection, selectedRows } = require("../cursor");
const { currentFilePath } = require("../files");

const MESSAGE_NOTHING_TO_ASK = "Nothing under the cursor to ask about";

/** Where bin/note.js lives, whichever directory the pane was started from. */
function noteCommandPath() {
  return path.join(__dirname, "..", "..", "..", "bin", "note.js");
}

const QUOTE = "'";
// How a single quote is written inside single quotes: close, an escaped one, reopen.
const ESCAPED_QUOTE = "'\\''";

/**
 * One word of the reply command, as a shell will read it back.
 *
 * The command is written to be run, so every value in it is a string on somebody's
 * command line — and one of them is a path out of the repository under review, which
 * is a name its author chose. JSON quoting is not shell quoting: it escapes a double
 * quote and leaves `$(...)` and a backtick exactly as they were, both of which are
 * live inside the double quotes it produces. A file named `$(curl …|sh).js` would have
 * run on the reader's machine the moment the agent did as it was asked.
 *
 * Single quotes are the answer because nothing at all is special inside them. A quote
 * in the value is the one thing that cannot be written there, so it is closed, escaped
 * outside the quoting, and reopened — which is what a shell itself does.
 */
function shellQuote(value) {
  return QUOTE + String(value).split(QUOTE).join(ESCAPED_QUOTE) + QUOTE;
}

/** The lines the question is about, and where they are. */
function askAnchor(state) {
  const file = currentFilePath(state);
  if (file === null || file === undefined) {
    return null;
  }

  const anchor = hasSelection(state)
    ? anchorFromRows(selectedRows(state))
    : anchorFromRow(state.rows[state.cursor]);

  return anchor === null ? null : { ...anchor, file };
}

/**
 * The command an agent answers one question with.
 *
 * Spelled out in full — every path absolute, nothing discovered — because the agent's
 * shell is not a plugin process and has none of HERDR_PLUGIN_STATE_DIR. The answer
 * itself needs no quoting, which is the part of a shell command a language model gets
 * wrong most often, and a `-` in its place takes a longer answer on stdin.
 */
function replyCommand(state, anchor) {
  return [
    "node",
    shellQuote(noteCommandPath()),
    "--store",
    shellQuote(state.notesFile),
    "--repo",
    shellQuote(state.repoDir),
    "--file",
    shellQuote(anchor.file),
    "--line",
    String(anchor.start),
    "--from",
    "you",
    "<your answer, or - to pipe a longer one in>",
  ].join(" ");
}

/** Open the field the question is typed into. */
function openAsk(state) {
  if (askAnchor(state) === null) {
    return withMessage(state, MESSAGE_NOTHING_TO_ASK);
  }
  return { ...clearTransient(state), input: { kind: INPUT_ASK, text: "" } };
}

/**
 * Put the question on the list of things to send.
 *
 * It used to go out the moment it was typed, and that is the wrong shape for the
 * reading it exists for. A reader works down a file with five things in it they do not
 * understand, and stopping to send each one is five round trips through somebody else's
 * pane before the page is finished. They go on the list `S` sends — the same list the
 * comments are on, because a question is a comment with a different thing asked of it —
 * and go out together, once, when the reader has finished looking.
 */
function queueAsk(state, question) {
  const anchor = askAnchor(state);
  if (anchor === null) {
    return { ...withMessage(state, MESSAGE_NOTHING_TO_ASK), input: null };
  }
  if (question.trim() === "") {
    return { ...clearTransient(state), input: null };
  }

  const kept = addComment(state.comments, {
    kind: KIND_QUESTION,
    file: anchor.file,
    side: anchor.side,
    start: anchor.start,
    end: anchor.end,
    lines: anchor.lines,
    text: question.trim(),
    // Built here, where the store and the repository are known, rather than by whatever
    // formats the batch: lib/comments knows about lines and text and nothing at all
    // about where this pane keeps its state.
    reply: replyCommand(state, anchor),
  });

  return {
    ...clearTransient(state),
    input: null,
    selectionAnchor: null,
    comments: kept,
    message: `Question saved (${describeEntries(kept)} to send)`,
  };
}

module.exports = {
  askAnchor,
  noteCommandPath,
  openAsk,
  queueAsk,
  replyCommand,
  shellQuote,
};
