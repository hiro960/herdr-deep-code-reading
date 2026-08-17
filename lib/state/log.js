"use strict";

// The log screen: four panes and the cursor in each of them.
//
// The branch list, the graph beside it, and — underneath both — the file panel and the
// diff of whatever commit the graph is pointing at. The lower half is the diff view's
// own state, untouched: the same `files`, `selectedIndex`, `rows` and `cursor` every
// other diff is drawn from, which is why the file panel and the diff behave here
// exactly as the reader already knows them to.
//
// Only the upper half is new, and it lives on `state.log` so that nothing below has to
// learn about it. Moving in the graph loads the commit it lands on: a graph is how a
// commit is chosen and a diff is what is then read, so making the reader press a second
// key between the two would be asking them to say twice what they already said once.
//
// It moves nothing. There is no checkout here, no merge, no rebase, no branch made or
// deleted: reading a repository and rearranging one are different jobs and this is a
// tool for the first. The two things it does ask of a remote are the two that are not
// rearranging — `F` asks what has arrived, and `p` takes what has arrived onto the
// branch that is already checked out, and only when that is a fast-forward. Both say
// what they are about to do before they do it; see requestFetch and requestPull.
//
// The counts beside the branches are the other half of the same answer. They are read
// from the copies under `refs/remotes`, which only a fetch updates, so the header dates
// them: `fetched 20m ago` is what tells a reader whether `↓3` is news or a memory.

const { currentBranch } = require("../git");
const { graphWidth, loadGraph, remoteNames } = require("../graph");
const { branchAt, branchRows, headBranchOf, loadBranches, refIndexOf } = require("../refs");
const { describeTracking, fetchAge, lastFetch, pushTarget, trackingLabel } = require("../upstream");
const { isMergingNow } = require("../merge");
const { FALLBACK_COLUMNS } = require("../layout");
const { resolveLogLayout } = require("../log-layout");
const { pushPlace } = require("../jump-history");
const { INPUT_AUTHOR, VIEW_DIFF, VIEW_LOG } = require("../view-names");
const { scrollToCursor, withCursor, withSelection } = require("./cursor");
const { tryCommitDiff } = require("./commit-diff");
const { commitEntry } = require("../journal");
const { recordVisit } = require("./visits");
const { toggleRead } = require("../read-commits");
const { MESSAGE_NO_COMMIT, clearTransient, withMessage } = require("./messages");

const FOCUS_BRANCHES = "branches";
const FOCUS_GRAPH = "graph";
const FOCUS_PANEL = "panel";
const FOCUS_DIFF = "diff";

// Tab goes round in the order the eye does: the graph the reader came for, down into
// the files of the commit it chose, into the diff of one of those, and only then out
// to the branch list — which is a place to go, not a place to be.
const FOCUS_ORDER = [FOCUS_GRAPH, FOCUS_PANEL, FOCUS_DIFF, FOCUS_BRANCHES];

/**
 * The nearest row carrying a commit, looked for in one direction and then the other.
 *
 * The graph's edge rows — the `|\` and `|/` that carry a lane past a merge — belong to
 * no commit, and a cursor resting on one would have nothing to load and nothing to
 * open. Moving lands past them rather than on them, in the direction the reader was
 * already going, so `j` at the bottom of a merge does not silently reverse.
 *
 * @returns {number} A row index, or -1 when the graph holds no commit at all
 */
function nearestRow(rows, index, direction, isCandidate) {
  for (let at = index; at >= 0 && at < rows.length; at += direction) {
    if (isCandidate(rows[at])) {
      return at;
    }
  }
  // Nothing that way: the reader is at the end of the list, so look back the other way
  // rather than refuse to move
  for (let at = index; at >= 0 && at < rows.length; at -= direction) {
    if (isCandidate(rows[at])) {
      return at;
    }
  }
  return -1;
}

function commitRowNear(rows, index, direction) {
  return nearestRow(rows, index, direction, (row) => row.commit !== null);
}

/** The same, for the branch list, whose headings the cursor also steps over. */
function branchRowNear(rows, index, direction) {
  return nearestRow(rows, index, direction, (row) => row.kind === "branch");
}

/** The commit the graph cursor is on, or null when it is on none. */
function commitAtCursor(state) {
  if (state.log === null || state.log === undefined) {
    return null;
  }
  const row = state.log.rows[state.log.cursor];
  return row === undefined || row.commit === null ? null : row.commit;
}

/**
 * How the screen is divided, for the keys that page by a screenful.
 *
 * The reducer is handed the whole body's height, and neither half of this screen is
 * that tall. The division is pure arithmetic over the width, so asking for it here
 * costs nothing and keeps the scroll model and the frame agreeing on where the rule
 * between them is.
 */
function logLayoutOf(state, viewport) {
  return resolveLogLayout(state.columns || FALLBACK_COLUMNS, viewport, state.layout);
}

/** Load the diff of whatever commit the cursor is on, under the graph. */
function showCommitAtCursor(state) {
  const commit = commitAtCursor(state);
  if (commit === null) {
    return state;
  }

  const loaded = tryCommitDiff(state, commit);
  return loaded.ok ? loaded.state : withMessage(state, loaded.message);
}

/** A log state with a graph on it, keeping everything else about the log as it was. */
function withGraph(state, rows, cursor, scroll) {
  return {
    ...clearTransient(state),
    log: { ...state.log, rows, cursor, scroll, graphWidth: graphWidth(rows) },
  };
}

/**
 * How much of the history the graph is reading: which ref, and whether only its trunk.
 *
 * One constructor for the pair, because withScope spreads what it is given straight
 * onto the log state — a scope grown a third key would put that there too.
 *
 * @param {{ref?: string|null, firstParent?: boolean, author?: string|null}} [changes]
 *   What this scope changes about the one in hand
 */
function scopeOf(state, changes) {
  return {
    ref: state.log.ref,
    firstParent: state.log.firstParent === true,
    author: state.log.author || null,
    ...changes,
  };
}

/**
 * Read the graph for a scope and show it.
 *
 * @param {{ref: string|null, firstParent: boolean}} scope From scopeOf
 * @param {string} [said] What the footer says once it is on screen. A failure on the
 *   way — a graph that would not read, a commit whose diff would not — has already
 *   said something, and what it says is the more useful of the two.
 */
function withScope(state, scope, said) {
  const graph = loadGraph(state.repoDir, scope);
  if (!graph.ok) {
    const what = scope.ref === null || scope.ref === undefined ? "the history" : scope.ref;
    return withMessage(state, `Could not read ${what}: ${graph.error}`);
  }

  const cursor = Math.max(0, commitRowNear(graph.rows, 0, 1));
  const scoped = withGraph(state, graph.rows, cursor, 0);
  const shown = showCommitAtCursor({ ...scoped, log: { ...scoped.log, ...scope } });

  return said === undefined || shown.message !== null ? shown : withMessage(shown, said);
}

/**
 * How old the counts beside the branches are, as the header says it.
 *
 * A clock in here rather than in the frame: the age is a fact about the list that was
 * just read, and re-reading it on every keystroke would have the header count seconds
 * at a reader who is trying to read a diff. It is taken again with the list itself —
 * `r`, `F` and `p` all end in one — which is exactly when it can have changed.
 *
 * @param {function(): number} [now] The clock, for a test that needs a fixed one
 */
function fetchedLabel(repoDir, now) {
  return fetchAge(lastFetch(repoDir), (now === undefined ? Date.now : now)());
}

/**
 * Open the log, recording where the reader was so that Esc gives it back.
 *
 * Both lists are read here rather than lazily: the branch list is one `for-each-ref`
 * and the graph is one `log`, and a screen that draws itself in two stages is a screen
 * that flickers.
 */
function openLog(state) {
  const branches = loadBranches(state.repoDir);
  if (!branches.ok) {
    return withMessage(state, `Could not read the branches: ${branches.error}`);
  }

  const graph = loadGraph(state.repoDir, {});
  if (!graph.ok) {
    return withMessage(state, `Could not read the history: ${graph.error}`);
  }

  const rows = branchRows(branches.branches);
  const opened = {
    ...clearTransient(state),
    history: pushPlace(state.history, state),
    view: VIEW_LOG,
    openPath: null,
    log: {
      // Every branch to begin with: the question the log answers is what shape the
      // repository is in, and one branch of it is not that shape.
      ref: null,
      // And every parent of every commit. The trunk leaves commits out, and a graph
      // that opened already leaving some out would be one nobody asked for.
      firstParent: false,
      // And everybody's work, for the same reason
      author: null,
      rows: graph.rows,
      cursor: Math.max(0, commitRowNear(graph.rows, 0, 1)),
      scroll: 0,
      graphWidth: graphWidth(graph.rows),
      branches: branches.branches,
      branchRows: rows,
      // Opened on the branch the reader is standing on, which is the one they are most
      // likely to want and the one they can otherwise only find by scrolling
      branchCursor: Math.max(0, refIndexOf(rows, currentBranch(state.repoDir))),
      branchScroll: 0,
      // How old the ↑ and ↓ beside those branches are — see fetchedLabel
      fetched: fetchedLabel(state.repoDir),
      focus: FOCUS_GRAPH,
    },
  };

  return showCommitAtCursor(opened);
}

/** Move the graph cursor, loading whatever commit it comes to rest on. */
function moveGraph(state, delta, height) {
  const rows = state.log.rows;
  if (rows.length === 0) {
    return state;
  }

  const direction = delta >= 0 ? 1 : -1;
  const target = Math.max(0, Math.min(state.log.cursor + delta, rows.length - 1));
  const found = commitRowNear(rows, target, direction);

  if (found === -1 || found === state.log.cursor) {
    return clearTransient(state);
  }

  const moved = withGraph(state, rows, found, scrollToCursor(state.log.scroll, found, height));
  return showCommitAtCursor(moved);
}

/** Move the branch cursor, over the headings between the groups. */
function moveBranches(state, delta, height) {
  const rows = state.log.branchRows;
  const direction = delta >= 0 ? 1 : -1;
  const target = Math.max(0, Math.min(state.log.branchCursor + delta, rows.length - 1));
  const found = branchRowNear(rows, target, direction);

  if (found === -1 || found === state.log.branchCursor) {
    return clearTransient(state);
  }

  return {
    ...clearTransient(state),
    log: {
      ...state.log,
      branchCursor: found,
      branchScroll: scrollToCursor(state.log.branchScroll, found, height),
    },
  };
}

/**
 * Rows the focused pane has.
 *
 * The reducer is handed the whole body's height, and no pane of this screen is that
 * tall. Paging by it would have `d` in a thirteen-row graph jump twenty commits — the
 * clamp keeps that safe but not useful — so the pane's own height is what the movement
 * keys are given.
 */
function paneHeight(state, viewport) {
  const layout = logLayoutOf(state, viewport);
  const focus = state.log.focus;

  if (focus === FOCUS_BRANCHES || focus === FOCUS_GRAPH) {
    return Math.max(1, layout.logHeight);
  }
  return Math.max(1, layout.diffHeight);
}

/**
 * Move whichever pane has the focus.
 * The lower two are the diff view's own, moved by the diff view's own transitions, so
 * that a file list here behaves exactly as a file list there.
 *
 * @param {number} height Rows the focused pane has — see paneHeight
 */
function moveLog(state, delta, height) {
  if (state.log.focus === FOCUS_BRANCHES) {
    return moveBranches(state, delta, height);
  }
  if (state.log.focus === FOCUS_GRAPH) {
    return moveGraph(state, delta, height);
  }
  if (state.log.focus === FOCUS_PANEL) {
    return withSelection(state, state.selectedIndex + delta);
  }
  return withCursor(state, state.cursor + delta, height);
}

/**
 * Whether the log is showing with a given pane in focus.
 *
 * A state whose log has never been opened has no focus to be anywhere, and saying so
 * once here is what keeps that guard out of the three callers below.
 */
function logFocusIs(state, focus) {
  return state.log !== null && state.log !== undefined && state.log.focus === focus;
}

/**
 * Whether the row cursor is the thing the movement keys are moving, and whether what
 * it is pointing at is a line — which are the same question.
 *
 * Everywhere but the log, it always is: j and k move the cursor down the lines and n
 * and p move the file list, and neither takes a turn at being the other. The log has
 * four places for the focus to be and only one of them is the diff the cursor points
 * into, so it is the one screen where the answer can be no.
 *
 * The reducer asks it to decide whether a comment key has a line to work on, and the
 * screen model asks it to decide whether to draw the cursor. Both are this question,
 * and the focus names it switches on are this module's, so it is answered here.
 */
function cursorIsLive(state) {
  return state.view === VIEW_LOG ? logFocusIs(state, FOCUS_DIFF) : true;
}

/**
 * Whether the file panel is one of the things the reader is working in.
 *
 * In the diff view it always is — n and p move it whatever the cursor is doing. In the
 * log it is one pane of four, and shows its selection only while it has the focus.
 */
function panelIsLive(state) {
  return state.view === VIEW_LOG ? logFocusIs(state, FOCUS_PANEL) : true;
}

/** Step the focus round the four panes. */
function cycleLogFocus(state, delta) {
  const at = FOCUS_ORDER.indexOf(state.log.focus);
  const next = FOCUS_ORDER[(at + delta + FOCUS_ORDER.length) % FOCUS_ORDER.length];
  return { ...clearTransient(state), log: { ...state.log, focus: next } };
}

/**
 * Open the commit under the graph cursor in the whole pane.
 *
 * The diff under the graph is a glance — four rows of it on a short terminal — and
 * this is the same commit with the screen to itself. Ctrl+O brings the log back, with
 * the cursor still on the commit it was opened from.
 */
function openChosenCommit(state) {
  const commit = commitAtCursor(state);
  if (commit === null) {
    return state;
  }

  const pushed = pushPlace(state.history, state);
  const loaded = tryCommitDiff({ ...state, view: VIEW_DIFF }, commit);
  if (!loaded.ok) {
    return withMessage(state, loaded.message);
  }

  return recordVisit(
    {
      ...loaded.state,
      history: pushed,
      focus: "panel",
      message: `${commit.shortSha} ${commit.subject}`,
    },
    commitEntry(commit)
  );
}

/** Narrow the graph to the branch under the branch cursor. */
function narrowToBranch(state) {
  const branch = branchAt(state.log.branchRows, state.log.branchCursor);
  if (branch === null) {
    return state;
  }
  return withScope(state, scopeOf(state, { ref: branch.name }));
}

/**
 * What Enter means, which depends on which pane is holding it.
 *
 * The branch list narrows the graph; everywhere else it opens the commit the graph is
 * on. The diff under the graph is a glance at that commit, and the file panel is a
 * list of its files, so "open this" means the same thing from all three.
 */
function chooseInLog(state) {
  if (state.log.focus === FOCUS_BRANCHES) {
    return narrowToBranch(state);
  }
  return openChosenCommit(state);
}

/**
 * Swap between every branch and the one HEAD is on.
 *
 * Two questions, one key. "What shape is this repository in" wants every branch;
 * "what have I been doing" wants one, and the one is almost always the current branch —
 * so that is what the toggle goes to rather than reopening the branch list to say it.
 */
function toggleLogScope(state) {
  const ref = state.log.ref === null ? currentBranch(state.repoDir) : null;
  return withScope(state, scopeOf(state, { ref }));
}

/**
 * Follow the trunk of this branch, or every parent again.
 *
 * A merge is a branch somebody else finished, and reading someone else's work is one
 * of those at a time: what landed, in the order it landed. `--first-parent` is git's
 * answer to it — the merge is a row and the commits that came in through it are not
 * beside it, so a graph of a hundred rows becomes the twenty things that happened.
 *
 * It says so twice, the way the diff's own two settings do: once when it is pressed,
 * and in the header for as long as it is on. A graph quietly leaving commits out is
 * not one to be left holding without knowing.
 */
function toggleFirstParent(state) {
  const firstParent = state.log.firstParent !== true;

  return withScope(
    state,
    scopeOf(state, { firstParent }),
    firstParent ? "Following the trunk — a merge is one row" : "Following every parent again"
  );
}

/**
 * Mark the commit the graph is on as read, or unread when it already is.
 *
 * `V` in the diff view marks a file of a change; this is the same key asking the same
 * thing one size up, which is the size a reader following somebody's work counts in.
 *
 * The graph's commit whichever pane has the focus. The lower half of this screen is
 * that commit's own diff and the panel is its own list of files, so there is one commit
 * on the screen to have been read and all four panes are looking at it.
 */
function toggleCommitRead(state) {
  const commit = commitAtCursor(state);
  if (commit === null) {
    return withMessage(state, MESSAGE_NO_COMMIT);
  }

  const { marks, read } = toggleRead(state.readCommits || [], commit.sha);

  return {
    ...clearTransient(state),
    readCommits: marks,
    effect: { type: "save-read-commits" },
    message: `${read ? "Read" : "Unread"}: ${commit.shortSha} ${commit.subject}`,
  };
}

/**
 * Open the field an author's name is typed into.
 *
 * Prefilled: with the name already chosen where there is one, so it can be typed over
 * or cleared, and otherwise with the author of the commit under the cursor. A reader
 * asking whose work this is is looking at a commit of theirs — the same reason `#`
 * opens with the word under the cursor already in it.
 */
function openAuthorFilter(state) {
  const commit = commitAtCursor(state);
  const chosen = state.log.author || (commit === null ? "" : commit.author);

  return { ...clearTransient(state), input: { kind: INPUT_AUTHOR, text: chosen } };
}

/**
 * Narrow the graph to one person's commits, or widen it to everybody again.
 *
 * Reading somebody else's work is the whole of what a graph is for here: one developer
 * whose changes are worth following, read in the order they landed. An empty field is
 * how that is undone, because the reader who wants everybody back is standing in the
 * field with a name in it.
 */
function withAuthor(state, typed) {
  const author = typed.trim();
  const cleared = { ...state, input: null };

  return withScope(
    cleared,
    scopeOf(state, { author: author === "" ? null : author }),
    author === "" ? "Everybody's commits again" : `Only ${author}`
  );
}

/**
 * Read the graph again, keeping the reader on the commit they were reading.
 *
 * Followed by sha rather than by row: a commit landing while the log is open pushes
 * every row below it down by one, and a reader watching an agent work should not be
 * moved off what they were looking at every time it commits.
 */
function reloadLog(state, viewport) {
  const graph = loadGraph(state.repoDir, scopeOf(state));
  if (!graph.ok) {
    return withMessage(state, `Could not read the history: ${graph.error}`);
  }

  const was = commitAtCursor(state);
  const found =
    was === null
      ? -1
      : graph.rows.findIndex((row) => row.commit !== null && row.commit.sha === was.sha);
  const cursor = found === -1 ? Math.max(0, commitRowNear(graph.rows, 0, 1)) : found;
  const height = logLayoutOf(state, viewport).logHeight;

  const branches = loadBranches(state.repoDir);
  const refreshed = withGraph(
    state,
    graph.rows,
    cursor,
    scrollToCursor(state.log.scroll, cursor, height)
  );

  // A branch list that could not be read is left as it was rather than emptied: the
  // graph is what the reload was for, and half an answer beats half a screen.
  if (!branches.ok) {
    return showCommitAtCursor(refreshed);
  }

  const rows = branchRows(branches.branches);
  return showCommitAtCursor({
    ...refreshed,
    log: {
      ...refreshed.log,
      branches: branches.branches,
      branchRows: rows,
      branchCursor: Math.max(
        0,
        refIndexOf(rows, branchNameAt(state.log.branchRows, state.log.branchCursor))
      ),
      fetched: fetchedLabel(state.repoDir),
    },
  });
}

/** The name of the branch a cursor is on, for finding it again in a rebuilt list. */
function branchNameAt(rows, index) {
  const branch = branchAt(rows, index);
  return branch === null ? null : branch.name;
}

/**
 * Ask every remote what it has.
 *
 * The one thing on this screen the reader cannot work out by looking: `↓3` is read
 * from a copy of the remote made when it was last fetched, so a branch with nothing
 * beside it is either level with the other end or simply has not been asked lately.
 * This is the asking. Nothing local moves — see lib/git-remote — which is why it goes
 * ahead on one keystroke where a pull asks first.
 */
function requestFetch(state) {
  if (remoteNames(state.repoDir).length === 0) {
    return withMessage(state, "No remote to fetch from");
  }
  return { ...clearTransient(state), effect: { type: "fetch" } };
}

/**
 * Take what has arrived onto the branch that is checked out, having said so first.
 *
 * Two presses, the way quitting with unsent comments is two. Everything else this
 * plugin does can be undone by pressing something else; this one changes the files
 * under the reader, and the first press is where it says which branch, from where, how
 * much is coming, and whether taking it means a merge.
 *
 * A branch with commits at both ends is one of those merges rather than a refusal. It
 * was refused while the pane had no way to draw a conflict; it has one now, and git
 * settles most of a merge on its own — what it cannot settle lands in a list with the
 * keys to settle it. What is still refused is what a pull cannot mean: a detached HEAD
 * has no branch to pull into, a branch that follows nothing has nowhere to pull from,
 * and a merge already stopped halfway has to be finished before another begins.
 */
function requestPull(state) {
  const branch = headBranchOf(state.log.branches);

  if (isMergingNow(state.merge)) {
    return withMessage(state, "A merge is already in progress — M lists what is left");
  }
  if (branch === null) {
    return withMessage(state, "Not on a branch — nothing to pull into");
  }
  if (branch.track === null || branch.track === undefined) {
    return withMessage(state, `${branch.name} follows no branch — nothing to pull`);
  }
  if (branch.track.gone) {
    return withMessage(state, `${branch.track.upstream} is gone — nothing to pull`);
  }

  if (state.pendingPull === true) {
    return { ...clearTransient(state), pendingPull: false, effect: { type: "pull" } };
  }

  const coming = trackingLabel(branch.track);
  const much = coming === "" ? "" : ` ${coming}`;
  // A branch with work of its own cannot fast-forward, so what is being agreed to is a
  // merge commit — and a merge is the one that can stop and ask the reader something
  const how = branch.track.ahead > 0 && branch.track.behind > 0 ? " as a merge" : "";

  return {
    ...state,
    pendingPull: true,
    effect: null,
    message: `Pull ${branch.name} from ${branch.track.upstream}${much}${how} — press p again`,
  };
}

/**
 * Send this branch's commits to the remote, having said what and where first.
 *
 * The one key here that changes something nobody in this repository can undo. A pull
 * moves the reader's own files and a fetch moves nobody's; this puts commits somewhere
 * other people read from, and taking them back out is their afternoon as well as the
 * reader's. So it asks, the way `p` does, and the first press names the count, the
 * branch and the remote.
 *
 * Four states refuse before the network is troubled. A detached HEAD has no branch to
 * send. A branch with nothing of its own has nothing to send. A branch that is behind
 * would be refused by the other end anyway, because sending it would drop what arrived
 * there — `p` is the answer to that and it is one key away. And a branch whose upstream
 * is a local one, or whose repository has several remotes and no `origin`, has nowhere
 * this can pick for it.
 */
function requestPush(state) {
  const branch = headBranchOf(state.log.branches);

  if (branch === null) {
    return withMessage(state, "Not on a branch — nothing to push");
  }

  const track = branch.track;
  const ahead = track === null || track === undefined ? 0 : track.ahead;
  const behind = track === null || track === undefined ? 0 : track.behind;

  if (track !== null && track !== undefined && !track.gone && ahead === 0) {
    return withMessage(state, `${describeTracking(branch)} — nothing to push`);
  }
  if (behind > 0) {
    return withMessage(state, `${describeTracking(branch)} — pull it first`);
  }

  const target = pushTarget(branch, remoteNames(state.repoDir));
  if (target === null) {
    return withMessage(state, `Nowhere to push ${branch.name} to`);
  }

  if (state.pendingPush === true) {
    return {
      ...clearTransient(state),
      pendingPush: false,
      effect: { type: "push", target, branch: branch.name },
    };
  }

  // A branch nobody has seen yet says so rather than counting: it is all of it, and
  // the count would be answering a question about a copy that does not exist
  const what = target.setUpstream
    ? `Push ${branch.name} to ${target.remote} and follow it`
    : `Push ${ahead} ${ahead === 1 ? "commit" : "commits"} from ${branch.name} to ${track.upstream}`;

  return { ...state, pendingPush: true, effect: null, message: `${what} — press P again` };
}

module.exports = {
  FOCUS_BRANCHES,
  FOCUS_DIFF,
  FOCUS_GRAPH,
  FOCUS_PANEL,
  branchRowNear,
  chooseInLog,
  commitAtCursor,
  commitRowNear,
  cursorIsLive,
  cycleLogFocus,
  moveLog,
  panelIsLive,
  paneHeight,
  openAuthorFilter,
  openLog,
  reloadLog,
  requestFetch,
  requestPull,
  requestPush,
  toggleCommitRead,
  toggleFirstParent,
  toggleLogScope,
  withAuthor,
};
