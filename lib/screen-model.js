"use strict";

// Everything the renderer is handed: one frame's worth of model, built from a state.
//
// The names it switches on — which view, which field — are in ./view-names, so that
// the state layer can have them without having this. app-state depends on this file,
// never the other way round.

const path = require("node:path");

const { countByFile, describeEntries } = require("./comments");
const { DEFAULT_MODE } = require("./entrypoints");
const { wordAt } = require("./line-cursor");
const { prepareLine } = require("./text");
const {
  INPUT_ASK,
  INPUT_AUTHOR,
  INPUT_COMMENT,
  INPUT_COMMIT,
  INPUT_CREATE,
  INPUT_FILTER,
  INPUT_FIND,
  INPUT_OPEN,
  INPUT_PICKAXE,
  INPUT_SEARCH,
  VIEW_BROWSE,
  VIEW_COMMENTS,
  VIEW_CONFLICTS,
  VIEW_DIFF,
  VIEW_LOG,
  VIEW_READ,
  VIEW_SEARCH,
} = require("./view-names");
const { DEFAULT_CONTEXT, contextLabel } = require("./diff-options");
const { stickyText } = require("./sticky");
const { noteLines } = require("./notes");
const { readCount, readShas } = require("./read-commits");
const { isViewed, viewedCount } = require("./viewed");
const { detectLanguage } = require("./syntax");
const { cellOfRow } = require("./view-model");
// Facts about a diff rather than about a frame, so they live below the state layer
// that also asks them — see ./state/files. Used here rather than passed on: whatever
// wants them asks that file for them now.
const { buildFileSummaries, currentFilePath } = require("./state/files");
// Which of the log's four panes has the focus decides whether the cursor and the panel
// are drawn as live, and the reducer asks the same of the cursor to know whether a
// comment key has a line to work on — one question, answered where the names are
const { cursorIsLive, panelIsLive } = require("./state/log");
// Which branch HEAD is on, and how far it has drifted from the one it follows — the
// pair the log's header ends with, so that `↓3` is never read without its age
const { hasRemoteRefs, headBranchOf } = require("./refs");
const { trackingLabel } = require("./upstream");
// Whether a merge stopped in this repository, which every view says while one has —
// see lib/merge
const { isMergingNow, unresolvedOf } = require("./merge");
// Which rows of a file open a conflict, which is what decides whether the keys that
// step between them are worth offering
const { conflictRows } = require("./conflict");

// Each of these names every key the view binds, and only keys it binds. Both halves
// matter: test/help-keys.test.js checks that a named key works, because a footer
// that lies is worse than a short one, and a key that is never named might as well
// not exist to a reader seeing the pane for the first time. The footer wraps to as
// many rows as that takes — see lib/help-layout.js.
// The diff's footer comes in two versions and the only difference is the staging
// keys. Written out twice, the difference was three words hidden inside two hundred
// characters of identical text, so they are joined from their items instead.
const KEY_SEPARATOR = "  ";

function footer(...groups) {
  return groups.flat().join(KEY_SEPARATOR);
}

const DIFF_KEYS = [
  "j/k d/u g/G line",
  "h/l column",
  "w/b word",
  "n/p file",
  "/ find in diff",
  "* this word",
  "t split/stack",
  "Enter definition",
  "R uses",
  "v mark",
  "c comment",
  "x delete",
];
// What every diff footer ends with, whatever the mode
const DIFF_TAIL = [
  "V read",
  "r reload",
  "+/- context",
  "= whitespace",
  "L log",
  "# find in history",
  "W watch",
  "e files",
  "P find",
  "' marks",
  '" comments',
  "O reveal",
  "S send",
  "@ ask",
  "| open beside",
  "? keys",
  "K peek",
  "& notes",
  "J reading",
  "X write out",
  "Q quit",
];

// Staging is driven by `git status`, which only lines up with the review mode's file
// list. The other modes reload from a fixed diff, so these are withheld — and the
// footer withholds them too, because a key the footer does not name must not quietly
// change the repository behind it.
const DIFF_STAGING_KEYS = ["space stage", "A stage all", "C commit"];
// What the modes without those keys are offered in their place: the way back to the
// diff that has them. It sits where the staging keys sit rather than at the end,
// because it is the answer to their absence and reads as one beside it.
const DIFF_WORKING_TREE_KEY = ["D working tree"];

const HELP_DIFF = footer(DIFF_KEYS, DIFF_STAGING_KEYS, DIFF_TAIL);
const HELP_DIFF_READONLY = footer(DIFF_KEYS, DIFF_WORKING_TREE_KEY, DIFF_TAIL);
const HELP_COMMENT = "Enter save  Ctrl+D new line  Esc cancel";
const HELP_COMMIT = "Enter commit  Ctrl+D new line  Esc cancel";
const HELP_PICKER = "1-9 choose an agent  Esc cancel";
// The other three footers are joined from their items too, for the reason the diff's
// pair was: a footer written as one long string is a footer where adding a key means
// re-flowing three lines of quoted text and hoping the two spaces survived.
const HELP_BROWSE = footer([
  "j/k d/u g/G move",
  "l/Enter open",
  "h/Esc up",
  "f filter",
  "a new file",
  "y yank",
  "p paste",
  "D delete",
  "r rename",
  "/ search",
  "Tab contents/diff",
  "e diff",
  "P find",
  "' marks",
  '" comments',
  "L log",
  "# find in history",
  "O reveal",
  "W watch",
  "S send",
  "@ ask",
  "| open beside",
  "? keys",
  "K peek",
  "& notes",
  "J reading",
  "X write out",
  "Q quit",
]);
const HELP_READ = footer([
  "j/k d/u g/G line",
  "h/l column",
  "w/b word",
  "/ find in file",
  "n/N match",
  "* this word",
  "Enter definition",
  "R uses",
  "o outline",
  "i imports",
  "Tab contents/diff",
  "v mark",
  "c comment",
  "x delete",
  "E edit",
  "m bookmark",
  "S send",
  "@ ask",
  "| open beside",
  "? keys",
  "K peek",
  "& notes",
  "J reading",
  "X write out",
  "Esc/Ctrl+O back",
  "e diff",
  "D working tree",
  "P find",
  "' marks",
  '" comments',
  "L log",
  "# find in history",
  "H history",
  "B blame",
  "O reveal",
  "W watch",
  "Q quit",
]);
const HELP_LOG = footer([
  "j/k d/u g/G move",
  "Tab pane",
  "l/Enter open/narrow",
  "a all/current",
  "f first-parent",
  "A author",
  "V read",
  "# find in history",
  "r reload",
  "F fetch",
  "p pull",
  // A key that means something else here than it does in every other view, so this
  // footer says so — the reading view's `C` is the other one — see lib/state/reducers
  "P push",
  "v mark",
  "c comment",
  "x delete",
  "h/Esc/Ctrl+O back",
  "e diff",
  "D working tree",
  "' marks",
  '" comments',
  "O reveal",
  "W watch",
  "S send",
  "@ ask",
  "| open beside",
  "? keys",
  "K peek",
  "& notes",
  "J reading",
  "X write out",
  "Q quit",
]);
// What a merge left unsettled, and the keys that settle it. Two of them ask before
// they act — see lib/state/views/conflicts — and the footer names them the same way it
// names the rest: a key that changes the repository must be one the reader can read
// about before they press it.
const HELP_CONFLICTS = footer([
  "j/k d/u g/G move",
  "l/Enter open the file",
  "o ours",
  "t theirs",
  "space resolved",
  "E edit",
  "C commit the merge",
  "! undo the merge",
  "r reload",
  "h/Esc/Ctrl+O back",
  // A merge is settled in the working tree, so the way to look at it belongs here as
  // much as anywhere: what is staged and what is not is the question this list ends in
  "D working tree",
  "L log",
  "P find",
  "' marks",
  '" comments',
  "# find in history",
  "O reveal",
  "W watch",
  // `S` is not here. Sending a review is a key each reading view binds for itself, and
  // this view is not one of them: what is on it is files to settle rather than lines to
  // say something about. A footer naming it would be naming a key that does nothing.
  "@ ask",
  "| open beside",
  "? keys",
  "K peek",
  "& notes",
  "J reading",
  "X write out",
  "Q quit",
]);

// What every other view gains while a merge is stopped: the way into the list of what
// it could not settle. Offered only while there is one, because a footer naming a key
// that answers "no merge in progress" is a footer teaching the reader nothing.
const HELP_MERGING = "M merge";
// And what the reading view gains while the file it is showing is one of them
const HELP_CONFLICT_STEPS = "] [ conflict";

// The comment list does two jobs and Enter is the key that differs, so the footer
// says which one this list was opened for rather than naming both.
const SHEET_TAIL = [
  "x delete",
  // The one key here that writes a file. The others this list withholds do nothing it
  // cannot undo; a key that leaves something on disk has to be named wherever it works.
  "X write out",
  "h/Esc/Ctrl+O back",
  "e diff",
  "D working tree",
  "P find",
  "' marks",
  "L log",
  "# find in history",
  "O reveal",
  "Q quit",
];
const HELP_SHEET_SEND = footer(
  ["j/k d/u g/G move", "space choose", "l/Enter send the chosen"],
  SHEET_TAIL
);
const HELP_SHEET = footer(
  ["j/k d/u g/G move", "l/Enter go to the comment", "S send"],
  SHEET_TAIL
);

const HELP_FILTER = "type to filter file names  Enter keep  Esc clear";
// The one field that makes something rather than finding something, so it says where
// what it makes will land
const HELP_CREATE = "type a name for a new empty file, under this directory  Enter create  Esc cancel";
const HELP_SEARCH_INPUT =
  "type text to find in files  Ctrl+R literal/regex  Enter search  Esc cancel";
const HELP_FIND = "type text to find in this file  Enter jump  Esc cancel";
const HELP_ASK = "type a question about these lines  Ctrl+D new line  Enter ask  Esc cancel";
const HELP_AUTHOR = "type an author  Enter narrow the graph, empty for everybody  Esc cancel";
const HELP_PICKAXE =
  "type text to find in the history  Ctrl+R literal/regex  Enter search  Esc cancel";
const HELP_OPEN =
  "type to find a file  @name for a symbol  \u2191/\u2193 choose  Enter open  Esc cancel";
const HELP_SEARCH = footer([
  "j/k d/u g/G move",
  "l/Enter open at the line",
  "/ search again",
  "h/Esc/Ctrl+O back",
  "S send",
  "@ ask",
  "| open beside",
  "? keys",
  "K peek",
  "& notes",
  "J reading",
  "X write out",
  "e diff",
  "D working tree",
  "P find",
  "' marks",
  '" comments',
  "L log",
  "# find in history",
  "O reveal",
  "W watch",
  "Q quit",
]);

// Precedence reads off these two tables: an open field wins, then the view
const HELP_BY_INPUT = {
  [INPUT_CREATE]: HELP_CREATE,
  [INPUT_FILTER]: HELP_FILTER,
  [INPUT_FIND]: HELP_FIND,
  [INPUT_SEARCH]: HELP_SEARCH_INPUT,
  [INPUT_OPEN]: HELP_OPEN,
  [INPUT_ASK]: HELP_ASK,
  [INPUT_AUTHOR]: HELP_AUTHOR,
  [INPUT_PICKAXE]: HELP_PICKAXE,
  [INPUT_COMMIT]: HELP_COMMIT,
  [INPUT_COMMENT]: HELP_COMMENT,
};
const HELP_BY_VIEW = {
  [VIEW_BROWSE]: HELP_BROWSE,
  [VIEW_CONFLICTS]: HELP_CONFLICTS,
  [VIEW_LOG]: HELP_LOG,
  [VIEW_READ]: HELP_READ,
  [VIEW_SEARCH]: HELP_SEARCH,
};

/**
 * The browser's three columns.
 * Everything here is already on the browse state, including the parent listing,
 * so building this model never walks the repository's file list.
 * @returns {object|null} null when the browser has not been opened
 */
function browseModel(state) {
  if (state.browse === null || state.browse === undefined) {
    return null;
  }

  return {
    dir: state.browse.dir,
    filter: state.browse.filter,
    entries: state.browse.entries,
    index: state.browse.index,
    parentEntries: state.browse.parentEntries || [],
    parentIndex: state.browse.parentIndex === undefined ? -1 : state.browse.parentIndex,
  };
}

/**
 * Footer text for whatever the pane is currently doing.
 * An open text field or picker takes precedence, then the view.
 * @returns {string}
 */
function helpText(state) {
  if (state.input !== null) {
    return HELP_BY_INPUT[state.input.kind] || HELP_COMMENT;
  }
  if (state.picker !== null) {
    return HELP_PICKER;
  }
  // The merge keys go first rather than last. A footer too long for the terminal is
  // clipped from the end, and the reader standing in a stopped merge needs the way into
  // it more than they need the last item of a list they can open with `?`.
  const shown =
    state.repository === false ? withoutRepositoryKeys(viewHelp(state)) : viewHelp(state);
  return footer([...whileMerging(state), ...whileBlaming(state), shown]);
}

// The keys that are about a repository rather than about what is on screen. A
// directory git has never heard of has none of them to press, and the footer's promise
// is that every key it names does something where it names it.
const NEEDS_REPOSITORY = new Set([
  "Tab contents/diff",
  "e diff",
  "D working tree",
  "L log",
  "# find in history",
  "H history",
  "B blame",
]);

/** A footer with the repository's keys taken out, for a directory that has none. */
function withoutRepositoryKeys(help) {
  return footer(help.split(KEY_SEPARATOR).filter((item) => !NEEDS_REPOSITORY.has(item)));
}

/**
 * What the blame column adds to a footer.
 *
 * One key, and only where it does something: the commit a line came from is a question
 * the column asks and nothing else on screen can answer. Offered nowhere else, because
 * a `C` that had to blame the file first would be doing what nobody pressed it for —
 * and in every other view `C` is how a commit is written rather than read.
 */
function whileBlaming(state) {
  return state.view === VIEW_READ && state.blame === true ? ["C commit"] : [];
}

/** The footer of whatever view is showing, before a merge adds anything to it. */
function viewHelp(state) {
  if (state.view === VIEW_COMMENTS) {
    return state.sheet !== null && state.sheet !== undefined && state.sheet.sending
      ? HELP_SHEET_SEND
      : HELP_SHEET;
  }
  if (HELP_BY_VIEW[state.view]) {
    return HELP_BY_VIEW[state.view];
  }

  return state.mode === DEFAULT_MODE ? HELP_DIFF : HELP_DIFF_READONLY;
}

/**
 * What a stopped merge adds to a footer.
 *
 * The way in, from every view but the list itself; and in the reading view, when the
 * file open is one the merge could not settle, the two keys that step between its
 * conflicts. Both are offered only where they do something, which is the promise every
 * footer here makes.
 */
function whileMerging(state) {
  if (!isMergingNow(state.merge)) {
    return [];
  }

  // Asked of the rows rather than of the conflict list: a file both sides deleted, or
  // one deleted at one end and kept at the other, is a conflict with nothing between
  // markers to step between. What the keys move through is what is on screen.
  const steppable = state.view === VIEW_READ && conflictRows(state.rows).length > 0;

  return [
    ...(state.view === VIEW_CONFLICTS ? [] : [HELP_MERGING]),
    ...(steppable ? [HELP_CONFLICT_STEPS] : []),
  ];
}

/**
 * Where the branch being read stands against the one it follows, and how old that is.
 *
 * The two belong together or neither is worth saying. `main ↓3` is a count read from a
 * copy of the remote, and the copy is exactly as current as the last fetch — so the
 * header carries the age beside the number, and a reader can tell news from a memory
 * without having to remember when they last pressed `F`.
 */
function trackingHeading(state) {
  const branch = headBranchOf(state.log.branches);
  const label = branch === null ? "" : trackingLabel(branch.track);
  const stood = label === "" ? "" : `  ${branch.name} ${label}`;
  // The age dates the counts, so it is said only where there are counts to date: a
  // repository with no remote has never fetched and never will, and saying so would
  // name a missing thing that is not missing
  const dated =
    state.log.fetched && hasRemoteRefs(state.log.branches) ? `  ${state.log.fetched}` : "";

  return `${stood}${dated}`;
}

/** What the log's header says: how much of the repository is being shown. */
function logHeading(state) {
  const commits = state.log.rows.filter((row) => row.commit !== null).length;
  const scope = state.log.ref === null ? "all branches" : state.log.ref;
  // Named for as long as it is set, the way the diff's own context and whitespace
  // settings are: a graph leaving commits out has to say that it is
  const trunk = state.log.firstParent === true ? "  first-parent" : "";
  // And whose work is being read, which is the other thing that decides what is missing
  const by = state.log.author ? `  by ${state.log.author}` : "";
  // How much of what is on screen is left, which is the question a reading spread over
  // two sittings opens with — the same thing the diff's own subtitle says of its files
  const read = readCount(state.readCommits || [], state.log.rows);
  const counted = read === 0 ? `${commits}` : `${read}/${commits} read`;

  return `log: ${scope}${trunk}${by}  (${counted})${trackingHeading(state)}`;
}

/** What the header names: the search, the open file, the directory, or the diff. */
function headingFor(state) {
  if (state.view === VIEW_LOG && state.log) {
    return logHeading(state);
  }
  if (state.view === VIEW_COMMENTS || state.view === VIEW_CONFLICTS) {
    return state.listTitle;
  }
  if (state.view === VIEW_SEARCH) {
    const hits = state.hits || [];
    // The view also carries the outline, the imports list and the quick find,
    // which name themselves — including how many of a capped list are being shown
    if (state.listTitle) {
      return state.listTitle;
    }
    // Which mode the hits were found in is part of what they are: the same query
    // means two different things, and only one of them produced this list
    const kind = state.searchRegex ? "regex" : "search";
    return `${kind}: ${state.searchQuery || ""}  (${hits.length} hits)`;
  }
  if (state.view === VIEW_READ) {
    return state.openPath;
  }
  if (state.view === VIEW_BROWSE) {
    const dir = state.browse.dir === "" ? "/" : state.browse.dir;
    return state.browse.filter ? `${dir}  filter: ${state.browse.filter}` : dir;
  }

  // The panel has 34 columns for a path and drops directories to fit, so the header
  // is where the whole of it is said. The reading view has always named its file
  // here; the diff view names the one the panel is pointing at, after the mode,
  // because which diff you are reading and which file of it are different questions.
  const file = currentFilePath(state);
  return file === null ? state.title : `${state.title} · ${file}`;
}

/**
 * What the diff was computed with, when it was not computed the usual way.
 *
 * Both of these change which lines exist at all, and the message that announced the
 * change fades after four seconds. A diff quietly hiding every whitespace change is
 * not one a reader should be left holding without knowing.
 */
function diffOptionsLabel(state) {
  const parts = [];

  if (state.diffContext !== undefined && state.diffContext !== DEFAULT_CONTEXT) {
    parts.push(`context ${contextLabel(state.diffContext)}`);
  }
  if (state.ignoreWhitespace === true) {
    parts.push("ignoring whitespace");
  }

  return parts.length === 0 ? "" : `  ${parts.join("  ")}`;
}

/** The repository name keeps several review panes apart at a glance. */
function subtitleFor(state) {
  const repoName = path.basename(state.repoDir);
  const total = state.comments.length;
  // A pane that reloads on its own has to say so somewhere that stays on screen. The
  // footer's message fades, and rows rebuilding for no visible reason is alarming.
  const watching = state.watching === true ? "  watching" : "";
  const options = diffOptionsLabel(state);
  // How far through the change the reader is, which is the question a review spread
  // over two sittings opens with
  const read = viewedCount(state.viewed || [], state.files);
  const files = read === 0 ? `${state.files.length} files` : `${read}/${state.files.length} read`;

  if (total === 0) {
    return `${repoName}  ${files}${options}${watching}`;
  }

  // Comments and questions are counted apart. They are one list and one send, but they
  // ask two different things of the agent, and how many of each is waiting to go is
  // what the reader is keeping track of.
  return `${repoName}  ${files}  ${describeEntries(state.comments)}${options}${watching}`;
}

/**
 * Which lines of the current file already carry a comment.
 * A comment on a range marks every line of it, so the gutter shows how far the note
 * reaches rather than only where it started.
 */
function commentKeysFor(state) {
  const currentFile = currentFilePath(state);
  const keys = new Set();

  for (const comment of state.comments) {
    if (comment.file !== currentFile) {
      continue;
    }
    for (let line = comment.start; line <= comment.end; line += 1) {
      keys.add(`${comment.side}:${line}`);
    }
  }

  return keys;
}

/**
 * The line to pin above the body: the thing the cursor is inside.
 *
 * Only the two views that scroll through code have one. A list of places has no
 * inside, and the log's diff half is four rows tall on a short terminal — pinning a
 * row there would take a quarter of it to say something the graph above already does.
 */
function stickyFor(state) {
  if (state.view === VIEW_READ) {
    return stickyText(state.rows, state.cursor, detectLanguage(state.openPath));
  }
  if (state.view === VIEW_DIFF) {
    return stickyText(state.rows, state.cursor);
  }
  return null;
}

/**
 * The identifier the column cursor is on, as offsets into its line.
 *
 * The renderer draws it reversed so that what a jump would follow is visible before
 * the jump. A cursor resting on whitespace is on no word, and nothing is drawn.
 *
 * @returns {{start: number, end: number, text: string}|null}
 */
function wordFor(state) {
  const row = state.rows[state.cursor];
  if (row === undefined || row === null || !cursorIsLive(state)) {
    return null;
  }

  const cell = cellOfRow(row);
  if (cell === null) {
    return null;
  }

  return wordAt(prepareLine(cell.text), state.column || 0);
}

/**
 * The run of rows the reader has marked, as row indexes.
 * @returns {{from: number, to: number}|null} null when nothing is marked
 */
function selectionFor(state) {
  if (state.selectionAnchor === null || state.selectionAnchor === undefined) {
    return null;
  }
  return {
    from: Math.min(state.selectionAnchor, state.cursor),
    to: Math.max(state.selectionAnchor, state.cursor),
  };
}

/**
 * Build the model handed to the renderer.
 * Nothing here reads the filesystem or runs git: it is a view over state alone.
 * @returns {object} Everything one frame needs
 */
function toScreenModel(state) {
  const counts = countByFile(state.comments);
  // Hand-built states in tests may predate the cache, so it is derived on demand
  const summaries = state.fileSummaries || buildFileSummaries(state.files);
  // A stopped merge is said beside the branch and on every screen, because it is true
  // of the repository rather than of whatever is being read — and because a working
  // tree left half-merged is the one thing here a reader must not walk away from
  // without knowing. The count is what is left to settle.
  const merging = isMergingNow(state.merge)
    ? ` (merging — ${unresolvedOf(state.merge).length} left)`
    : "";
  const branchLabel = state.branch ? `  ${state.branch}${merging}` : merging;

  return {
    title: `herdr-deep-code-reading${branchLabel}  ${headingFor(state)}`,
    subtitle: subtitleFor(state),
    files: summaries.map((summary, index) => ({
      ...summary,
      comments: counts[summary.path] || 0,
      // Asked of the file rather than of the summary: a mark records what was read,
      // and only the file itself still has the lines that answer for that
      viewed: isViewed(state.viewed || [], state.files[index]),
    })),
    selectedIndex: state.selectedIndex,
    // Which layout the rows were built for. The renderer draws the panel and the
    // diff area from the width, but it cannot ask the width this one: the reader
    // may have chosen the other layout at a width that would pick this one.
    sideBySide: state.sideBySide,
    rows: state.rows,
    scroll: state.scroll,
    cursor: state.cursor,
    panelActive: panelIsLive(state),
    sticky: stickyFor(state),
    commentKeys: commentKeysFor(state),
    noteLines: noteLines(state.notes || [], currentFilePath(state)),
    selection: selectionFor(state),
    word: wordFor(state),
    cursorActive: cursorIsLive(state),
    input: state.input,
    picker: state.picker,
    peek: state.peek || null,
    view: state.view,
    // The log's four panes, handed over as they are: everything the frame needs is
    // already on them, and building a second shape for it would be a copy to keep in
    // step — see lib/render/log.js
    log: state.log || null,
    // Which of the graph's commits have been read, as the one lookup a frame asks of
    // every row it draws — the same shape commentKeys is, and built the same way
    readShas: readShas(state.readCommits || []),
    // Which diff layout the reader chose, if they chose one. The log resolves its own
    // widths and has to honour the same choice the diff view does.
    diffLayout: state.layout || undefined,
    browse: browseModel(state),
    preview: state.preview || null,
    openPath: state.openPath,
    help: helpText(state),
    message: state.message,
  };
}

module.exports = {
  stickyFor,
  helpText,
  toScreenModel,
};
