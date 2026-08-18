"use strict";

// A key press to the next state.
//
// One reducer per view, each answering null for a key that is not its own, and a
// dispatch that asks the right one. The reducers never call each other: anything two
// of them both need is a transition in ./views.

const { DEFAULT_MODE } = require("../entrypoints");
const { describeEntries } = require("../comments");
const {
  INPUT_FILTER,
  INPUT_FIND,
  INPUT_SEARCH,
  VIEW_BROWSE,
  VIEW_CONFLICTS,
  VIEW_LOG,
  VIEW_READ,
  VIEW_COMMENTS,
  VIEW_SEARCH,
} = require("../view-names");
const { ascend, descend } = require("../browse-state");
const {
  hasSelection,
  moveColumnBy,
  moveCursorBy,
  moveWordBy,
  toggleSelection,
  withMatch,
  withSelection,
  wordUnderCursor,
} = require("./cursor");
const {
  followDefinition,
  jumpBack,
  leaveForBrowser,
  moveBrowseBy,
  openBrowser,
  openChosenFile,
  openDiff,
  openHit,
  openImports,
  openOutline,
  openBookmarks,
  openFileHistory,
  openQuickFind,
  openWorkingTree,
  reloaded,
  reloadedInPlace,
  toggleBlame,
  toggleDiffLayout,
  toggleReadMode,
  withPreview,
} = require("./views");
const {
  chooseInLog,
  cursorIsLive,
  cycleLogFocus,
  moveLog,
  openAuthorFilter,
  openLog,
  paneHeight,
  reloadLog,
  requestFetch,
  requestPull,
  requestPush,
  toggleCommitRead,
  toggleFirstParent,
  toggleLogScope,
} = require("./log");
const {
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
} = require("./composing");
const { MESSAGE_COMMENT_IN_DIFF, clearTransient, withMessage } = require("./messages");
const {
  narrowContext,
  toggleFileViewed,
  toggleIgnoreWhitespace,
  widenContext,
} = require("./diff-view");
const {
  confirmSend,
  deleteFromSheet,
  openSheet,
  toggleChosen,
} = require("./views/sheet");
const { OURS, THEIRS } = require("../merge");
const {
  moveToConflict,
  openConflicts,
  refreshConflicts,
  requestAbort,
  requestEditConflict,
  requestMergeCommit,
  requestResolved,
  requestTake,
} = require("./views/conflicts");
const { startCreate } = require("./views/create");
const { openBlamedCommit, openPickaxe } = require("./views/history");
const { openAsk } = require("./views/ask");
const { openBeside } = require("./views/pane");
const { openJournal, openKeys, openNotes, openReferences } = require("./views/lists");
const { closePeek, peekHere } = require("./views/peek");
const { helpText } = require("../screen-model");

const HALF_PAGE_DIVISOR = 2;
// The key that asks for a pull, named because two places need it: the log's own table,
// and the disarming below — which has to know which key is the second press of a pair
// rather than a key that came after one.
const PULL_KEY = "p";
// And the one that asks for a push, which is the same key with shift held: the two
// directions of one word. It is the only key in the pane that means something other
// than what it means everywhere else, so it is named here beside the reason.
const PUSH_KEY = "P";
// The way home to the working tree. `R` would have been the obvious letter and is
// already how a name's uses are listed, so this is the diff's own initial: D for the
// diff every other one is a departure from.
const WORKING_TREE_KEY = "D";

// The key that ends the pane. Shifted, because unshifted it was the easiest key on the
// board to press by accident — one tap, no question where there was nothing unsent, and
// a session's reading gone. `q` is left doing nothing at all rather than given a new
// job: a key that quit yesterday must not quietly do something else today.
const QUIT_KEY = "Q";

// Every key that asks before it acts, and the flag its question is remembered by. Four
// of them now, and they all disarm the same way, so the rule is written once as a table
// rather than four times as a function. Quitting is not here: `q` and Ctrl+C both arm
// it and both are answered above this, before any of it runs.
const PROMPT_KEYS = {
  pendingPull: PULL_KEY,
  pendingPush: PUSH_KEY,
  pendingAbort: "!",
  pendingCommit: "C",
};
// Longer than any list can be, so "jump to the end" is the same clamped move as
// every other one rather than a second code path that has to know the list's length.
const JUMP_DELTA = Number.MAX_SAFE_INTEGER;

/**
 * The movement keys every list-shaped view shares.
 *
 * The views differ only in what movement means — the diff view moves the file
 * selection when the panel has focus, the others always move the cursor — so that one
 * step is a parameter and the rest is written once. Every key routes through it,
 * paging and jumping included: the panel's footer offers `d/u` and `g/G` as ways
 * through the file list, so they have to move whatever j/k moves.
 *
 * @param {function} onVertical (state, delta, viewport) for every movement key
 * @returns {object|null} null when the key is not a movement key
 */
function reduceMovement(state, key, viewport, onVertical) {
  const halfPage = Math.max(1, Math.floor(viewport / HALF_PAGE_DIVISOR));

  switch (key) {
    case "j":
    case "down":
      return onVertical(state, 1, viewport);
    case "k":
    case "up":
      return onVertical(state, -1, viewport);
    case "d":
    case "ctrl-d":
    case "pagedown":
      return onVertical(state, halfPage, viewport);
    case "u":
    case "ctrl-u":
    case "pageup":
      return onVertical(state, -halfPage, viewport);
    case "g":
    case "home":
      return onVertical(state, -JUMP_DELTA, viewport);
    case "G":
    case "end":
      return onVertical(state, JUMP_DELTA, viewport);
    default:
      return null;
  }
}

/**
 * Turn the watch on or off.
 *
 * A pane-wide setting rather than a view's key, so it is answered in dispatch beside
 * the other three. The timer itself lives in bin/review.js, which is told to start or
 * stop by the effect; nothing here measures time.
 */
function toggleWatch(state, viewport) {
  const watching = state.watching !== true;
  if (!watching) {
    return { ...state, watching, effect: { type: "watch" }, message: "Watch off" };
  }

  // Turning it on is a reader saying "keep me up to date", and the first thing that
  // means is catching up. The watch arms itself with a fingerprint of the world as it
  // already is, so anything written while it was off — an agent's answer, most of all,
  // which lands in a file rather than in the repository — would otherwise stay
  // invisible until something unrelated changed. The reading view has no `r` to ask
  // again with, so there was no second way to see it either.
  //
  // Said as "watching" rather than as a reload: nothing the reader did changed the
  // repository, and a reload they did not ask for is not news.
  return {
    ...reloadedInPlace(state, "Watching — the pane reloads when the repository changes", viewport),
    watching,
    effect: { type: "watch" },
  };
}

/**
 * An empty search field, opened in whichever mode the last search was run in.
 * Two views offer `/`, and both have to remember the choice — a toggle that reset
 * itself every time the field closed would have to be pressed for every search.
 */
function searchField(state) {
  return { kind: INPUT_SEARCH, text: "", regex: state.searchRegex === true };
}

/** Keys of the file browser. Null when the key is not ours. */
function reduceBrowse(state, key, viewport) {
  switch (key) {
    case "l":
    case "right":
    case "enter": {
      const result = descend(state.browse, state.repoPaths);
      if (result.openPath !== null) {
        return openChosenFile(state, result.openPath);
      }
      return withPreview({ ...clearTransient(state), browse: result.browse });
    }
    case "h":
    case "left":
    case "escape":
      return withPreview({ ...clearTransient(state), browse: ascend(state.browse, state.repoPaths) });
    case "f":
      return { ...clearTransient(state), input: { kind: INPUT_FILTER, text: "" } };
    case "a":
      // yazi's key for the same thing, in the screen it was borrowed from: name a file
      // and it exists. Empty — what goes in it is `E`'s business, and the editor's.
      return startCreate(state);
    case "/":
      // A separate command from the filter: this one looks inside the files
      return { ...clearTransient(state), input: searchField(state) };
    case "tab":
      return toggleReadMode(state);
    case "e":
      return openDiff(state);
    case "S":
      return requestSend(state);
    default:
      // What moves here is the browser's own selection rather than a row cursor, but
      // that is the only difference, so it goes through the same table as every other
      // list. moveBrowse clamps, which is what lets "jump to the end" arrive as the
      // same oversized delta the other views send.
      return reduceMovement(state, key, viewport, moveBrowseBy);
  }
}

/**
 * Keys of the reading view.
 *
 * Movement always moves the cursor here: borrowing the diff view's focus-following
 * movement would change which file is selected and rebuild the rows from that file's
 * diff, leaving one file's lines on screen under another file's name.
 */
function reduceRead(state, key, viewport) {
  switch (key) {
    case "escape":
      // Leaving a file and going back are the same thing here: the file was opened
      // from somewhere, and that somewhere is what the reader wants next.
      return leaveForBrowser(state);
    case "h":
    case "left":
      // h keeps its old meaning from the one place it is usually pressed. At the
      // start of a line there is nothing to its left but the way out, and further
      // in it is the column key the rest of the line needs.
      return (state.column || 0) > 0 ? moveColumnBy(state, -1) : leaveForBrowser(state);
    case "tab":
      return toggleReadMode(state);
    case "/":
      // The same key the browser uses to look through the repository, pointed at the
      // one file in front of the reader — which is what it means in an editor, and
      // what a reader who has already opened the file is asking for
      return { ...clearTransient(state), input: { kind: INPUT_FIND, text: "" } };
    case "n":
      return withMatch(state, state.findQuery, 1, viewport);
    case "N":
      return withMatch(state, state.findQuery, -1, viewport);
    case "o":
      return openOutline(state);
    case "i":
      return openImports(state);
    case "e":
      return openDiff(state);
    case "m":
      // yazi's key for the same idea, pointed at a line rather than a directory
      return toggleBookmarkHere(state);
    case "B":
      // Every line's last change at once, where H gives one line's whole history
      return toggleBlame(state);
    case "H":
      // This file's commits, or — with a run marked — those of the marked lines.
      // Only the reading view can ask: it is the only one holding a whole file.
      return openFileHistory(state);
    case "C":
      // The commit the blame column names for this line. `H` asks what has happened to
      // the file; this asks about the one line the reader has a finger on, and the
      // footer offers it only while the column that answers is on screen.
      return openBlamedCommit(state);
    case "E":
      // The reader's own editor, the way yazi opens a file: the pane steps aside and
      // gives it the screen. Only here — a diff has lines belonging to no file.
      return requestEdit(state);
    case "]":
      // The next of the file's conflicts. Only a file a merge could not settle has
      // any, and in one that has none these say so — see lib/state/views/conflicts.
      return moveToConflict(state, 1, viewport);
    case "[":
      return moveToConflict(state, -1, viewport);
    default:
      return (
        reduceColumn(state, key, viewport) ||
        reduceMovement(state, key, viewport, moveCursorBy) ||
        reduceComments(state, key)
      );
  }
}

/**
 * Keys of the conflict list. Null when the key is not ours.
 *
 * The one view where a key does more to the repository than a `git add`, so the two
 * that cannot be taken back ask first: `C`, when a file still holds the markers git
 * wrote, and `!`, always. The rest are one file each and each is undone by choosing
 * again, which is what makes them single keystrokes.
 */
function reduceConflicts(state, key, viewport) {
  switch (key) {
    case "l":
    case "right":
    case "enter":
      // A conflict row is a place: the file, at the line its first conflict opens on
      return openHit(state, viewport);
    case "h":
    case "left":
    case "escape":
      return jumpBack(state);
    case "o":
      return requestTake(state, OURS);
    case "t":
      return requestTake(state, THEIRS);
    case " ":
      // The file has been edited by hand and is finished. The same key that stages a
      // file in the diff view, and the same `git add` underneath it.
      return requestResolved(state);
    case "E":
      return requestEditConflict(state);
    case "C":
      return requestMergeCommit(state);
    case "!":
      return requestAbort(state);
    case "r":
      return refreshConflicts(state);
    default:
      return reduceMovement(state, key, viewport, moveCursorBy);
  }
}

/** Keys of the search results list. Null when the key is not ours. */
function reduceSearch(state, key, viewport) {
  switch (key) {
    case "l":
    case "right":
    case "enter":
      return openHit(state, viewport);
    case "h":
    case "left":
    case "escape":
      return leaveForBrowser(state);
    case "/":
      return { ...clearTransient(state), input: searchField(state) };
    case "e":
      return openDiff(state);
    case "S":
      return requestSend(state);
    default:
      return reduceMovement(state, key, viewport, moveCursorBy);
  }
}

/**
 * Keys of the log screen. Null when the key is not ours.
 *
 * Four panes share one set of movement keys, and which pane they move is the focus's
 * business rather than this table's — see ./log. What Enter means is the focus's
 * business too: a branch narrows the graph, a commit opens in the whole pane.
 */
function reduceLog(state, key, viewport) {
  switch (key) {
    case "tab":
      return cycleLogFocus(state, 1);
    case "l":
    case "right":
    case "enter":
      return chooseInLog(state);
    case "h":
    case "left":
    case "escape":
      return jumpBack(state);
    case "a":
      return toggleLogScope(state);
    case "f":
      // Beside `a` because it is the same question asked the other way: that one is
      // how many branches, this is how much of one
      return toggleFirstParent(state);
    case "A":
      // And this is the third of them: whose
      return openAuthorFilter(state);
    case "V":
      // The same key the diff view marks a file with, asking it of the commit — which
      // is the size a reader working through somebody's week counts in
      return toggleCommitRead(state);
    case "r":
      return reloadLog(state, viewport);
    case "F":
      // What `r` cannot answer. That one reads this repository again; this one asks the
      // remote, which is the only way the ↓ beside a branch can become true again.
      return requestFetch(state);
    case PULL_KEY:
      // And the only key here that changes the files the reader is looking at, which is
      // one of the two reasons a key here asks first
      return requestPull(state);
    case PUSH_KEY:
      // The other: this one changes what other people read. `p` and `P` are one word in
      // its two directions, which is what makes the pair learnable — and is why this is
      // the one key in the pane that means something else on this screen than it does
      // everywhere else. The log's footer names it, and nothing leaves until it has been
      // pressed twice.
      return requestPush(state);
    case "e":
      return openDiff(state);
    case "S":
      return requestSend(state);
    default:
      return (
        // The pane's own height rather than the body's: half a page of a graph is half
        // of the graph, not half of the screen it shares with the diff
        reduceMovement(state, key, paneHeight(state, viewport), moveLog) ||
        // A comment is written on a line of the diff under the graph, which is the one
        // pane here that has lines. The other three answer with the same message the
        // diff view's file panel does.
        reduceComments(state, key)
      );
  }
}

/**
 * Moving along a line, and following the name it lands on.
 *
 * The row cursor says which line; these say which word of it, which is the question
 * a jump to a definition needs answered. Null when the key is not ours.
 */
function reduceColumn(state, key, viewport) {
  switch (key) {
    case "h":
    case "left":
      return moveColumnBy(state, -1);
    case "l":
    case "right":
      return moveColumnBy(state, 1);
    case "w":
      return moveWordBy(state, 1);
    case "b":
      return moveWordBy(state, -1);
    case "enter":
      return followDefinition(state, viewport);
    case "R":
      // The other half of the same question. That one goes to where the name is
      // declared; this lists everywhere it is not.
      return openReferences(state);
    default:
      return null;
  }
}

/**
 * The comment list. Null when the key is not ours.
 *
 * Enter is the one key that means two things here, and it means the one the list was
 * opened for: sending, when `S` opened it, and going to the comment when `\"` did.
 * Nothing else changes between the two.
 */
function reduceSheet(state, key, viewport) {
  switch (key) {
    case "escape":
    case "h":
      return jumpBack(state);
    case "enter":
    case "l":
      return state.sheet.sending ? confirmSend(state) : openHit(state, viewport);
    case " ":
      return toggleChosen(state);
    case "x":
      return deleteFromSheet(state);
    case "S":
      // From a list opened to look through, this is how it becomes one to send from
      return state.sheet.sending ? confirmSend(state) : openSheet(state, true);
    default:
      return reduceMovement(state, key, viewport, moveCursorBy);
  }
}

/**
 * Moving around the diff: the file list and the cursor. Null when the key is not ours.
 *
 * The two used to share j/k, with Tab deciding which of them the keys moved. It was
 * the one thing about this pane nobody could work out from looking at it: the same
 * key did two things and the screen barely said which. So they have a set each now.
 * j/k move the cursor down the lines, always, in every view that has lines; n/p move
 * the file list, always, which is what they always did. Nothing is modal and the
 * column keys are live wherever the cursor is.
 */
function reduceNavigation(state, key, viewport) {
  switch (key) {
    case "n":
      return withSelection(state, state.selectedIndex + 1);
    case "p":
      return withSelection(state, state.selectedIndex - 1);
    case "t":
      return toggleDiffLayout(state);
    default:
      return (
        reduceColumn(state, key, viewport) ||
        reduceMovement(state, key, viewport, moveCursorBy)
      );
  }
}

/**
 * Writing, deleting, and sending review comments. Null when the key is not ours.
 *
 * The three cursor keys need a visible cursor, which everywhere but the log now
 * means they are always live. Sending is not about a line and works from anywhere.
 */
const CURSOR_COMMENT_KEYS = new Set(["v", "c", "x"]);

function reduceComments(state, key) {
  if (key === "S") {
    return requestSend(state);
  }
  if (!CURSOR_COMMENT_KEYS.has(key)) {
    return null;
  }
  // The log is the one screen with somewhere for the focus to be that has no lines
  // under it: four panes, and only one of them a diff — see ./log
  if (!cursorIsLive(state)) {
    return withMessage(state, MESSAGE_COMMENT_IN_DIFF);
  }

  switch (key) {
    case "v":
      return toggleSelection(state);
    case "c":
      return startComment(state);
    default:
      return deleteCommentAtCursor(state);
  }
}

/**
 * Staging, committing, and reloading. Null when the key is not ours.
 *
 * Staging is driven by `git status`, which only lines up with the review mode's file
 * list, so the other modes withhold those keys — and their footer says so. A key the
 * footer does not offer must not quietly change the repository behind it.
 */
function reduceGit(state, key) {
  if (key === "r") {
    return reloaded(state);
  }
  // How the diff was computed is a question about the diff rather than about the
  // repository behind it, so these three answer in every mode — a commit from last
  // year is as worth widening as this morning's working tree.
  if (key === "+") {
    return widenContext(state);
  }
  if (key === "-") {
    return narrowContext(state);
  }
  if (key === "=") {
    return toggleIgnoreWhitespace(state);
  }
  // Whether this file has been read through is a note about the reader rather than
  // about the repository, so it answers in every mode the way the three above do
  if (key === "V") {
    return toggleFileViewed(state);
  }
  if (state.mode !== DEFAULT_MODE) {
    return null;
  }

  switch (key) {
    case " ":
      return requestStage(state);
    case "A":
      return { ...state, effect: { type: "stage-all" }, message: null };
    case "C":
      return startCommit(state);
    default:
      return null;
  }
}

/**
 * Quit, or ask first.
 *
 * Comments live for the session, so quitting with unsent ones throws away work that
 * took the whole session to write. One repeat of the same key is enough of a guard:
 * it costs a keystroke and cannot be dismissed by accident, because any other key
 * disarms it.
 */
function requestQuit(state) {
  if (state.comments.length === 0 || state.pendingQuit) {
    return { ...state, quit: true };
  }

  return {
    ...state,
    pendingQuit: true,
    message: `Unsent: ${describeEntries(state.comments)} — press again to discard, S to send`,
    effect: null,
  };
}

/** Any key that is not the quit key takes the quit prompt back off. */
function disarmQuit(state) {
  return state.pendingQuit ? { ...state, pendingQuit: false } : state;
}

/**
 * The same for every prompt in PROMPT_KEYS: any key but a second one of its own takes
 * the question back off.
 *
 * A key typed into an open field disarms it too. The answer to "press again" is the
 * next key rather than the next key of that name, and a `p` written into a comment is
 * the reader spelling a word, not agreeing to anything.
 */
function disarmPrompts(state, key) {
  let next = state;

  for (const [flag, armedBy] of Object.entries(PROMPT_KEYS)) {
    if (state[flag] !== true) {
      continue;
    }
    const answered = key === armedBy && state.input === null && state.picker === null;
    if (!answered) {
      next = { ...next, [flag]: false };
    }
  }

  return next;
}

/**
 * Forget a selection whose rows are gone.
 *
 * The selection is a pair of indexes into the row list, so any transition that
 * rebuilds that list leaves it pointing at lines nobody chose. Catching it once,
 * on the row list's identity, covers every such transition — including the ones
 * written after this.
 */
function dropStaleSelection(previous, next) {
  if (!hasSelection(next) || next.rows === previous.rows) {
    return next;
  }
  return { ...next, selectionAnchor: null };
}

// Which view owns which table of keys. The diff view is not here on purpose: it is
// what a pane shows when it is showing none of these, so it answers below rather than
// by name — which is also what leaves `e` somewhere to mean "the files of this diff".
const BY_VIEW = {
  [VIEW_BROWSE]: reduceBrowse,
  [VIEW_COMMENTS]: reduceSheet,
  [VIEW_CONFLICTS]: reduceConflicts,
  [VIEW_LOG]: reduceLog,
  [VIEW_READ]: reduceRead,
  [VIEW_SEARCH]: reduceSearch,
};

/**
 * Pure reducer from a key press to the next state.
 *
 * An open text field or picker takes every key before the normal bindings apply, and
 * quitting comes before both. Everything else is the view's own business.
 *
 * @param {object} state The current state
 * @param {string} key A key name from lib/input
 * @param {number} viewport Body rows, for the keys that page by a screenful
 * @returns {object} The next state; may be the same reference when nothing changed
 */
function reduce(state, key, viewport) {
  // Answered before anything else, so that every path below is one where an armed
  // question has already been agreed to or taken back off
  const held = disarmPrompts(state, key);

  // Ctrl+C quits from anywhere, a half-written comment and an open picker included.
  // The pane is in raw mode, so no SIGINT arrives to do it instead, and this is the
  // key a reader reaches for when nothing else answers. `Q` cannot join it up here:
  // it has to stay typeable in a comment.
  if (key === "ctrl-c") {
    return requestQuit(held);
  }
  if (held.input !== null) {
    return editInput(disarmQuit(held), key, viewport);
  }
  if (held.picker !== null) {
    return pickAgent(disarmQuit(held), key);
  }
  if (key === QUIT_KEY) {
    return requestQuit(held);
  }

  // Esc is this pane's "put the thing in front of me away": it cancels a field, closes
  // a picker, leaves a list. A glance is a thing in front of the reader, so Esc is spent
  // closing it rather than also meaning what it means underneath — which in the reading
  // view is leaving the file the glance was taken in. Reaching for the obvious key to
  // dismiss a peek should not cost the place the peek was taken from.
  if (key === "escape" && held.peek !== null && held.peek !== undefined) {
    return closePeek(disarmQuit(held));
  }

  // A glance is over the moment the reader has had it, so every other key puts it away
  // and then does whatever it was going to do
  const armed = closePeek(disarmQuit(held));
  return dropStaleSelection(armed, dispatch(armed, key, viewport));
}

// The keys that read a history rather than a file. A directory git has never heard of
// has no history to read, and the footer says so by not naming them — but they are
// still bound, so pressing one out of habit is answered rather than ignored. `P`, `/`
// and the rest are not here: finding a file and searching one are about what is on
// disk, and this pane can do both without git.
const REPOSITORY_KEYS = new Set(["e", "tab", "D", "L", "#", "H", "B", "M"]);
const MESSAGE_NO_REPOSITORY = "No repository here — that key reads a history";

/** Hand the key to whichever view owns it. */
function dispatch(state, key, viewport) {
  if (state.repository === false && REPOSITORY_KEYS.has(key)) {
    return withMessage(state, MESSAGE_NO_REPOSITORY);
  }

  // Going back is not a view's own key: every view can be jumped away from, so
  // every view has to be able to give the reader the previous one.
  if (key === "ctrl-o") {
    return jumpBack(state);
  }
  // Finding a file is not one screen's business either, so it is answered here
  // rather than repeated in each view's own switch. The log is the exception, and the
  // only one in the pane: there this key is the other half of `p` — see reduceLog.
  if (key === PUSH_KEY && state.view !== VIEW_LOG) {
    return openQuickFind(state);
  }
  // Showing what is on screen in the desktop's file manager is the same: every view
  // points at something on disk, so every view can be asked to point at it there
  if (key === "O") {
    return requestReveal(state);
  }
  // And so is going to a saved place. A bookmark is saved from the one view that has
  // a line to save, and reached from wherever the reader happens to be when they
  // want it — which is the whole point of having saved it.
  if (key === "'") {
    return openBookmarks(state);
  }
  // When a string arrived is a question about the repository rather than about the
  // screen, so it answers from every view — with the word under the cursor already
  // typed in, because that is what the reader is looking at
  if (key === "#") {
    return openPickaxe(state, wordUnderCursor(state));
  }
  // The other direction of `S`. That one tells an agent what to change; this one asks
  // it what the code does, which is the half of the conversation a reader wants.
  if (key === "@") {
    return openAsk(state);
  }
  // Reading two places at once, which Ctrl+O cannot do: it is the way back, not the
  // way to have both. Herdr is a multiplexer; this is one call to it.
  if (key === "|") {
    return openBeside(state);
  }
  // The footer has four rows at most and the list has outgrown them on a narrow
  // terminal. This is where all of it is, and the footer says so when it had to clip.
  if (key === "?" && state.view !== VIEW_SEARCH) {
    return openKeys(state, helpText(state));
  }
  // vim's key for the same idea: show me what this is, where I am. Enter is the other
  // half of it and goes there instead. A line somebody has already answered a question
  // about answers with the answer — see ./views/peek.
  if (key === "K") {
    return peekHere(state);
  }
  // And the list of every answer there is. `'` and `\"` are the two lists the reader
  // made themselves; this is the one made for them, which is why it is not a third
  // quote key.
  if (key === "&") {
    return openNotes(state);
  }
  // And where the reading itself has been. Not a stack like Ctrl+O: that is the way
  // back, and this is what was read, kept across panes — see lib/journal.
  if (key === "J") {
    return openJournal(state);
  }
  // The one thing here that leaves with the reader: what was read, what was asked, what
  // came back, and what they wrote, as one file of their own — see lib/reading-export.
  if (key === "X") {
    return { ...clearTransient(state), effect: { type: "export-reading" } };
  }
  // And so is the list of what has been written about it. `'` and `\"` are the same
  // key with and without shift, and they open the two lists of places the reader made
  // themselves — where they meant to come back to, and what they had to say.
  if (key === '"' && state.view !== VIEW_COMMENTS) {
    return openSheet(state, false);
  }
  // Whether the pane keeps itself up to date is a question about the pane, not about
  // whichever view happens to be drawn in it
  if (key === "W") {
    return toggleWatch(state, viewport);
  }
  // So is the repository's history. Every view is a view of a repository that has
  // one, and reading a commit is where a question about any of them ends up. Pressing
  // it in the log is not a second log: it is already open, and opening it again would
  // put a place on the history stack that goes nowhere.
  if (key === "L" && state.view !== VIEW_LOG) {
    return openLog(state);
  }
  // And so is the working tree. It has to be answered here rather than in reduceGit:
  // every view in BY_VIEW ends at its own switch and never falls through to that one,
  // which would leave the key dead in the log and the browser — the two places a
  // reader is most likely to be standing when they want it. The view it does nothing
  // in is the working tree's own diff, and there it says so — see ./views/working-tree.
  if (key === WORKING_TREE_KEY) {
    return openWorkingTree(state);
  }
  // And so is a merge that stopped. It is a state the whole repository is in rather
  // than something belonging to the screen the reader happened to be on when it began,
  // and the footer offers this only while there is one — see lib/screen-model.
  if (key === "M" && state.view !== VIEW_CONFLICTS) {
    return openConflicts(state);
  }

  const reduceView = BY_VIEW[state.view];
  if (reduceView !== undefined) {
    return reduceView(state, key, viewport) || state;
  }
  if (key === "e") {
    return openBrowser(state);
  }

  return (
    reduceNavigation(state, key, viewport) ||
    reduceComments(state, key) ||
    reduceGit(state, key) ||
    state
  );
}

module.exports = { MESSAGE_NO_REPOSITORY, reduce };
