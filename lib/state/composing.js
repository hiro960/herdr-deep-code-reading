"use strict";

// Writing things down: a review comment, a commit message, a filter, a query.
//
// All four share one field at the foot of the screen, so they share the editor that
// drives it. What each one does when it is accepted is the only part that differs.

const { addComment, anchorFromRow, anchorFromRows, removeCommentAt } = require("../comments");
const { pastedText } = require("../input");
const { openSheet } = require("./views/sheet");
const { requestCreate } = require("./views/create");
const { requestRename } = require("./views/files");
const { runPickaxe } = require("./views/history");
const { queueAsk } = require("./views/ask");
const { withAuthor } = require("./log");
const { selectedEntry, withFilter } = require("../browse-state");
const { currentFilePath, pathOf } = require("./files");
const { cellOfRow } = require("../view-model");
const { toggleBookmark } = require("../bookmarks");
const {
  INPUT_ASK,
  INPUT_AUTHOR,
  INPUT_COMMENT,
  INPUT_COMMIT,
  INPUT_CREATE,
  INPUT_RENAME,
  INPUT_FILTER,
  INPUT_FIND,
  INPUT_OPEN,
  INPUT_PICKAXE,
  INPUT_SEARCH,
  VIEW_BROWSE,
  VIEW_SEARCH,
} = require("../view-names");
const { pathsOf } = require("./rows");
const { selectedRows, withMatch } = require("./cursor");
const { jumpBack, openHit, openSearch, withPreview, withQuickFind } = require("./views");
const {
  MESSAGE_EMPTY_COMMENT,
  MESSAGE_EMPTY_MESSAGE,
  MESSAGE_NO_COMMENT_HERE,
  MESSAGE_NO_FILE,
  MESSAGE_NO_LINE,
  MESSAGE_NOTHING_TO_BOOKMARK,
  MESSAGE_NOTHING_TO_EDIT,
  MESSAGE_NOTHING_TO_REVEAL,
  clearTransient,
  withMessage,
} = require("./messages");

const FIRST_PRINTABLE_CODE_POINT = 0x20;
const DELETE_CODE_POINT = 0x7f;

// The two fields whose text is prose rather than something to match against
const ACCEPTS_LINE_BREAK = new Set([INPUT_ASK, INPUT_COMMENT, INPUT_COMMIT]);

/** Start composing a comment on the selected run, or on the row under the cursor. */
function startComment(state) {
  const anchor = anchorFromRows(selectedRows(state));
  const file = currentFilePath(state);

  if (anchor === null || file === null) {
    return withMessage(state, MESSAGE_NO_LINE);
  }

  return {
    ...state,
    input: { kind: INPUT_COMMENT, ...anchor, file, text: "" },
    message: null,
    effect: null,
  };
}

/** Start writing a commit message. */
function startCommit(state) {
  return { ...clearTransient(state), input: { kind: INPUT_COMMIT, text: "" } };
}

/** Ask the caller to commit what is staged. */
function commitMessage(state) {
  const message = state.input.text.trim();
  if (message === "") {
    return { ...withMessage(state, MESSAGE_EMPTY_MESSAGE), input: null };
  }
  return { ...state, input: null, effect: { type: "commit", message }, message: null };
}

/**
 * Ask the caller to stage or unstage the selected file.
 * The file panel always points at one and `n`/`p` always move it, so this answers
 * from anywhere in the diff view rather than only with the panel focused.
 */
function requestStage(state) {
  const file = state.files[state.selectedIndex];
  const paths = pathsOf(file);
  if (paths.length === 0) {
    return withMessage(state, MESSAGE_NO_FILE);
  }

  return {
    ...state,
    effect: {
      type: "stage",
      paths,
      label: pathOf(file),
      gitStatus: file.gitStatus || null,
    },
    message: null,
  };
}

/** Commit the comment being composed. */
function commitComment(state) {
  const { input } = state;
  const text = input.text.trim();

  if (text === "") {
    return { ...withMessage(state, MESSAGE_EMPTY_COMMENT), input: null };
  }

  const comment = {
    file: input.file,
    side: input.side,
    start: input.start,
    end: input.end,
    lines: input.lines,
    text,
  };

  const span = input.start === input.end ? "" : ` on ${input.end - input.start + 1} lines`;

  return {
    ...state,
    comments: addComment(state.comments, comment),
    input: null,
    selectionAnchor: null,
    message: `Comment saved${span} (${state.comments.length + 1} total)`,
    effect: null,
  };
}

/**
 * Jump to what was typed into the find field, and remember it.
 *
 * An empty query repeats the last one, which is the reflex an editor's `/` leaves a
 * reader with — and the query outlives the file it was typed in, so `n` in the next
 * file opened goes on looking for the same thing.
 */
function runFind(state, viewport) {
  const typed = state.input.text;
  const query = typed === "" ? state.findQuery || "" : typed;

  return withMatch({ ...state, input: null, findQuery: query }, query, 1, viewport);
}

/**
 * Whether a key should be inserted as text.
 * Named keys arrive as multi-character words, so only a single code point qualifies.
 * Unmapped control characters are rejected: they would otherwise sit in the comment
 * and travel into another pane when the batch is sent.
 */
function isPrintableKey(key) {
  const points = Array.from(key);
  if (points.length !== 1) {
    return false;
  }
  const code = points[0].codePointAt(0);
  return code >= FIRST_PRINTABLE_CODE_POINT && code !== DELETE_CODE_POINT;
}

/**
 * The keys the quick find answers itself, because the list under the field is part
 * of it: the arrows choose without typing into the query, Enter takes what is
 * chosen, and leaving puts back the view it was opened over rather than stranding
 * the reader in a list of every file in the repository.
 *
 * @returns {object|null} null when the key is just text to type
 */
function editQuickFind(state, key, viewport) {
  switch (key) {
    case "escape":
      return jumpBack({ ...state, input: null });
    case "enter":
      return openHit({ ...state, input: null }, viewport);
    case "up":
    case "down": {
      const next = state.cursor + (key === "down" ? 1 : -1);
      return { ...state, cursor: Math.max(0, Math.min(next, state.rows.length - 1)) };
    }
    default:
      return null;
  }
}

/** Type into whichever text field is open. */
function editInput(state, key, viewport) {
  const { input } = state;

  if (input.kind === INPUT_OPEN) {
    const answered = editQuickFind(state, key, viewport);
    if (answered !== null) {
      return answered;
    }
  }

  if (key === "escape") {
    // Leaving the filter restores the full listing rather than freezing it
    if (input.kind === INPUT_FILTER) {
      return {
        ...state,
        input: null,
        browse: withFilter(state.browse, ""),
        message: null,
        effect: null,
      };
    }
    return { ...clearTransient(state), input: null, selectionAnchor: null };
  }
  // A note about code is often a paragraph, and a commit worth explaining is a
  // subject and a body. Enter still accepts, because one line is the common case and
  // changing that would cost every reviewer their reflex; the line break is the thing
  // that needed a key, and Ctrl+D is free while typing.
  //
  // The other three fields are a filter and two queries, which are each one line by
  // nature — a newline in one would be text nothing could match.
  // Text somebody copied from somewhere else, arriving as one key — see lib/input.
  // The fields that take a line break take it as it was written; the three that are
  // one line by nature take the same text with the breaks closed up, because a filter
  // or a query with a newline in it matches nothing, which is not what was pasted for.
  const pasted = pastedText(key);
  if (pasted !== null) {
    const text = ACCEPTS_LINE_BREAK.has(input.kind) ? pasted : pasted.split("\n").join("");
    return { ...state, input: { ...input, text: input.text + text } };
  }
  if (key === "ctrl-d" && ACCEPTS_LINE_BREAK.has(input.kind)) {
    return { ...state, input: { ...input, text: input.text + "\n" } };
  }
  // Whether the repository search is literal or a pattern, decided while typing it.
  // A key rather than a prefix on the query: `^` and `[` are ordinary characters to
  // search for, so no spelling of the query can be reserved to mean "and this one is
  // a pattern". The field says which mode it is in — see lib/render/chrome.js.
  // The pickaxe has the same two readings, and for the same reason: `[` is an
  // ordinary character to look for in a history
  if (key === "ctrl-r" && (input.kind === INPUT_SEARCH || input.kind === INPUT_PICKAXE)) {
    return { ...state, input: { ...input, regex: input.regex !== true } };
  }
  if (key === "enter") {
    if (input.kind === INPUT_FILTER) {
      return { ...clearTransient(state), input: null };
    }
    if (input.kind === INPUT_SEARCH) {
      return openSearch(state, input.text, { regex: input.regex === true });
    }
    if (input.kind === INPUT_FIND) {
      return runFind(state, viewport);
    }
    if (input.kind === INPUT_PICKAXE) {
      return runPickaxe(state, input.text, input.regex === true);
    }
    if (input.kind === INPUT_ASK) {
      return queueAsk(state, input.text);
    }
    if (input.kind === INPUT_AUTHOR) {
      return withAuthor(state, input.text);
    }
    if (input.kind === INPUT_CREATE) {
      return requestCreate(state, input.text);
    }
    if (input.kind === INPUT_RENAME) {
      return requestRename(state, input.text);
    }
    return input.kind === INPUT_COMMIT ? commitMessage(state) : commitComment(state);
  }
  const nextText =
    key === "backspace"
      ? input.text.slice(0, -1)
      : isPrintableKey(key)
        ? input.text + key
        : null;

  if (nextText === null) {
    return state;
  }

  const typed = { ...state, input: { ...input, text: nextText } };

  // The filter narrows the listing as it is typed, so the result is visible at once
  if (input.kind === INPUT_FILTER) {
    return withPreview({ ...typed, browse: withFilter(state.browse, nextText) });
  }
  // So does the quick find, over the whole repository rather than one directory
  if (input.kind === INPUT_OPEN) {
    return withQuickFind(typed, nextText);
  }

  return typed;
}

/** Index of the comment anchored to the row under the cursor, or -1. */
function commentIndexAtCursor(state) {
  const anchor = anchorFromRow(state.rows[state.cursor]);
  const file = currentFilePath(state);
  if (anchor === null || file === null) {
    return -1;
  }
  // A comment on a range answers from any line of it, which is the only way `x`
  // can reach a comment the reader wrote over several lines at once.
  return state.comments.findIndex(
    (comment) =>
      comment.file === file &&
      comment.side === anchor.side &&
      comment.start <= anchor.start &&
      anchor.start <= comment.end
  );
}

/** Remove the comment covering the line under the cursor, if there is one. */
function deleteCommentAtCursor(state) {
  const index = commentIndexAtCursor(state);
  if (index === -1) {
    return withMessage(state, MESSAGE_NO_COMMENT_HERE);
  }
  return {
    ...state,
    comments: removeCommentAt(state.comments, index),
    message: "Comment deleted",
    effect: null,
  };
}

/**
 * What the view in front of the reader is about, as a repository-relative path.
 *
 * Each view points at something on disk: the browser at the entry under its
 * selection, a list at the place under its cursor, the reader at the file it has
 * open, the diff at the file the panel names. Asking each of them in turn is what
 * lets one key mean "show me this" everywhere.
 *
 * @returns {string|null} null when the view points at nothing that exists
 */
function pathInView(state) {
  if (state.view === VIEW_BROWSE) {
    const entry = selectedEntry(state.browse);
    return entry === null ? state.browse.dir : entry.path;
  }
  if (state.view === VIEW_SEARCH) {
    const row = state.rows[state.cursor];
    return row !== undefined && row.kind === "hit" ? row.hit.path : null;
  }
  return currentFilePath(state);
}

/** Ask the caller to show what the view is about in the desktop's file manager. */
function requestReveal(state) {
  const target = pathInView(state);
  if (target === null || target === undefined) {
    return withMessage(state, MESSAGE_NOTHING_TO_REVEAL);
  }
  return { ...state, effect: { type: "reveal", path: target }, message: null };
}

/**
 * Ask the caller to open the file in the reader's own editor.
 *
 * Only the reading view offers this. A diff is a view of two versions at once and
 * half its lines are not lines of any file on disk, so there is no line to arrive on
 * — and the file the panel points at is not the one the reader is looking at.
 *
 * The line is the one under the cursor when the cursor is on a line of the file. A
 * note row — an empty file, a binary one — has no number, and the editor is asked
 * for the file itself rather than a line of it.
 */
function requestEdit(state) {
  const filePath = state.openPath;
  if (filePath === null || filePath === undefined) {
    return withMessage(state, MESSAGE_NOTHING_TO_EDIT);
  }

  const cell = cellOfRow(state.rows[state.cursor]);
  const line = cell === null || cell.num === undefined ? null : cell.num;

  return { ...state, effect: { type: "edit", path: filePath, line }, message: null };
}

/**
 * Save the line under the cursor as a place to come back to, or unsave it.
 *
 * One key for both. A list that only grows is a list nobody prunes, and the reader
 * who wants a bookmark gone is standing on it.
 *
 * The line's own text is saved beside its number. Numbers rot as soon as anything
 * above them is edited, and the text is what lets a bookmark still mean something
 * next week — see ../bookmarks.
 */
function toggleBookmarkHere(state) {
  const filePath = state.openPath;
  if (filePath === null || filePath === undefined) {
    return withMessage(state, MESSAGE_NOTHING_TO_BOOKMARK);
  }

  const cell = cellOfRow(state.rows[state.cursor]);
  if (cell === null || cell.num === undefined) {
    return withMessage(state, MESSAGE_NO_LINE);
  }

  // `full` is the whole line; `text` is the piece of it this row draws. A bookmark
  // on the third row of a wrapped line is a bookmark on the line.
  const text = cell.full === undefined ? cell.text : cell.full;
  const { bookmarks, added } = toggleBookmark(state.bookmarks || [], {
    path: filePath,
    line: cell.num,
    text,
  });

  return {
    ...state,
    bookmarks,
    effect: { type: "save-bookmarks" },
    message: `${added ? "Bookmarked" : "Unbookmarked"} ${filePath}:${cell.num} (${bookmarks.length} saved)`,
  };
}

/** Ask the caller to hand the comments to an agent. */
/**
 * Open the batch for reading before it goes.
 *
 * `S` used to send every comment at once, with no way to leave one out and no way to
 * see what was about to be pasted into somebody else's editor. It opens the list
 * instead, with everything chosen, and Enter there sends — one extra keystroke for
 * the common case and a way out of the other one.
 */
function requestSend(state) {
  return openSheet(state, true);
}

/** Choose a target in the agent picker. */
function pickAgent(state, key) {
  // Esc is what the picker's footer offers, and the footer is the whole list of what
  // a view binds. `q` used to cancel here as well and was named nowhere.
  if (key === "escape") {
    return { ...withMessage(state, "Send cancelled"), picker: null };
  }

  const choice = Number(key);
  if (!Number.isInteger(choice) || choice < 1 || choice > state.picker.agents.length) {
    return state;
  }

  return {
    ...state,
    picker: null,
    effect: {
      type: "send-to",
      agent: state.picker.agents[choice - 1],
      batch: state.picker.batch,
    },
    message: null,
  };
}

module.exports = {
  deleteCommentAtCursor,
  editInput,
  pickAgent,
  requestEdit,
  requestReveal,
  requestSend,
  requestStage,
  startComment,
  startCommit,
  toggleBookmarkHere,
};
