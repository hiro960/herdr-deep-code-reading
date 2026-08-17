"use strict";

// What the reducer asks the outside world to do, and the doing of it.
//
// The reducer is pure: it answers a key with a new state and, when the key needs
// something of the world, an `effect` describing it. This is where those are carried
// out — writing to git, spawning an editor, pasting into an agent's pane — and every
// one of them answers with a state again, so the loop above stays a fold over keys.
//
// A failure here is a message in the footer, never an exception. The reviewer's
// comments live only for the session, and taking the pane down over a failed stage
// would take them with it.

const { spawn, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const { reloaded, reloadedInPlace } = require("../app-state");
const { saveBookmarks } = require("../bookmarks");
const { saveViewed } = require("../viewed");
const { saveReadCommits } = require("../read-commits");
const { saveJournal } = require("../journal");
const { formatReading, readingFilename } = require("../reading-export");
const { formatBatch } = require("../comments");
const { editorInvocation } = require("../editor");
const { resolveInsideRepo, resolveNewInsideRepo } = require("../file-view");
const { createBrowse } = require("../browse-state");
const { listRepoPaths } = require("../git");
const { openChosenFile } = require("../state/views");
const gitWrite = require("../git-write");
const gitRemote = require("../git-remote");
const gitMerge = require("../git-merge");
const { isMerging, pathsWithMarkers, unresolvedOf } = require("../merge");
const { headBranchOf } = require("../refs");
const { describeTracking } = require("../upstream");
const { reloadLog } = require("../state/log");
const { openConflicts, refreshConflicts } = require("../state/views/conflicts");
const { revealCommand, unsupportedMessage } = require("../reveal");
const { agentLabel, candidateAgents, listAgents, sendToPane } = require("../send");
const { isStaged, isUnstaged } = require("../status");
// A failure here is a message and nothing asked of the world, which is what this says.
// The reducers have been writing their refusals with it since the beginning; these are
// the same shape, and writing it out by hand twenty times is how one of them ends up
// carrying a stale effect into the next frame — see lib/state/messages.
const { withMessage } = require("../state/messages");
const { DIRECTORY_MODE, FILE_MODE, stateDirectory } = require("../store");
const { openSpec } = require("../state/views/pane");
const { FULL_SCREEN, viewportHeight } = require("./terminal");

const MAX_PICKER_AGENTS = 9;
const EXPORT_FILENAME = "review-comments.md";
// Where a crash puts the review, under a name of its own. The reviewer may have
// exported deliberately earlier in the session, and overwriting the batch they meant
// to keep with whatever was in hand when something broke would be its own small loss.
const CRASH_FILENAME = "review-comments-crash.md";

function herdrBin() {
  return process.env.HERDR_BIN_PATH || "herdr";
}

/**
 * Write a batch of comments to disk.
 * Two callers want this: an export the reviewer asked for, and a crash they did not.
 * @returns {{ok: true, path: string}|{ok: false, error: string}}
 */
function writeComments(text, filename) {
  // The same directory every store is kept in, and written the same way: what is in
  // here is the reviewer's own words and the code they quote — see lib/store.
  const directory = stateDirectory(process.env);

  try {
    fs.mkdirSync(directory, { recursive: true, mode: DIRECTORY_MODE });
    const target = path.join(directory, filename);
    fs.writeFileSync(target, text, { mode: FILE_MODE });
    return { ok: true, path: target };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

/**
 * What is about to be pasted, and what to say once it has gone.
 *
 * Two things travel this path now. A review, which is a batch of comments the reader
 * chose, and a question, which is one message written for the agent to answer. They
 * differ in the text and in the sentence afterwards and in nothing else, so this is
 * the one place that knows which of the two it is.
 */
function outgoing(state, effect) {
  if (effect !== null && effect !== undefined && effect.message !== undefined) {
    return { text: effect.message, said: "Asked", noun: "question" };
  }

  const comments =
    effect === null || effect === undefined || effect.comments === undefined
      ? state.comments
      : effect.comments;
  const noun = comments.length === 1 ? "comment" : "comments";

  return { text: formatBatch(comments), said: `Pasted ${comments.length} ${noun}`, noun, comments };
}

/** Write what was going out to disk when no agent is available to receive it. */
function exportToFile(state, batch) {
  const written = writeComments(batch.text, EXPORT_FILENAME);

  if (!written.ok) {
    return withMessage(state, `No agent found, and the export failed: ${written.error}`);
  }
  return withMessage(state, `No agent found. Written to ${written.path}`);
}

/**
 * Save the review on the way out of a crash.
 *
 * A comment lives for the session, which makes an uncaught error the one exit that
 * throws a whole review away without asking — the quit key has asked since the
 * beginning. What is left is written where it can be found, and what happened to it
 * is said on stderr beside the stack.
 *
 * @returns {string} What to add to the crash report; empty when there was nothing
 */
function rescueComments(comments) {
  if (comments === undefined || comments === null || comments.length === 0) {
    return "";
  }

  const noun = comments.length === 1 ? "comment" : "comments";
  const written = writeComments(formatBatch(comments), CRASH_FILENAME);

  return written.ok
    ? `herdr-deep-code-reading: ${comments.length} unsent ${noun} written to ${written.path}\n`
    : `herdr-deep-code-reading: ${comments.length} unsent ${noun} could not be saved: ${written.error}\n`;
}

/**
 * Paste the comments into an agent's input.
 * The comments are kept afterwards: the paste is not submitted, so the reviewer may
 * still edit or discard it, and losing a written review would be worse than sending twice.
 */
function deliver(state, agent, batch) {
  const going = batch === undefined ? outgoing(state, null) : batch;
  const result = sendToPane(herdrBin(), agent.pane_id, going.text);

  if (!result.ok) {
    return withMessage(state, `Send failed: ${result.error}`);
  }

  return {
    ...state,
    effect: null,
    message: `${going.said} into ${agent.agent} — not submitted`,
  };
}

/**
 * Find the agents that could receive the comments and decide what to do.
 *
 * The batch arrives on the effect rather than being read off the state, because the
 * reader has just chosen which comments are in it and the state goes on holding all
 * of them — they are kept after a send, and always have been.
 */
function beginSend(state, batch) {
  const going = batch === undefined ? outgoing(state, null) : batch;
  const { ok, agents, error } = listAgents(herdrBin());
  if (!ok) {
    return withMessage(state, `Could not list agents: ${error}`);
  }

  const candidates = candidateAgents(agents, {
    workspaceId: process.env.HERDR_WORKSPACE_ID,
    excludePaneId: process.env.HERDR_PANE_ID,
  });

  if (candidates.length === 0) {
    return exportToFile(state, going);
  }
  if (candidates.length === 1) {
    return deliver(state, candidates[0], going);
  }

  return {
    ...state,
    effect: null,
    picker: {
      count: going.comments === undefined ? 1 : going.comments.length,
      // What is going travels with the picker: by the time one is chosen, the effect
      // that carried it has been performed and cleared
      batch: going,
      agents: candidates
        .slice(0, MAX_PICKER_AGENTS)
        .map((agent) => ({ ...agent, label: agentLabel(agent) })),
    },
  };
}

/**
 * Decide whether a file should be staged or unstaged.
 * A file that is staged and has no further worktree changes is toggled off;
 * anything else is staged, which also picks up changes made after an earlier stage.
 */
function shouldUnstage(gitStatus) {
  if (typeof gitStatus !== "string" || gitStatus.length < 2) {
    return false;
  }
  const entry = { index: gitStatus[0], worktree: gitStatus[1] };
  return isStaged(entry) && !isUnstaged(entry);
}

/**
 * Stage or unstage one file, then reload so the panel and the diff agree.
 * A rename carries both of its paths, which must move together.
 */
function toggleStage(state, effect) {
  const unstaging = shouldUnstage(effect.gitStatus);
  const result = unstaging
    ? gitWrite.unstagePath(state.repoDir, effect.paths)
    : gitWrite.stagePath(state.repoDir, effect.paths);

  if (!result.ok) {
    const verb = unstaging ? "Unstage" : "Stage";
    return withMessage(state, `${verb} failed: ${result.error}`);
  }

  return reloaded(state, `${unstaging ? "Unstaged" : "Staged"} ${effect.label}`);
}

function stageAll(state) {
  const result = gitWrite.stageAll(state.repoDir);
  if (!result.ok) {
    return withMessage(state, `Stage all failed: ${result.error}`);
  }
  return reloaded(state, "Staged every change");
}

/**
 * The first line of a message, which is what a commit is known by.
 * The footer has one row for a message, and a body written into it would push every
 * row of the diff below it down by however many lines the reviewer wrote.
 */
function subjectOf(message) {
  return message.split("\n")[0];
}

/** Commit what is staged, reporting git's own error when it refuses. */
function performCommit(state, message) {
  const staged = gitWrite.hasStagedChanges(state.repoDir);
  if (!staged.ok) {
    return withMessage(state, `Could not read the index: ${staged.error}`);
  }
  if (!staged.staged) {
    return withMessage(state, "Nothing staged to commit");
  }

  const result = gitWrite.commit(state.repoDir, message);
  if (!result.ok) {
    return withMessage(state, `Commit failed: ${subjectOf(result.error)}`);
  }

  return reloaded(state, `Committed: ${subjectOf(message)}`);
}

// git writes its advice before its verdict: a `pull --ff-only` that cannot fast-forward
// prints six lines of hint and then the one line saying what actually happened. The
// footer has room for one line, and it has to be that one.
const HINT_PREFIX = "hint:";
const VERDICT_PREFIXES = ["fatal:", "error:"];

/** The one line of git's complaint worth putting in the footer. */
function gitComplaint(text) {
  const lines = (text || "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");

  if (lines.length === 0) {
    return "no reason given";
  }

  const verdict = lines.find((line) => VERDICT_PREFIXES.some((mark) => line.startsWith(mark)));
  const spoken = lines.find((line) => !line.startsWith(HINT_PREFIX));

  return verdict || spoken || lines[0];
}

/**
 * Read the log again after talking to a remote, and say where the branch now stands.
 *
 * Both calls end here because both change the same two things: what the copies under
 * `refs/remotes` say, and therefore what the counts beside the branches do. A pull
 * changes a third — the files themselves — which the reload picks up in the same pass.
 *
 * A reload that had something to complain about keeps its own message: "the graph would
 * not read" is more use than "fetched", and the footer has room for one of them.
 */
function afterRemote(state, said) {
  const cleared = { ...state, effect: null };

  // The keys are the log's own, so this is where they come from; a pane that somehow
  // got here from elsewhere still gets its diff read again rather than nothing.
  if (cleared.log === null || cleared.log === undefined) {
    return reloaded(cleared, said);
  }

  const refreshed = reloadLog(cleared, viewportHeight(cleared));
  if (refreshed.message !== null) {
    return refreshed;
  }

  return withMessage(refreshed, `${said} — ${describeTracking(headBranchOf(refreshed.log.branches))}`);
}

/**
 * Ask every remote what it has.
 * Nothing local moves, so there is nothing here to undo when it fails — the counts on
 * screen are simply as old as they were.
 */
function performFetch(state) {
  const result = gitRemote.fetch(state.repoDir);
  if (!result.ok) {
    return withMessage(state, `Fetch failed: ${gitComplaint(result.error)}`);
  }
  return afterRemote(state, "Fetched");
}

/**
 * Take what has arrived onto the branch that is checked out.
 *
 * The reader has already been asked — see lib/state/log — so by the time this runs the
 * only things left that can refuse are git and the two versions themselves.
 *
 * A merge that could not settle every file is not a failure. git exits non-zero either
 * way, so the exit code alone would report the ordinary end of an ordinary merge as
 * something having gone wrong: what tells them apart is MERGE_HEAD, which git writes
 * when it stops halfway and not when it refuses to start. A pull that stopped halfway
 * lands the reader in the list of what it could not settle, which is the next thing
 * they were going to do anyway.
 */
function performPull(state) {
  const result = gitRemote.pull(state.repoDir);

  if (result.ok) {
    return afterRemote(state, "Pulled");
  }

  // Asked of the repository rather than of the state in hand: what happened happened a
  // moment ago, in the process that just ran, and MERGE_HEAD is where it is written
  if (!isMerging(state.repoDir)) {
    return withMessage(state, `Pull failed: ${gitComplaint(result.error)}`);
  }

  const stopped = openConflicts({ ...state, effect: null });
  const left = unresolvedOf(stopped.merge).length;
  const noun = left === 1 ? "file" : "files";

  return { ...stopped, message: `Pulled — ${left} ${noun} to resolve` };
}

/**
 * Send this branch's commits out.
 *
 * The one thing this pane does that other people see. What git says when it refuses is
 * what the footer says: a rejected push is almost always a branch that moved at the
 * other end, and git's own sentence about it names the ref — which is more use than
 * anything this could write over it.
 */
function performPush(state) {
  const result = gitRemote.push(state.repoDir, state.effect.target, state.effect.branch);
  if (!result.ok) {
    return withMessage(state, `Push failed: ${gitComplaint(result.error)}`);
  }
  return afterRemote(state, "Pushed");
}

/**
 * Take one side of a conflicted file, or say the reader's own edit of it is finished.
 *
 * One effect for the three because they end the same way: git is asked, the list is
 * read again, and the footer says where the merge now stands. Which of them it is
 * rides on the effect, the way the stage effect carries whether it is staging.
 */
function performResolve(state, effect) {
  const taking = effect.side !== null && effect.side !== undefined;
  const result = taking
    ? gitMerge.takeSide(state.repoDir, effect.path, effect.code, effect.side)
    : gitMerge.markResolved(state.repoDir, effect.path);

  if (!result.ok) {
    const verb = taking ? `Taking ${effect.side} of ${effect.path}` : `Resolving ${effect.path}`;
    return withMessage(state, `${verb} failed: ${gitComplaint(result.error)}`);
  }

  const said = taking
    ? `Took ${effect.side}: ${effect.path}`
    : markerWarning(state, effect.path) || `Resolved: ${effect.path}`;

  return refreshConflicts({ ...state, effect: null }, said);
}

/**
 * What to say about a file marked resolved that still holds the markers git wrote.
 *
 * Said rather than refused. `<<<<<<<` at the start of a line is something a file may
 * carry for its own reasons — this repository's own tests carry several — and a tool
 * that would not let the reader finish over it would be refusing work that is theirs
 * to decide. Saying it once is what a reader who forgot a third conflict further down
 * the file needs, and it is what `C` asks about again before the commit is made.
 *
 * @returns {string|null} null when the file is clean, or cannot be read at all
 */
function markerWarning(state, filePath) {
  const marked = pathsWithMarkers(state.repoDir, [filePath]);
  return marked.length === 0 ? null : `Resolved: ${filePath} — but it still has conflict markers`;
}

/**
 * Finish the merge with the message git wrote for it.
 * git refuses while anything is still unmerged and says so, which is a better guard
 * than anything here — see lib/git-merge.
 */
function performMergeCommit(state) {
  const result = gitMerge.commitMerge(state.repoDir);
  if (!result.ok) {
    return withMessage(state, `Merge commit failed: ${gitComplaint(result.error)}`);
  }
  return refreshConflicts({ ...state, effect: null }, `Merged: ${subjectOf(result.output)}`);
}

/**
 * Put the repository back where it was before the merge.
 * Everything resolved goes with it, which is why the key asked twice.
 */
function performMergeAbort(state) {
  const result = gitMerge.abortMerge(state.repoDir);
  if (!result.ok) {
    return withMessage(state, `Undoing the merge failed: ${gitComplaint(result.error)}`);
  }
  return refreshConflicts({ ...state, effect: null }, "The merge is undone");
}

/**
 * Show a path in the desktop's own file manager.
 *
 * The path goes through the same containment check every read does. git tracks
 * symlinks, so a repository can carry one pointing anywhere on the machine, and
 * handing that to Finder would take the reader somewhere this tool promised not to
 * go — the fact that nothing is read on the way does not change what is opened.
 *
 * The file manager is launched detached and its output discarded: it outlives the
 * pane, and a window manager writing to a terminal in raw mode would corrupt it.
 *
 * @param {function} [spawnChild] How to launch it, the way editFile takes its screen.
 *   The test for this cannot use the real one: opening a window on the machine running
 *   the suite is not something a test is allowed to do.
 */
function revealPath(state, target, runtime, spawnChild) {
  const resolved = resolveInsideRepo(state.repoDir, target);
  if (!resolved.ok) {
    return withMessage(state, resolved.reason);
  }

  let isDirectory;
  try {
    isDirectory = fs.statSync(resolved.path).isDirectory();
  } catch (error) {
    return withMessage(state, `Cannot show ${target}: ${error.code || error.message}`);
  }

  const opener = revealCommand(process.platform, resolved.path, isDirectory);
  if (opener === null) {
    return withMessage(state, unsupportedMessage(process.platform));
  }

  const launch = spawnChild === undefined ? spawn : spawnChild;

  try {
    const child = launch(opener.command, opener.args, { detached: true, stdio: "ignore" });
    // A missing opener — xdg-open is not on every Linux — reports itself on an
    // event a tick later rather than by throwing. Left unheard, the footer would
    // be claiming to have shown something the desktop never received.
    child.on("error", (error) => {
      if (runtime && runtime.report) {
        runtime.report(`Could not run ${opener.command}: ${error.message}`);
      }
    });
    child.unref();
  } catch (error) {
    return withMessage(state, `Could not run ${opener.command}: ${error.message}`);
  }

  return withMessage(state, `Showing ${target === "" ? "the repository" : target}`);
}

/**
 * Write the saved places back to disk.
 *
 * The state already holds the new list — toggling is pure — so this is the write and
 * nothing else. A failure keeps the bookmark on screen and says the save did not
 * happen, rather than silently dropping it or pretending it was kept.
 */
function persistBookmarks(state) {
  const result = saveBookmarks(state.bookmarksFile, state.repoDir, state.bookmarks);
  if (!result.ok) {
    return withMessage(state, `Bookmarks could not be saved: ${result.error}`);
  }
  return { ...state, effect: null };
}

/**
 * Ask Herdr for a second pane of this plugin, beside this one, at a place.
 *
 * The same call bin/open.js makes to open the first one, with a split placement and
 * the place in the environment. Herdr starts another copy of the plugin, which reads
 * HERDR_DEEP_CODE_READING_OPEN and lands there — see lib/state/views/pane.js.
 */
function openPaneBeside(state, place) {
  const result = spawnSync(
    herdrBin(),
    [
      "plugin",
      "pane",
      "open",
      "--plugin",
      process.env.HERDR_PLUGIN_ID || "herdr-deep-code-reading",
      "--entrypoint",
      "review",
      "--placement",
      "split",
      "--env",
      `HERDR_DEEP_CODE_READING_REPO=${state.repoDir}`,
      "--env",
      "HERDR_DEEP_CODE_READING_MODE=files",
      "--env",
      `HERDR_DEEP_CODE_READING_OPEN=${openSpec(place)}`,
      "--focus",
    ],
    { encoding: "utf8" }
  );

  if (result.error) {
    return withMessage(state, `Could not start herdr: ${result.error.message}`);
  }
  if (result.status !== 0) {
    const detail = (result.stderr || "").trim();
    return withMessage(state, `Could not open the pane: ${detail}`);
  }

  return { ...state, effect: null };
}

/**
 * Write the read marks back to disk.
 * The state already holds the new list, so this is the write and nothing else — the
 * same arrangement the bookmarks have, and it fails the same way.
 */
function persistViewed(state) {
  const result = saveViewed(state.viewedFile, state.repoDir, state.viewed);
  if (!result.ok) {
    return withMessage(state, `Read marks could not be saved: ${result.error}`);
  }
  return { ...state, effect: null };
}

/**
 * Write the read commits back to disk.
 * The same arrangement the bookmarks and the file marks have, and it fails the same
 * way: the mark stays on screen and the footer says the save did not happen.
 */
function persistReadCommits(state) {
  const result = saveReadCommits(state.readCommitsFile, state.repoDir, state.readCommits);
  if (!result.ok) {
    return withMessage(state, `Read commits could not be saved: ${result.error}`);
  }
  return { ...state, effect: null };
}

/**
 * Write the record of what has been read back to disk.
 *
 * The stamping happens here rather than where the visit is recorded: a clock is the
 * world, and the reducers are pure. What is written goes back on the state, so the list
 * in hand and the list on disk never disagree about when something was read.
 *
 * @param {function(): number} [now] The clock, for a test that needs a fixed one
 */
function persistJournal(state, now) {
  const clock = now === undefined ? Date.now : now;
  const stamped = state.journal.map((entry) =>
    entry.at === undefined ? { ...entry, at: clock() } : entry
  );

  const result = saveJournal(state.journalFile, state.repoDir, stamped);
  if (!result.ok) {
    return withMessage({ ...state, journal: stamped }, `Reading could not be saved: ${result.error}`);
  }
  return { ...state, journal: stamped, effect: null };
}

/**
 * Write the reading out as one markdown document.
 *
 * The one thing here that leaves with the reader. Everything else the plugin writes is
 * its own bookkeeping; this is the afternoon they spent, in a file they own, and it is
 * written only when they ask for it.
 *
 * @param {function(): number} [now] The clock, for a test that needs a fixed day
 */
function exportReading(state, now) {
  const when = (now === undefined ? Date.now : now)();
  const text = formatReading(state, when);

  if (text === "") {
    return withMessage(state, "Nothing read yet to write out");
  }

  const written = writeComments(text, readingFilename(state.repoDir, when));
  if (!written.ok) {
    return withMessage(state, `The reading could not be written: ${written.error}`);
  }
  return withMessage(state, `Reading written to ${written.path}`);
}

/**
 * Show the file that has just been made, in the reader that `E` works from.
 *
 * The browser's listing is read again first, and rebuilt: it is derived from the paths
 * git lists, and the new file is not in the list this pane started with. It is rebuilt
 * rather than patched so that a filter left over from before does not decide whether
 * the file that was just named is visible.
 *
 * Recorded in the journal, through the same open a file chosen from the browser goes
 * through: deciding a file should exist and opening it is exactly the sort of thing
 * yesterday's reading is looked back at for. The write is done here rather than left on
 * the state, because the effect that would have carried it has already been performed.
 */
function openCreated(state, filePath) {
  const paths = listRepoPaths(state.repoDir);
  const dir = state.browse === null || state.browse === undefined ? "" : state.browse.dir;
  const listing = createBrowse(paths, dir);
  const at = listing.entries.findIndex((entry) => entry.path === filePath);

  const opened = openChosenFile(
    {
      ...state,
      effect: null,
      repoPaths: paths,
      browse: at === -1 ? listing : { ...listing, index: at },
    },
    filePath
  );

  const saved = persistJournal(opened);
  return saved.message === null ? withMessage(saved, `Created ${filePath}`) : saved;
}

/**
 * Make an empty file, at a name the reader typed.
 *
 * The one thing this plugin creates. Three things are asked before it does: that the
 * name would land inside the repository — which a symlinked directory is enough to
 * make untrue of a name with nothing wrong with it — that nothing is there already,
 * and that git will let it be made. The directories above it are made too: a directory
 * with nothing in it does not appear in this browser at all, so "go there first" is
 * advice a reader could not take.
 *
 * The existence check comes before any of that, so that a name that cannot be made
 * does not leave the directories behind that were made for it.
 */
function performCreate(state, effect) {
  const resolved = resolveNewInsideRepo(state.repoDir, effect.path);
  if (!resolved.ok) {
    return withMessage(state, resolved.reason);
  }
  if (fs.existsSync(resolved.path)) {
    return withMessage(state, `${effect.path} already exists`);
  }

  try {
    fs.mkdirSync(path.dirname(resolved.path), { recursive: true });
    // `wx` fails rather than overwrites, which is what closes the moment between the
    // check above and this line — an agent in another pane writes files too
    fs.writeFileSync(resolved.path, "", { flag: "wx" });
  } catch (error) {
    return withMessage(state, `Could not create ${effect.path}: ${error.code || error.message}`);
  }

  return openCreated(state, effect.path);
}

/**
 * Hand the file to the reader's own editor, and take the screen back afterwards.
 *
 * This is yazi's `block = true`: the pane hides itself, the editor gets the terminal,
 * and nothing here runs again until it exits. spawnSync is what makes that true —
 * it blocks the event loop, so the stdin handler cannot fire a keystroke meant for
 * vim into the reducer.
 *
 * Coming back reloads. The file on disk is not the one whose rows are in hand, and
 * neither is the diff: the reader edited the working tree, which is what the diff is
 * of. reloadedInPlace does both and leaves the reader on the line they left from.
 *
 * The plugin's promise is untouched by this. It writes no content of its own; the
 * editor is the reader's own, launched at their keystroke, writing under their hands.
 * The empty file `a` makes is the far side of the same arrangement — see performCreate,
 * which makes something for this to open and puts nothing in it.
 */
function editFile(state, effect, fullScreen) {
  const resolved = resolveInsideRepo(state.repoDir, effect.path);
  if (!resolved.ok) {
    return withMessage(state, resolved.reason);
  }

  const { command, args } = editorInvocation(process.env, resolved.path, effect.line);
  const { leave, enter } = fullScreen === undefined ? FULL_SCREEN : fullScreen;

  leave();
  let result;
  try {
    result = spawnSync(command, args, { cwd: state.repoDir, stdio: "inherit" });
  } finally {
    // Whatever happened, the pane owns the terminal again. Leaving it in cooked mode
    // on a thrown error would take the keyboard with it.
    enter();
  }

  if (result.error) {
    const reason = result.error.code === "ENOENT" ? "not found" : result.error.message;
    return withMessage(state, `Could not run ${command}: ${reason}`);
  }

  return reloadedInPlace({ ...state, effect: null }, `Edited ${effect.path}`, viewportHeight(state));
}

/**
 * Start or stop the timer that watches the repository.
 * The only effect whose work is the runtime's rather than this module's — nothing here
 * measures time, so all it does is pass the reader's answer along.
 */
function followRepository(state, runtime) {
  if (runtime && runtime.watcher) {
    runtime.watcher.follow(state.watching);
  }
  return { ...state, effect: null };
}

// Every kind of thing the reducer can ask for, and what carrying it out means. Read as
// a table rather than as a chain of tests, for the reason the footers are — this is the
// whole vocabulary between the pure half of the pane and the world, and it is worth
// being able to see all of it at once.
const PERFORM = {
  send: (state) => beginSend(state, outgoing(state, state.effect)),
  "send-to": (state) => deliver(state, state.effect.agent, state.effect.batch),
  stage: (state) => toggleStage(state, state.effect),
  "stage-all": (state) => stageAll(state),
  commit: (state) => performCommit(state, state.effect.message),
  fetch: (state) => performFetch(state),
  pull: (state) => performPull(state),
  push: (state) => performPush(state),
  resolve: (state) => performResolve(state, state.effect),
  "commit-merge": (state) => performMergeCommit(state),
  "abort-merge": (state) => performMergeAbort(state),
  reveal: (state, runtime) => revealPath(state, state.effect.path, runtime),
  edit: (state) => editFile(state, state.effect),
  "create-file": (state) => performCreate(state, state.effect),
  "save-bookmarks": (state) => persistBookmarks(state),
  "save-viewed": (state) => persistViewed(state),
  "save-read-commits": (state) => persistReadCommits(state),
  "save-journal": (state) => persistJournal(state),
  "export-reading": (state) => exportReading(state),
  "open-pane": (state) => openPaneBeside(state, state.effect.place),
  watch: followRepository,
};

/** Carry out whatever the reducer asked the outside world to do. */
function performEffect(state, runtime) {
  if (state.effect === null || state.effect === undefined) {
    return state;
  }

  const perform = PERFORM[state.effect.type];
  // An effect nobody claims is cleared rather than kept: carrying it into the next
  // frame would have every key after it try to perform it again.
  return perform === undefined ? { ...state, effect: null } : perform(state, runtime);
}

module.exports = {
  CRASH_FILENAME,
  EXPORT_FILENAME,
  beginSend,
  deliver,
  editFile,
  exportReading,
  exportToFile,
  gitComplaint,
  outgoing,
  markerWarning,
  performCommit,
  performCreate,
  performEffect,
  performFetch,
  performMergeAbort,
  performMergeCommit,
  performPull,
  performPush,
  performResolve,
  persistBookmarks,
  persistJournal,
  rescueComments,
  revealPath,
  shouldUnstage,
  stageAll,
  subjectOf,
  toggleStage,
  writeComments,
};
