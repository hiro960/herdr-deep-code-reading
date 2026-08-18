"use strict";

// Every transition that changes what is on screen, gathered behind one door.
//
// The transitions themselves live in the modules beside this one, split by what the
// reader is looking at rather than by what the code does: reading a file, a list of
// places, a search, the commits, the bookmarks, the width. This file holds the two
// that belong to no single view — the state a pane opens with, and the key that opens
// whichever kind of place a list is showing — and re-exports the rest, so the layer
// above goes on requiring `./state/views` and knows nothing of the split.

const { loadBookmarks, storePath } = require("../../bookmarks");
const journal = require("../../journal");
const notes = require("../../notes");
const readCommits = require("../../read-commits");
const viewed = require("../../viewed");
const { DEFAULT_CONTEXT, diffOptionsOf } = require("../../diff-options");
const { BROWSE_MODE, DEFAULT_MODE, startsInBrowser, startsInLog } = require("../../entrypoints");
const git = require("../../git");
const { LAYOUT_SPLIT, LAYOUT_STACKED, diffTextWidths, resolveLayout } = require("../../layout");
const { mergeState } = require("../../merge");
const { buildFileSummaries } = require("../files");
const { VIEW_DIFF } = require("../../view-names");
const { READ_CONTENT, firstDiffRow, rowsForSelection } = require("../rows");
const { recordVisit } = require("../visits");
const { openLog } = require("../log");

const { jumpToBookmark, openBookmarks } = require("./bookmarks");
const { openCommitDiff, openFileHistory } = require("./history");
const { FALLBACK_COLUMNS, drawnAt, toggleDiffLayout, withLayout } = require("./layout");
const { openImports, openOutline } = require("./lists");
const { openQuickFind, withQuickFind } = require("./quick-find");
const {
  jumpBack,
  leaveForBrowser,
  moveBrowseBy,
  openBrowser,
  openChosenFile,
  openDiff,
  openForReading,
  toggleBlame,
  toggleReadMode,
  withPreview,
} = require("./reading");
const { reloaded, reloadedInPlace } = require("./reload");
const { followDefinition, jumpToHit, openSearch } = require("./search");
const { openAt } = require("./pane");
const { openWorkingTree } = require("./working-tree");

/**
 * The diff layout the reader has settled on, or null to let the width decide.
 *
 * A name that is neither of the two is not a layout. resolveLayout would ignore it
 * anyway, and answering null says the same thing to `t`, which flips from whatever is
 * actually on screen rather than from whatever was asked for.
 */
function configuredLayout(env) {
  const asked = env.HERDR_DEEP_CODE_READING_LAYOUT;
  return asked === LAYOUT_SPLIT || asked === LAYOUT_STACKED ? asked : null;
}

/**
 * The state a pane opens with.
 *
 * @param {string} repoDir Repository root, already resolved
 * @param {string} mode One of the modes lib/entrypoints knows
 * @param {number} columns Terminal width, which decides the diff layout
 * @returns {object} A state ready to render
 */
function createState(repoDir, mode, columns, options) {
  const requested = mode || DEFAULT_MODE;
  // Where the bookmarks live. The pane reads it from its environment; a test hands
  // one in, so that a run of the suite never touches the reader's own saved places.
  const bookmarksFile =
    options && options.bookmarksFile ? options.bookmarksFile : storePath(process.env);
  // The same arrangement, for the same reason: a test hands one in so that a run of
  // the suite never touches which files the reader has been through
  const viewedFile =
    options && options.viewedFile ? options.viewedFile : viewed.storePath(process.env);
  // And the same again for what an agent has had to say — the one store written by
  // something other than this process, which is why the watch has to look at it
  const notesFile =
    options && options.notesFile ? options.notesFile : notes.storePath(process.env);
  // And again for which commits have been read, which is the file store the log needs
  const readCommitsFile =
    options && options.readCommitsFile
      ? options.readCommitsFile
      : readCommits.storePath(process.env);
  // And the same for the record of what has been read
  const journalFile =
    options && options.journalFile ? options.journalFile : journal.storePath(process.env);
  // The browser and the log are views, not diffs, so they load the default diff behind
  // themselves — which is what `e` and Esc give back
  const opensOnAView = startsInBrowser(requested) || startsInLog(requested);
  const diffMode = opensOnAView ? DEFAULT_MODE : requested;

  const diffContext = DEFAULT_CONTEXT;
  const ignoreWhitespace = false;

  // Whether there is a repository here at all. Most of what this pane does is reading
  // — a browser, a file, an outline, a search, a question to an agent — and none of
  // that is git's. So a directory git has never heard of opens on what it can show,
  // and everything that is about a history is withheld rather than left to fail in
  // front of the reader. See NOTHING_TO_READ_HISTORY_IN below and lib/walk.
  const repository = git.resolveRepoRoot(repoDir) !== null;
  const { title, files, branch } = repository
    ? git.loadDiff(repoDir, diffMode, null, diffOptionsOf({ diffContext, ignoreWhitespace }))
    : { title: "", files: [], branch: null };
  const width = columns || FALLBACK_COLUMNS;
  const layout = configuredLayout(process.env);
  const resolved = resolveLayout(width, layout);
  const sideBySide = resolved.sideBySide;
  const rows = rowsForSelection(files, 0, sideBySide, diffTextWidths(resolved.diffWidth, sideBySide));

  const base = {
    repoDir,
    repository,
    mode: diffMode,
    title,
    branch,
    files,
    fileSummaries: buildFileSummaries(files),
    columns: width,
    sideBySide,
    // Null unless the config file named one: the width decides the diff's layout
    // until a key says otherwise, and from then on the choice does
    layout,
    // How the diff was computed, as opposed to how it is drawn. `+`, `-` and `=`
    // change these, and every reload has to ask git for the same thing again.
    diffContext,
    ignoreWhitespace,
    selectedIndex: 0,
    rows,
    scroll: 0,
    cursor: firstDiffRow(rows),
    column: 0,
    selectionAnchor: null,
    view: VIEW_DIFF,
    repoPaths: null,
    browse: null,
    openPath: null,
    readMode: READ_CONTENT,
    preview: null,
    searchQuery: "",
    // Whether the repository search reads its query as a pattern. Off to begin with:
    // a reader looking for `a.js` or `foo(1)` means those characters, and having to
    // escape them to find the obvious thing is the wrong default.
    searchRegex: false,
    // The last text looked for inside a file. It outlives the file it was typed in,
    // the way an editor's search does, so `n` goes on meaning the same thing.
    findQuery: "",
    hits: [],
    // What the last symbol grep of the open quick find found, so typing further into
    // one narrows what is in hand instead of starting another process
    symbolSearch: null,
    comments: [],
    // Read once, on the way in. Every change from here is written back through an
    // effect, so the list in hand is always the list on disk.
    bookmarksFile,
    bookmarks: loadBookmarks(bookmarksFile, repoDir),
    // Which files of this change have been read. Read once, like the bookmarks; every
    // change from here is written back through an effect.
    viewedFile,
    viewed: viewed.loadViewed(viewedFile, repoDir),
    // And which commits have been. Read here rather than when the log opens: the pane
    // may open straight onto it, and a store read twice is a store that can disagree
    // with itself.
    readCommitsFile,
    readCommits: readCommits.loadReadCommits(readCommitsFile, repoDir),
    // And where the reading has been, across every pane opened on this repository.
    // Appended to as places are opened, written back through an effect.
    journalFile,
    journal: journal.loadJournal(journalFile, repoDir),
    // Read on the way in and again on every reload: an agent writes them while the
    // pane is open, which is the whole point of them
    notesFile,
    notes: notes.loadNotes(notesFile, repoDir),
    // Whether the pane reloads itself when the repository moves. Off to begin with:
    // rows rebuilding under a reader who did not ask for it is worse than pressing r.
    watching: false,
    // The commit being shown, when the mode is `commit`. Null in every other mode,
    // which is what tells a reload to rebuild the working tree's diff instead.
    commit: null,
    // The log screen's four panes, built the first time it is opened — see ../log.
    log: null,
    // Whether the reading view carries a blame column. It narrows the text, so
    // turning it on rebuilds the rows — see ../rows.
    blame: false,
    input: null,
    picker: null,
    history: [],
    message: null,
    effect: null,
    pendingQuit: false,
    // The other keys that ask before they act: a pull moves the files under the
    // reader, a push puts commits where other people read them, a merge commit can
    // seal a file that still holds both sides, and undoing a merge throws away every
    // side already chosen — see ../log and ./conflicts
    pendingPull: false,
    pendingPush: false,
    pendingCommit: false,
    pendingAbort: false,
    pendingDelete: false,
    // The file `y` remembered, for `p` to write somewhere else — see ./files
    yanked: null,
    // Whether a merge stopped in this repository, and what it could not settle. Read
    // on the way in because a pane may be opened onto a working tree somebody left
    // half-merged, and every view says so while it is — see lib/merge.
    merge: repository ? mergeState(repoDir) : null,
    quit: false,
  };

  // A pane opened beside another one is opened at a place rather than on a screen —
  // see lib/state/views/pane.js, which is the other half of this
  const at = openAt(options && options.openAt !== undefined ? options.openAt : process.env);
  if (at !== null) {
    return jumpToHit(base, at);
  }

  // Without a repository there is one screen to open on, whichever was asked for: the
  // browser is the only one that draws something a directory has. Saying so once beats
  // opening on an empty diff whose emptiness means something else entirely.
  if (!repository) {
    const browsing = openBrowser(base);
    return requested === BROWSE_MODE
      ? browsing
      : { ...browsing, message: `${repoDir} is not a git repository — reading it as a directory` };
  }

  if (startsInBrowser(requested)) {
    return openBrowser(base);
  }
  return startsInLog(requested) ? openLog(base) : base;
}

/** Open the file a search hit points at, with the cursor on the matched line. */
function openHit(state, viewport) {
  const row = state.rows[state.cursor];
  if (row === undefined || row.kind !== "hit") {
    return state;
  }
  // Four kinds of place answer to Enter here. A commit opens a diff rather than a
  // file; a bookmark may be a month old and its line number alone is not to be
  // trusted; a grep hit was true a moment ago and is taken at its word.
  if (row.hit.isCommit) {
    return openCommitDiff(state, row.hit.commit);
  }
  if (row.hit.isBookmark) {
    return jumpToBookmark(state, row.hit, viewport);
  }

  const opened = jumpToHit(state, row.hit, viewport);

  // And the fourth is a file named by its path in the quick find, which is the same
  // decision the browser's `l` records: this is the file I want to read. Every other
  // hit here arrives at a place inside a file — a match, a definition, a use, a line
  // an agent answered — and a record of those is a record of keystrokes.
  return row.hit.isFile ? recordVisit(opened, journal.fileEntry(row.hit.path)) : opened;
}

module.exports = {
  createState,
  drawnAt,
  followDefinition,
  jumpBack,
  leaveForBrowser,
  moveBrowseBy,
  openBookmarks,
  openBrowser,
  openChosenFile,
  openDiff,
  openFileHistory,
  openForReading,
  openHit,
  openImports,
  openOutline,
  openQuickFind,
  openSearch,
  openWorkingTree,
  reloaded,
  reloadedInPlace,
  toggleBlame,
  toggleDiffLayout,
  toggleReadMode,
  withLayout,
  withPreview,
  withQuickFind,
};
