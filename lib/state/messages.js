"use strict";

// What the footer says when a key cannot do what it usually does, and the two ways
// of putting one on a state.
//
// The messages live together because several of them are raised from more than one
// place, and a message that reads differently depending on which module refused is a
// message the reader has to learn twice.
//
// The two helpers live with them because every one of those refusals has the same
// second half: no effect. A key that could not do its work has nothing to ask the
// outside world for, and writing that out by hand at fifty call sites is how one of
// them ends up carrying a stale effect into the next frame.
//
// Nothing here depends on anything, which is what lets every module above use them.

const NOTE_NO_CHANGES = "Nothing to show";
const NOTE_FILE_UNCHANGED = "No changes in this file";

const MESSAGE_NO_LINE = "Put the cursor on a diff line first";
const MESSAGE_NO_WORD = "Put the cursor on a name first (w and b step between them)";
const MESSAGE_NO_COMMENTS = "No comments to send";
// Nothing has been asked yet, or nothing has been answered — see lib/notes
const MESSAGE_NO_NOTES = "No notes yet — @ asks an agent about these lines";
// Nothing has been opened yet in this repository — see lib/journal
const MESSAGE_NOTHING_READ = "Nothing read yet — open a file or a commit";
const MESSAGE_NO_COMMENT_HERE = "No comment on this line";
const MESSAGE_EMPTY_COMMENT = "Comment discarded: no text";
const MESSAGE_EMPTY_MESSAGE = "Commit cancelled: no message";
const MESSAGE_NO_FILE = "No file selected";
const MESSAGE_NOTHING_TO_REVEAL = "Nothing here to show in the file manager";
const MESSAGE_NOTHING_TO_EDIT = "No file open to edit";
const MESSAGE_NOTHING_TO_BOOKMARK = "Open a file to bookmark a line in it";
const MESSAGE_NOTHING_TO_TRACE = "Open a file to read its history";
// A graph with nothing in it: an empty repository, or an author nobody matches
const MESSAGE_NO_COMMIT = "No commit here to mark";
const MESSAGE_BLAME_IN_CONTENTS = "Blame reads a file's contents — press Tab first";
// The log is the one screen left with somewhere for the focus to be that has no
// lines under it. The diff view gave its second place up — see lib/state/reducers.
const MESSAGE_COMMENT_IN_DIFF = "Move to the diff pane to comment (Tab)";
const MESSAGE_NO_SPLIT_ROOM = "Not enough width for two columns";
const MESSAGE_NOTHING_TO_FIND = "Nothing to find yet — type something after /";
// A jump that lands above where the reader was looking is hard to read as a jump
const MESSAGE_FIND_WRAPPED_TOP = "Wrapped to the top of the file";
const MESSAGE_FIND_WRAPPED_BOTTOM = "Wrapped to the bottom of the file";

// Five keys ask before they act — quitting with unsent comments, pulling, pushing,
// committing a merge over a file that still holds the markers, and undoing a merge —
// and each arms itself by putting the question in the footer. A prompt lives exactly as long as the
// message that asked it: whatever writes over that message has taken the question off
// the screen, and a question nobody can see must not still be able to be answered.
// The watch is why this is said here rather than left to the next key press — a tick
// reloads and rewrites the footer without anybody pressing anything.
const PROMPTS = {
  pendingQuit: false,
  pendingPull: false,
  pendingPush: false,
  pendingAbort: false,
  pendingCommit: false,
};

/**
 * Say something in the footer, and ask the outside world for nothing.
 * @param {string} message What the footer says
 */
function withMessage(state, message) {
  return { ...state, ...PROMPTS, message, effect: null };
}

/**
 * Drop the message and the effect a previous key left behind.
 * Returns the same state when there is nothing to drop, which is what lets a key
 * that changed nothing be told apart from one that did.
 */
function clearTransient(state) {
  const armed = Object.keys(PROMPTS).some((flag) => state[flag] === true);

  return state.message === null && state.effect === null && !armed
    ? state
    : { ...state, ...PROMPTS, message: null, effect: null };
}

module.exports = {
  MESSAGE_BLAME_IN_CONTENTS,
  MESSAGE_COMMENT_IN_DIFF,
  MESSAGE_EMPTY_COMMENT,
  MESSAGE_NOTHING_TO_BOOKMARK,
  MESSAGE_NOTHING_TO_TRACE,
  MESSAGE_NOTHING_TO_EDIT,
  MESSAGE_EMPTY_MESSAGE,
  MESSAGE_FIND_WRAPPED_BOTTOM,
  MESSAGE_FIND_WRAPPED_TOP,
  MESSAGE_NOTHING_TO_FIND,
  MESSAGE_NO_COMMENT_HERE,
  MESSAGE_NO_COMMENTS,
  MESSAGE_NO_COMMIT,
  MESSAGE_NO_FILE,
  MESSAGE_NO_LINE,
  MESSAGE_NO_NOTES,
  MESSAGE_NO_SPLIT_ROOM,
  MESSAGE_NO_WORD,
  MESSAGE_NOTHING_READ,
  MESSAGE_NOTHING_TO_REVEAL,
  NOTE_FILE_UNCHANGED,
  NOTE_NO_CHANGES,
  clearTransient,
  withMessage,
};
