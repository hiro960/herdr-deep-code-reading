"use strict";

// The log screen's four panes, as state: where the cursor is in each, what moving it
// loads, and what narrowing to a branch does to the graph.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const { createState, reduce, reloadedInPlace, withLayout } = require("../lib/app-state");
const { COMMIT_MODE } = require("../lib/git");
const { VIEW_LOG } = require("../lib/view-names");
const {
  FOCUS_BRANCHES,
  FOCUS_DIFF,
  FOCUS_GRAPH,
  FOCUS_PANEL,
  branchRowNear,
  chooseInLog,
  commitAtCursor,
  commitRowNear,
  cycleLogFocus,
  moveLog,
  openLog,
  paneHeight,
  reloadLog,
  toggleLogScope,
} = require("../lib/state/log");

const COLUMNS = 200;
const VIEWPORT = 40;
const GIT_IDENTITY = ["-c", "user.email=test@example.com", "-c", "user.name=herdr-deep-code-reading test"];

function run(cwd, args) {
  execFileSync("git", args, { cwd, stdio: "ignore" });
}

/** A repository with a merge in it, so the graph has edge rows the cursor must skip. */
function makeRepo(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "herdr-deep-code-reading-log-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  run(root, ["init", "-q", "-b", "main"]);
  fs.writeFileSync(path.join(root, "a.txt"), "one\n");
  run(root, ["add", "-A"]);
  run(root, [...GIT_IDENTITY, "commit", "-qm", "root"]);

  run(root, ["checkout", "-q", "-b", "side"]);
  // Two files, so that the file panel under the graph has somewhere to move to
  fs.writeFileSync(path.join(root, "b.txt"), "two\n");
  fs.writeFileSync(path.join(root, "c.txt"), "three\n");
  run(root, ["add", "-A"]);
  run(root, [...GIT_IDENTITY, "commit", "-qm", "on the side"]);

  run(root, ["checkout", "-q", "main"]);
  fs.writeFileSync(path.join(root, "a.txt"), "one\ntwo\n");
  run(root, ["add", "-A"]);
  run(root, [...GIT_IDENTITY, "commit", "-qm", "on main"]);
  run(root, [...GIT_IDENTITY, "merge", "-q", "--no-ff", "side", "-m", "merge side"]);

  return root;
}

function opened(t) {
  const root = makeRepo(t);
  return openLog(createState(root, "review", COLUMNS));
}

/** The subject of the commit the graph cursor is on. */
function subjectAt(state) {
  const commit = commitAtCursor(state);
  return commit === null ? null : commit.subject;
}

// --- finding a commit among the edges --------------------------------------------------

test("a graph cut off mid-merge still finds the commit above the cut", () => {
  // --max-count stops the log wherever it stops, which can be on an edge row: the
  // rows below the last commit are lanes on their way to a commit that was not read
  const rows = [
    { graph: "*", commit: { sha: "a" } },
    { graph: "|\\", commit: null },
    { graph: "| |", commit: null },
  ];

  assert.strictEqual(commitRowNear(rows, 2, 1), 0, "looked down, found nothing, looked up");
});

test("a graph with no commits at all answers with no row", () => {
  assert.strictEqual(commitRowNear([{ graph: "|", commit: null }], 0, 1), -1);
  assert.strictEqual(commitRowNear([], 0, 1), -1);
});

test("a branch list of nothing but headings has no row to land on", () => {
  assert.strictEqual(branchRowNear([{ kind: "heading", text: "branches" }], 0, 1), -1);
});

test("the commit under the cursor of a state that has no log is no commit", () => {
  assert.strictEqual(commitAtCursor({ log: null }), null);
  assert.strictEqual(commitAtCursor({}), null);
});

// --- opening ------------------------------------------------------------------------

test("the log opens on the graph, with the branches beside it", (t) => {
  const state = opened(t);

  assert.strictEqual(state.view, VIEW_LOG);
  assert.strictEqual(state.log.focus, FOCUS_GRAPH);
  assert.ok(state.log.rows.length > 0);
  assert.ok(
    state.log.branchRows.some((row) => row.kind === "branch" && row.branch.name === "side"),
    "every branch is listed, not only the one HEAD is on"
  );
});

test("the cursor opens on a commit rather than on an edge", (t) => {
  const state = opened(t);

  assert.strictEqual(subjectAt(state), "merge side");
});

test("the commit under the cursor is already loaded underneath", (t) => {
  const state = opened(t);

  assert.strictEqual(state.mode, COMMIT_MODE);
  assert.strictEqual(state.commit.subject, "merge side");
  assert.ok(state.files.length > 0, "a merge with --no-ff has a diff of its own");
});

test("leaving the log is possible: it records where the reader was", (t) => {
  const root = makeRepo(t);
  const before = createState(root, "review", COLUMNS);

  const state = openLog(before);

  assert.strictEqual(state.history.length, before.history.length + 1);
});

// --- moving through the graph ------------------------------------------------------------

test("j steps to the next commit, over whatever edges are between", (t) => {
  const state = moveLog(opened(t), 1, VIEWPORT);

  assert.strictEqual(subjectAt(state), "on the side");
});

test("k steps back to the one above", (t) => {
  const state = moveLog(moveLog(opened(t), 1, VIEWPORT), -1, VIEWPORT);

  assert.strictEqual(subjectAt(state), "merge side");
});

test("every step lands on a commit, never on an edge", (t) => {
  let state = opened(t);

  for (let step = 0; step < 8; step += 1) {
    state = moveLog(state, 1, VIEWPORT);
    assert.notStrictEqual(commitAtCursor(state), null, `step ${step}`);
  }
});

test("moving loads the commit it lands on", (t) => {
  const state = moveLog(opened(t), 1, VIEWPORT);

  assert.strictEqual(state.commit.subject, "on the side");
  assert.deepStrictEqual(
    state.files.map((file) => file.newPath),
    ["b.txt", "c.txt"]
  );
});

test("a merge is diffed against its first parent rather than showing nothing", (t) => {
  // Asked for a merge on its own, git prints no diff at all: the commit agrees with
  // one parent or the other about every line. What arrived from the side branch is
  // what a reader opening a merge is looking for.
  const state = opened(t);

  assert.strictEqual(state.commit.subject, "merge side");
  assert.deepStrictEqual(
    state.files.map((file) => file.newPath),
    ["b.txt", "c.txt"]
  );
});

test("G goes to the oldest commit and g back to the newest", (t) => {
  const last = moveLog(opened(t), Number.MAX_SAFE_INTEGER, VIEWPORT);
  assert.strictEqual(subjectAt(last), "root");

  const first = moveLog(last, -Number.MAX_SAFE_INTEGER, VIEWPORT);
  assert.strictEqual(subjectAt(first), "merge side");
});

test("the first commit of a repository has a diff, having no parent to be compared to", (t) => {
  const state = moveLog(opened(t), Number.MAX_SAFE_INTEGER, VIEWPORT);

  assert.strictEqual(state.commit.subject, "root");
  assert.deepStrictEqual(
    state.files.map((file) => file.newPath),
    ["a.txt"]
  );
});

test("the ends hold rather than wrapping", (t) => {
  const top = moveLog(opened(t), -5, VIEWPORT);

  assert.strictEqual(subjectAt(top), "merge side");
});

// --- the four panes ------------------------------------------------------------------------

test("Tab goes round the four panes and back", (t) => {
  let state = opened(t);

  const seen = [state.log.focus];
  for (let step = 0; step < 4; step += 1) {
    state = cycleLogFocus(state, 1);
    seen.push(state.log.focus);
  }

  assert.deepStrictEqual(seen, [
    FOCUS_GRAPH,
    FOCUS_PANEL,
    FOCUS_DIFF,
    FOCUS_BRANCHES,
    FOCUS_GRAPH,
  ]);
});

test("movement follows the focus", (t) => {
  const state = cycleLogFocus(opened(t), 1);
  assert.strictEqual(state.log.focus, FOCUS_PANEL);

  const moved = moveLog(state, 1, VIEWPORT);

  assert.strictEqual(moved.selectedIndex, 1, "the file panel moved, not the graph");
  assert.strictEqual(subjectAt(moved), subjectAt(state), "and the graph stayed put");
});

test("half a page of the graph is half of the graph, not half of the screen", (t) => {
  const root = makeRepo(t);
  const state = createState(root, "log", COLUMNS);
  const body = 40;

  // The graph gets about a third of the body, so its half-page is well under the
  // body's — and paging by the body's would cross the whole pane at every press
  assert.ok(paneHeight(state, body) < body / 2, "the graph is a fraction of the body");

  const focused = cycleLogFocus(cycleLogFocus(state, 1), 1);
  assert.strictEqual(focused.log.focus, FOCUS_DIFF);
  assert.ok(paneHeight(focused, body) > paneHeight(state, body), "the diff has the larger share");
});

test("the branch list skips its headings", (t) => {
  let state = cycleLogFocus(opened(t), -1);
  assert.strictEqual(state.log.focus, FOCUS_BRANCHES);

  const rows = state.log.branchRows;
  assert.strictEqual(rows[state.log.branchCursor].kind, "branch");

  state = moveLog(state, 1, VIEWPORT);
  assert.strictEqual(rows[state.log.branchCursor].kind, "branch");
});

// --- narrowing to one branch -------------------------------------------------------------------

test("choosing a branch narrows the graph to it", (t) => {
  let state = cycleLogFocus(opened(t), -1);
  while (state.log.branchRows[state.log.branchCursor].branch.name !== "side") {
    state = moveLog(state, 1, VIEWPORT);
  }

  const narrowed = chooseInLog(state);

  assert.strictEqual(narrowed.log.ref, "side");
  assert.deepStrictEqual(
    narrowed.log.rows.filter((row) => row.commit !== null).map((row) => row.commit.subject),
    ["on the side", "root"]
  );
});

test("narrowing loads the branch's own newest commit underneath", (t) => {
  let state = cycleLogFocus(opened(t), -1);
  while (state.log.branchRows[state.log.branchCursor].branch.name !== "side") {
    state = moveLog(state, 1, VIEWPORT);
  }

  const narrowed = chooseInLog(state);

  assert.strictEqual(narrowed.commit.subject, "on the side");
});

test("the scope toggle goes back to every branch", (t) => {
  let state = cycleLogFocus(opened(t), -1);
  while (state.log.branchRows[state.log.branchCursor].branch.name !== "side") {
    state = moveLog(state, 1, VIEWPORT);
  }
  const narrowed = chooseInLog(state);

  const widened = toggleLogScope(narrowed);

  assert.strictEqual(widened.log.ref, null);
  assert.strictEqual(
    widened.log.rows.filter((row) => row.commit !== null).length,
    4,
    "every commit is back"
  );
});

test("the toggle narrows to the branch HEAD is on when nothing is chosen", (t) => {
  const state = toggleLogScope(opened(t));

  assert.strictEqual(state.log.ref, "main");
});

test("choosing a commit in the graph opens it in the whole pane", (t) => {
  const state = chooseInLog(moveLog(opened(t), 1, VIEWPORT));

  assert.notStrictEqual(state.view, VIEW_LOG, "the diff takes the pane");
  assert.strictEqual(state.commit.subject, "on the side");
});

// --- reloading -------------------------------------------------------------------------------

test("a reload picks up a commit that landed while the log was open", (t) => {
  const root = makeRepo(t);
  const state = openLog(createState(root, "review", COLUMNS));

  fs.writeFileSync(path.join(root, "later.txt"), "later\n");
  run(root, ["add", "-A"]);
  run(root, [...GIT_IDENTITY, "commit", "-qm", "landed later"]);

  const reloaded = reloadLog(state, VIEWPORT);

  assert.strictEqual(
    reloaded.log.rows.filter((row) => row.commit !== null)[0].commit.subject,
    "landed later"
  );
});

test("a reload keeps the reader on the commit they were reading", (t) => {
  const root = makeRepo(t);
  let state = openLog(createState(root, "review", COLUMNS));
  state = moveLog(state, 1, VIEWPORT);

  const reloaded = reloadLog(state, VIEWPORT);

  assert.strictEqual(subjectAt(reloaded), "on the side");
});

// --- opening a pane straight onto it ------------------------------------------------------------

test("the log mode opens the pane on the log", (t) => {
  const root = makeRepo(t);

  const state = createState(root, "log", COLUMNS);

  assert.strictEqual(state.view, VIEW_LOG);
  assert.strictEqual(state.log.focus, FOCUS_GRAPH);
  assert.strictEqual(subjectAt(state), "merge side");
});

test("the working tree's diff waits behind it, for e and Esc to give back", (t) => {
  const root = makeRepo(t);
  fs.writeFileSync(path.join(root, "a.txt"), "one\ntwo\nthree\n");

  const state = createState(root, "log", COLUMNS);
  const back = reduce(state, "escape", VIEWPORT);

  assert.strictEqual(back.mode, "review");
  assert.match(back.title, /Working tree/);
});

test("a resize rebuilds the diff under the graph and leaves the graph alone", (t) => {
  const root = makeRepo(t);
  const wide = createState(root, "log", 200);

  const narrow = withLayout(wide, 120);

  assert.strictEqual(narrow.columns, 120);
  assert.strictEqual(
    narrow.log.rows,
    wide.log.rows,
    "a commit is one row at any width, so the graph is not rebuilt"
  );
  assert.strictEqual(narrow.view, VIEW_LOG);
});

// --- when the repository moves under it ------------------------------------------------------------

test("a reload in place picks up a commit that landed while the log was open", (t) => {
  const root = makeRepo(t);
  const state = createState(root, "log", COLUMNS);

  fs.writeFileSync(path.join(root, "later.txt"), "later\n");
  run(root, ["add", "-A"]);
  run(root, [...GIT_IDENTITY, "commit", "-qm", "landed later"]);

  const refreshed = reloadedInPlace(state, "Reloaded", VIEWPORT);

  assert.strictEqual(refreshed.view, VIEW_LOG);
  assert.strictEqual(
    refreshed.log.rows.filter((row) => row.commit !== null)[0].commit.subject,
    "landed later"
  );
  assert.strictEqual(refreshed.message, "Reloaded");
});

test("r reloads the log from the key as well as from the watch", (t) => {
  const root = makeRepo(t);
  const state = createState(root, "log", COLUMNS);

  run(root, ["branch", "third"]);

  const refreshed = reduce(state, "r", VIEWPORT);

  assert.ok(
    refreshed.log.branchRows.some((row) => row.kind === "branch" && row.branch.name === "third"),
    "a branch made while the log was open shows up"
  );
});

// --- a repository with nothing in it ---------------------------------------------------------

test("an empty repository opens the log and says it is empty", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "herdr-deep-code-reading-log-empty-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  run(root, ["init", "-q"]);

  const state = openLog(createState(root, "review", COLUMNS));

  assert.strictEqual(state.view, VIEW_LOG);
  assert.deepStrictEqual(state.log.rows, []);
  assert.strictEqual(commitAtCursor(state), null);
});

test("a repository that goes away under the log is reported, not thrown", (t) => {
  const root = makeRepo(t);
  const state = createState(root, "log", COLUMNS);

  fs.rmSync(root, { recursive: true, force: true });

  const refreshed = reloadLog(state, VIEWPORT);

  assert.ok(refreshed.message, "the footer says what happened");
  assert.strictEqual(refreshed.view, VIEW_LOG, "and the pane stays open");
});

test("a branch git cannot read is reported, not thrown", (t) => {
  const root = makeRepo(t);
  const state = createState(root, "log", COLUMNS);
  const broken = { ...state, log: { ...state.log, ref: "no-such-branch" } };

  const refreshed = reloadLog(broken, VIEWPORT);

  assert.ok(refreshed.message);
  assert.strictEqual(refreshed.log.rows, broken.log.rows, "the graph in hand is kept");
});

test("moving in an empty log does nothing rather than failing", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "herdr-deep-code-reading-log-empty-move-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  run(root, ["init", "-q"]);
  const state = openLog(createState(root, "review", COLUMNS));

  assert.strictEqual(commitAtCursor(moveLog(state, 1, VIEWPORT)), null);
  assert.strictEqual(chooseInLog(state).view, VIEW_LOG);
});
