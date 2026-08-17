"use strict";

// Every comment written so far, in one list.
//
// Two things were missing and they turn out to be the same thing. The header counted
// the comments and nothing said where they were, so finding the ten you had written
// meant scrolling every file looking for the mark in the gutter — the bookmarks have
// had a list since the beginning and the comments never did. And `S` sent all of them
// at once, with no way to leave one out and no way to read the batch before it went.
//
// One list answers both. `"` opens it to look through: Enter goes to the comment,
// `x` takes it away. `S` opens the same list with everything chosen and Enter as the
// key that sends — a confirmation rather than a second decision, which keeps the
// common path at one extra keystroke.

const { describeEntries, formatBatch, isQuestion } = require("../../comments");
const { VIEW_COMMENTS } = require("../../view-names");
const { pushPlace } = require("../../jump-history");
const { MESSAGE_NO_COMMENTS, clearTransient, withMessage } = require("../messages");

// What a row's first two columns say about the comment on it. Only a sending list
// draws them: in a list opened to look through, nothing is being chosen.
const CHOSEN_MARK = "[x]";
const UNCHOSEN_MARK = "[ ]";

// What marks a question out from a comment on a list holding both. The list is what a
// reader checks before sending, and "this one is a question" is the thing about an
// entry that decides what the agent will do with it.
const QUESTION_MARK = "?";

/** Where a comment points, said the way the rest of the plugin says it. */
function commentLocation(comment) {
  const range = comment.start === comment.end ? comment.start : `${comment.start}-${comment.end}`;
  const kind = isQuestion(comment) ? `${QUESTION_MARK} ` : "";
  return `${kind}${comment.file}:${range}`;
}

/** The first line of a comment, which is what a list has room for. */
function commentSummary(comment) {
  const [first] = comment.text.split("\n");
  return first;
}

/**
 * The rows of the list, one per comment.
 *
 * Built as hits so that the movement keys, the scrolling and the drawing are the ones
 * every other list already has — see lib/render/diff-rows.renderHitRow.
 */
function sheetRows(comments, sending, excluded) {
  return comments.map((comment, index) => {
    const chosen = sending ? `${excluded.includes(index) ? UNCHOSEN_MARK : CHOSEN_MARK} ` : "";

    return {
      kind: "hit",
      hit: {
        // A comment on a purely removed line is numbered in a version the file no
        // longer has, so Enter lands near it rather than on it — the same
        // approximation `H` and the blame column already make.
        path: comment.file,
        line: comment.start,
        label: `${chosen}${commentLocation(comment)}`,
        text: commentSummary(comment),
        isComment: true,
        index,
      },
    };
  });
}

/** The list's own title, which says which of the two jobs it is doing. */
function sheetTitle(comments, sending, excluded) {
  if (!sending) {
    return `${describeEntries(comments)}  (${comments.length})`;
  }

  const chosen = comments.length - excluded.length;
  return `send  (${chosen} of ${describeEntries(comments)})`;
}

/** Put the list on screen, keeping the place the reader came from. */
function showSheet(state, sending, excluded, pushed) {
  const rows = sheetRows(state.comments, sending, excluded);

  return {
    ...clearTransient(state),
    history: pushed === undefined ? state.history : pushed,
    view: VIEW_COMMENTS,
    sheet: { sending, excluded },
    listTitle: sheetTitle(state.comments, sending, excluded),
    hits: rows.map((row) => row.hit),
    rows,
    scroll: 0,
    cursor: 0,
  };
}

/**
 * Open the list.
 *
 * @param {boolean} sending Whether Enter sends rather than going to the comment
 */
function openSheet(state, sending) {
  if (state.comments.length === 0) {
    return withMessage(state, MESSAGE_NO_COMMENTS);
  }
  return showSheet(state, sending === true, [], pushPlace(state.history, state));
}

/** Leave a comment out of the batch, or put it back. */
function toggleChosen(state) {
  if (state.sheet === null || state.sheet === undefined || !state.sheet.sending) {
    return state;
  }

  const row = state.rows[state.cursor];
  if (row === undefined || row.kind !== "hit") {
    return state;
  }

  const { index } = row.hit;
  const excluded = state.sheet.excluded.includes(index)
    ? state.sheet.excluded.filter((at) => at !== index)
    : [...state.sheet.excluded, index];

  return { ...showSheet(state, true, excluded), cursor: state.cursor, scroll: state.scroll };
}

/**
 * Take a comment away, from the one place the reader can see what they are removing.
 *
 * `x` in the diff deletes the comment under the cursor, which means deleting a
 * paragraph you wrote from a screen showing one line of it. Here the whole list is in
 * front of you.
 */
function deleteFromSheet(state) {
  const row = state.rows[state.cursor];
  if (row === undefined || row.kind !== "hit") {
    return state;
  }

  const { index } = row.hit;
  const comments = state.comments.filter((_, at) => at !== index);

  if (comments.length === 0) {
    return { ...withMessage(state, "Comment deleted — none left"), comments, sheet: null };
  }

  // Every index below the gap moves up by one, so the exclusions are renumbered
  // rather than left pointing at their neighbours
  const excluded = state.sheet.excluded
    .filter((at) => at !== index)
    .map((at) => (at > index ? at - 1 : at));
  const shown = showSheet({ ...state, comments }, state.sheet.sending, excluded);

  return {
    ...shown,
    cursor: Math.min(state.cursor, Math.max(0, shown.rows.length - 1)),
    message: "Comment deleted",
  };
}

/** The comments the reader has left in the batch. */
function chosenComments(state) {
  const excluded = state.sheet === null || state.sheet === undefined ? [] : state.sheet.excluded;
  return state.comments.filter((_, index) => !excluded.includes(index));
}

/**
 * Send what is chosen.
 *
 * The batch travels on the effect rather than being read off the state again, because
 * what is being sent is a decision the reader has just made and the state goes on
 * holding every comment — they are kept after a send, and always have been.
 */
function confirmSend(state) {
  const comments = chosenComments(state);
  if (comments.length === 0) {
    return withMessage(state, "Nothing chosen to send");
  }

  return {
    ...clearTransient(state),
    sheet: null,
    // A question is answered into the notes file rather than into the repository, so
    // the watch is what brings the answer back — and the moment of having just asked is
    // the one where the reader most wants to be told. A batch of comments alone leaves
    // the watch exactly as the reader had it.
    watching: state.watching === true || comments.some(isQuestion),
    effect: { type: "send", comments },
    message: null,
  };
}

/** What the batch will look like, for a test to read without spawning anything. */
function sheetPreview(state) {
  return formatBatch(chosenComments(state));
}

module.exports = {
  CHOSEN_MARK,
  UNCHOSEN_MARK,
  confirmSend,
  deleteFromSheet,
  openSheet,
  sheetPreview,
  toggleChosen,
};
