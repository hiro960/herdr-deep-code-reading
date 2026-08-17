"use strict";

// The log's two remote keys: asking what has arrived, and taking it.
//
// Everything here runs against a clone of a directory on disk. That is a remote in
// every way this code cares about — it has a name, it has branches, and both keys go
// through the same git that a remote over the network would — and it needs no network
// to test, which a suite that runs in CI on three versions of Node cannot ask for.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const { createState, reduce, reloadedInPlace, toScreenModel } = require("../lib/app-state");
const { gitComplaint, performEffect, performPull, performPush } = require("../lib/run/effects");
const { renderBranchRow } = require("../lib/render/log");
const { headBranchOf } = require("../lib/refs");
const { KIND_LOCAL } = require("../lib/graph");
const { displayWidth } = require("../lib/text");

const COLUMNS = 200;
const VIEWPORT = 40;
const BRANCH_WIDTH = 24;
const GIT_IDENTITY = ["-c", "user.email=test@example.com", "-c", "user.name=herdr-deep-code-reading test"];

const ESC_SEQUENCE = /\u001b\[[0-9;]*m/g;

/** What a row looks like to the terminal: its cells, without the colours. */
function plain(text) {
  return text.replace(ESC_SEQUENCE, "");
}

/**
 * Run git, and give a repository it has just made an identity of its own.
 *
 * The plugin runs `git pull`, `git merge` and `git commit` as child processes of its
 * own, with whatever config the repository and the machine carry. A developer's machine
 * has a global identity and a clean CI runner has none, so a fixture that leans on one
 * passes here and fails there — with git's own `unable to auto-detect email address`,
 * which the pane reports faithfully and which has nothing to do with what is being
 * tested. The repository under test carries its own, the way a reader's does.
 */
function run(cwd, args) {
  execFileSync("git", args, { cwd, stdio: "ignore" });

  const made = args[0] === "init" ? cwd : args[0] === "clone" ? args[args.length - 1] : null;
  if (made === null || args.includes("--bare")) {
    return; // Not a repository with a working tree, so nothing will be committed in it
  }
  for (const [key, value] of [["user.email", "test@example.com"], ["user.name", "herdr-deep-code-reading test"]]) {
    execFileSync("git", ["config", key, value], { cwd: made, stdio: "ignore" });
  }
}

/** A repository cloned from another one on disk, so that it has a remote to ask. */
function makeClone(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "herdr-deep-code-reading-remote-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const origin = path.join(root, "origin");
  fs.mkdirSync(origin);
  run(origin, ["init", "-q", "-b", "main"]);
  fs.writeFileSync(path.join(origin, "a.txt"), "one\n");
  run(origin, ["add", "-A"]);
  run(origin, [...GIT_IDENTITY, "commit", "-qm", "one"]);

  const work = path.join(root, "work");
  run(root, ["clone", "-q", origin, work]);

  return { origin, work };
}

/**
 * A clone of a remote that will accept a push.
 *
 * Bare, because a repository with a working tree refuses to have the branch it has
 * checked out written to — which is git protecting somebody's files, and is why a
 * remote anybody pushes to is bare.
 *
 * @returns {{origin: string, work: string}}
 */
function makePushClone(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "herdr-deep-code-reading-push-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const origin = path.join(root, "origin.git");
  run(root, ["init", "-q", "--bare", "-b", "main", origin]);

  const work = path.join(root, "work");
  run(root, ["clone", "-q", origin, work]);
  fs.writeFileSync(path.join(work, "a.txt"), "one\n");
  run(work, ["add", "-A"]);
  run(work, [...GIT_IDENTITY, "commit", "-qm", "one"]);

  return { origin, work };
}

/** The effect a second P would have emitted, for the paths that skip the prompt. */
function pushEffect(branch) {
  return { type: "push", target: { remote: "origin", ref: branch, setUpstream: false }, branch };
}

/** What the remote has, as one line per commit. */
function subjectsOn(origin) {
  const shown = execFileSync("git", ["--git-dir", origin, "log", "--format=%s", "--all"], {
    encoding: "utf8",
  });
  return shown.split("\n").filter((line) => line !== "");
}

/** Another commit at the other end, which this repository has not been told about. */
function commitOnOrigin(origin, subject) {
  fs.appendFileSync(path.join(origin, "a.txt"), `${subject}\n`);
  run(origin, [...GIT_IDENTITY, "commit", "-qam", subject]);
}

/** A commit here, which the other end has not been told about. */
function commitOnWork(work, subject) {
  fs.appendFileSync(path.join(work, "b.txt"), `${subject}\n`);
  run(work, ["add", "-A"]);
  run(work, [...GIT_IDENTITY, "commit", "-qm", subject]);
}

/** The same line of the same file, written differently at each end. */
function conflictOnBothEnds(origin, work) {
  fs.writeFileSync(path.join(origin, "a.txt"), "theirs\n");
  run(origin, [...GIT_IDENTITY, "commit", "-qam", "theirs"]);
  fs.writeFileSync(path.join(work, "a.txt"), "ours\n");
  run(work, [...GIT_IDENTITY, "commit", "-qam", "ours"]);
}

function openedLog(repoDir) {
  const state = reduce(createState(repoDir, "review", COLUMNS), "L", VIEWPORT);
  assert.strictEqual(state.view, "log");
  return state;
}

/** Press a key and carry out whatever it asked the world for, as the loop does. */
function press(state, key) {
  return performEffect(reduce(state, key, VIEWPORT), null);
}

/** Send what is here, prompt and all — which is what gives a branch its upstream. */
function sendFirst(work) {
  return press(press(openedLog(work), "P"), "P");
}

/** The tracking of the branch HEAD is on. */
function head(state) {
  return headBranchOf(state.log.branches);
}

/** The subjects of the commits the graph is showing. */
function subjects(state) {
  return state.log.rows.filter((row) => row.commit !== null).map((row) => row.commit.subject);
}

// --- what the screen says before anything is pressed ---------------------------------

test("a branch behind its upstream carries the count, and the header carries its age", (t) => {
  // Arrange: the other end has moved and this repository has been told
  const { origin, work } = makeClone(t);
  commitOnOrigin(origin, "two");
  run(work, ["fetch", "-q"]);

  // Act
  const state = openedLog(work);

  // Assert
  assert.deepStrictEqual(head(state).track, {
    upstream: "origin/main",
    ahead: 0,
    behind: 1,
    gone: false,
  });
  const heading = toScreenModel(state).title;
  assert.match(heading, /main ↓1/);
  assert.match(heading, /fetched just now/);
});

test("a repository that has never fetched says so rather than showing a stale count", (t) => {
  // Arrange: a clone writes no FETCH_HEAD, so nothing here has ever asked the remote
  const { work } = makeClone(t);

  // Act
  const heading = toScreenModel(openedLog(work)).title;

  // Assert
  assert.match(heading, /never fetched/);
});

test("a repository with no remote is not told when it last fetched", (t) => {
  // Arrange: nobody's copy of anything — there is no fetch for a date to be about
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "herdr-deep-code-reading-solo-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  run(root, ["init", "-q", "-b", "main"]);
  fs.writeFileSync(path.join(root, "a.txt"), "one\n");
  run(root, ["add", "-A"]);
  run(root, [...GIT_IDENTITY, "commit", "-qm", "one"]);

  // Act
  const heading = toScreenModel(openedLog(root)).title;

  // Assert
  assert.doesNotMatch(heading, /fetched/);
});

test("the count is drawn beside the branch, and costs the column no width", () => {
  // Arrange
  const branch = {
    kind: "branch",
    branch: {
      name: "main",
      kind: KIND_LOCAL,
      track: { upstream: "origin/main", ahead: 2, behind: 3, gone: false },
    },
  };

  // Act
  const row = renderBranchRow(branch, BRANCH_WIDTH, false, false);
  const chosen = renderBranchRow(branch, BRANCH_WIDTH, true, true);

  // Assert
  assert.match(plain(row), /main/);
  assert.match(plain(row), /↑2↓3\s*$/);
  assert.strictEqual(displayWidth(plain(row)), BRANCH_WIDTH);
  assert.strictEqual(displayWidth(plain(chosen)), BRANCH_WIDTH);
  assert.match(plain(chosen), /↑2↓3/, "the cursor's row keeps the count");
});

test("a long name gives way to the count rather than pushing it off the row", () => {
  const branch = {
    kind: "branch",
    branch: {
      name: `feat/${"x".repeat(60)}`,
      kind: KIND_LOCAL,
      track: { upstream: "origin/x", ahead: 0, behind: 12, gone: false },
    },
  };

  const row = plain(renderBranchRow(branch, BRANCH_WIDTH, false, false));

  assert.strictEqual(displayWidth(row), BRANCH_WIDTH);
  assert.match(row, /↓12\s*$/);
});

// --- asking the remote what it has ---------------------------------------------------

test("F asks the remote, and the count beside the branch becomes true", (t) => {
  // Arrange: the other end has moved twice and nobody here knows
  const { origin, work } = makeClone(t);
  commitOnOrigin(origin, "two");
  commitOnOrigin(origin, "three");
  const state = openedLog(work);
  assert.strictEqual(head(state).track.behind, 0, "nothing is known before the fetch");

  // Act
  const fetched = press(state, "F");

  // Assert
  assert.strictEqual(head(fetched).track.behind, 2);
  assert.strictEqual(fetched.message, "Fetched — main is 2 behind origin/main");
  assert.strictEqual(fetched.effect, null);
});

test("a fetch that finds nothing says the branch is up to date", (t) => {
  const { work } = makeClone(t);

  const fetched = press(openedLog(work), "F");

  assert.strictEqual(fetched.message, "Fetched — main is up to date with origin/main");
});

test("a repository with no remote is told so rather than being made to wait", (t) => {
  // Arrange: a repository of its own, with nowhere to fetch from
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "herdr-deep-code-reading-solo-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  run(root, ["init", "-q", "-b", "main"]);
  fs.writeFileSync(path.join(root, "a.txt"), "one\n");
  run(root, ["add", "-A"]);
  run(root, [...GIT_IDENTITY, "commit", "-qm", "one"]);

  // Act
  const asked = reduce(openedLog(root), "F", VIEWPORT);

  // Assert
  assert.strictEqual(asked.message, "No remote to fetch from");
  assert.strictEqual(asked.effect, null);
});

test("a fetch drops the copy of a branch deleted at the other end", (t) => {
  // Arrange: a branch that exists at the other end, followed here, and then deleted
  const { origin, work } = makeClone(t);
  run(origin, ["branch", "side"]);
  run(work, ["fetch", "-q"]);
  run(work, ["branch", "side", "origin/side"]);
  run(work, ["branch", "--set-upstream-to=origin/side", "side"]);
  run(origin, ["branch", "-D", "-q", "side"]);

  // Act
  const fetched = press(openedLog(work), "F");

  // Assert: the branch here is still here, and it says its upstream has gone
  const side = fetched.log.branches.find((branch) => branch.name === "side");
  assert.strictEqual(side.track.gone, true);
});

// --- taking what has arrived ----------------------------------------------------------

test("p says what it is about to do, and does it on a second press", (t) => {
  // Arrange
  const { origin, work } = makeClone(t);
  commitOnOrigin(origin, "two");
  const state = press(openedLog(work), "F");

  // Act
  const asked = reduce(state, "p", VIEWPORT);

  // Assert: nothing has happened yet. The graph already shows the commit — a fetch
  // brought it in and the graph draws every branch there is — but it is not on this
  // branch and it is not in the file.
  assert.strictEqual(asked.pendingPull, true);
  assert.strictEqual(asked.effect, null);
  assert.strictEqual(asked.message, "Pull main from origin/main ↓1 — press p again");
  assert.strictEqual(fs.readFileSync(path.join(work, "a.txt"), "utf8"), "one\n");

  // Act: the second press
  const pulled = press(asked, "p");

  // Assert
  assert.strictEqual(pulled.pendingPull, false);
  assert.strictEqual(pulled.message, "Pulled — main is up to date with origin/main");
  assert.deepStrictEqual(subjects(pulled), ["two", "one"]);
  assert.strictEqual(fs.readFileSync(path.join(work, "a.txt"), "utf8"), "one\ntwo\n");
});

test("a pull needs no fetch first: it asks the remote itself", (t) => {
  // Arrange: nothing here knows the other end has moved
  const { origin, work } = makeClone(t);
  commitOnOrigin(origin, "two");
  const state = openedLog(work);

  // Act
  const pulled = press(reduce(state, "p", VIEWPORT), "p");

  // Assert
  assert.deepStrictEqual(subjects(pulled), ["two", "one"]);
});

test("any other key takes the prompt back off", (t) => {
  // Arrange
  const { origin, work } = makeClone(t);
  commitOnOrigin(origin, "two");
  const asked = reduce(press(openedLog(work), "F"), "p", VIEWPORT);
  assert.strictEqual(asked.pendingPull, true);

  // Act: a key that is not p, and then p again
  const moved = reduce(asked, "j", VIEWPORT);
  const askedAgain = performEffect(reduce(moved, "p", VIEWPORT), null);

  // Assert: the second p asks again rather than pulling
  assert.strictEqual(moved.pendingPull, false);
  assert.strictEqual(askedAgain.pendingPull, true);
  assert.strictEqual(fs.readFileSync(path.join(work, "a.txt"), "utf8"), "one\n");
});

test("a reload under the reader takes the prompt off with the message", (t) => {
  // Arrange: the watch is what does this — a tick rewrites the footer without anybody
  // pressing anything, and a question nobody can see must not still be answerable
  const { origin, work } = makeClone(t);
  commitOnOrigin(origin, "two");
  const asked = reduce(press(openedLog(work), "F"), "p", VIEWPORT);
  assert.strictEqual(asked.pendingPull, true);

  // Act
  const reloaded = reloadedInPlace(asked, "Reloaded — the repository changed", VIEWPORT);

  // Assert
  assert.strictEqual(reloaded.pendingPull, false);
  assert.strictEqual(reduce(reloaded, "p", VIEWPORT).pendingPull, true, "it asks again");
});

test("a P typed into a text field is a letter, not an answer either", (t) => {
  // Arrange: the push prompt armed, and a field opened over it
  const { origin, work } = makePushClone(t);
  sendFirst(work);
  commitOnWork(work, "second");
  const asked = reduce(openedLog(work), "P", VIEWPORT);
  assert.strictEqual(asked.pendingPush, true);

  // Act: the author field takes every key, P included
  const typed = reduce(reduce(asked, "A", VIEWPORT), "P", VIEWPORT);
  const closed = performEffect(reduce(typed, "escape", VIEWPORT), null);

  // Assert
  assert.strictEqual(typed.pendingPush, false);
  assert.strictEqual(closed.pendingPush, false);
  assert.ok(!subjectsOn(origin).includes("second"), "a letter in a field sent it");
});

test("a p typed into a text field is a letter, not an answer", (t) => {
  // Arrange
  const { origin, work } = makeClone(t);
  commitOnOrigin(origin, "two");
  const asked = reduce(press(openedLog(work), "F"), "p", VIEWPORT);

  // Act: open the author field, type a p into it, and close the field
  const typed = reduce(reduce(asked, "A", VIEWPORT), "p", VIEWPORT);
  const closed = reduce(typed, "escape", VIEWPORT);

  // Assert
  assert.strictEqual(typed.pendingPull, false);
  assert.strictEqual(closed.pendingPull, false);
});

// --- when a pull is not the thing to do -----------------------------------------------

test("a branch with work at both ends says the pull is a merge, and makes one", (t) => {
  // Arrange: a commit here and a commit there, in different files so they settle
  const { origin, work } = makeClone(t);
  commitOnOrigin(origin, "theirs");
  commitOnWork(work, "mine");
  const state = press(openedLog(work), "F");

  // Act
  const asked = reduce(state, "p", VIEWPORT);

  // Assert: the prompt says what taking it means
  assert.strictEqual(asked.pendingPull, true);
  assert.match(asked.message, /as a merge/);

  // Act: agree to it
  const pulled = press(asked, "p");

  // Assert: git settled it on its own, and both sides are in
  assert.match(pulled.message, /^Pulled/);
  assert.strictEqual(pulled.merge.merging, false);
  assert.ok(subjects(pulled).some((subject) => subject.startsWith("Merge branch")));
});

test("a merge already in progress is finished before another is begun", (t) => {
  // Arrange: a conflicted pull, left half-settled
  const { origin, work } = makeClone(t);
  conflictOnBothEnds(origin, work);
  const stopped = press(openedLog(work), "p");
  const merging = press(stopped, "p");
  assert.strictEqual(merging.merge.merging, true);

  // Act: back to the log, and ask for another pull
  const refused = reduce(reduce(merging, "L", VIEWPORT), "p", VIEWPORT);

  // Assert
  assert.match(refused.message, /A merge is already in progress/);
  assert.strictEqual(refused.effect, null);
});

test("a branch that follows nothing has nowhere to pull from", (t) => {
  // Arrange
  const { work } = makeClone(t);
  run(work, ["checkout", "-q", "-b", "solo"]);

  // Act
  const refused = reduce(openedLog(work), "p", VIEWPORT);

  // Assert
  assert.strictEqual(refused.message, "solo follows no branch — nothing to pull");
  assert.strictEqual(refused.effect, null);
});

test("an upstream that is gone is not pulled from", (t) => {
  // Arrange
  const { origin, work } = makeClone(t);
  run(origin, ["branch", "side"]);
  run(work, ["fetch", "-q"]);
  run(work, ["checkout", "-q", "-b", "side", "origin/side"]);
  run(origin, ["branch", "-D", "-q", "side"]);
  const state = press(openedLog(work), "F");

  // Act
  const refused = reduce(state, "p", VIEWPORT);

  // Assert
  assert.strictEqual(refused.message, "origin/side is gone — nothing to pull");
});

test("a detached HEAD has no branch to pull into", (t) => {
  // Arrange
  const { work } = makeClone(t);
  run(work, ["checkout", "-q", "--detach"]);

  // Act
  const refused = reduce(openedLog(work), "p", VIEWPORT);

  // Assert
  assert.strictEqual(refused.message, "Not on a branch — nothing to pull into");
});

// --- sending it out ----------------------------------------------------------------------

test("P sends a branch nobody has seen, and follows it from then on", (t) => {
  // Arrange: a branch with commits and no upstream
  const { origin, work } = makePushClone(t);
  run(work, ["checkout", "-q", "-b", "feat/thing"]);
  fs.writeFileSync(path.join(work, "b.txt"), "mine\n");
  run(work, ["add", "-A"]);
  run(work, [...GIT_IDENTITY, "commit", "-qm", "on the branch"]);
  const state = openedLog(work);

  // Act: the prompt, then the push
  const asked = reduce(state, "P", VIEWPORT);
  const pushed = press(asked, "P");

  // Assert
  assert.strictEqual(asked.message, "Push feat/thing to origin and follow it — press P again");
  assert.ok(subjectsOn(origin).includes("on the branch"), "the remote never got it");
  assert.deepStrictEqual(head(pushed).track, {
    upstream: "origin/feat/thing",
    ahead: 0,
    behind: 0,
    gone: false,
  });
});

test("P sends the commits a branch has of its own, and says how many", (t) => {
  // Arrange
  const { origin, work } = makePushClone(t);
  sendFirst(work);
  commitOnWork(work, "second");
  commitOnWork(work, "third");
  const state = openedLog(work);
  assert.strictEqual(head(state).track.ahead, 2);

  // Act
  const asked = reduce(state, "P", VIEWPORT);
  const pushed = press(asked, "P");

  // Assert
  assert.strictEqual(asked.message, "Push 2 commits from main to origin/main — press P again");
  assert.strictEqual(pushed.message, "Pushed — main is up to date with origin/main");
  assert.strictEqual(head(pushed).track.ahead, 0);
  assert.ok(subjectsOn(origin).includes("third"));
});

test("any other key takes the push prompt back off", (t) => {
  // Arrange
  const { origin, work } = makePushClone(t);
  sendFirst(work);
  commitOnWork(work, "second");
  const asked = reduce(openedLog(work), "P", VIEWPORT);
  assert.strictEqual(asked.pendingPush, true);

  // Act
  const moved = reduce(asked, "j", VIEWPORT);
  const askedAgain = performEffect(reduce(moved, "P", VIEWPORT), null);

  // Assert
  assert.strictEqual(moved.pendingPush, false);
  assert.strictEqual(askedAgain.pendingPush, true);
  assert.ok(!subjectsOn(origin).includes("second"), "it went out without being agreed to");
});

test("a branch with nothing of its own is not pushed", (t) => {
  // Arrange
  const { work } = makePushClone(t);
  sendFirst(work);

  // Act
  const refused = reduce(openedLog(work), "P", VIEWPORT);

  // Assert
  assert.strictEqual(refused.message, "main is up to date with origin/main — nothing to push");
  assert.strictEqual(refused.effect, null);
});

/** A commit landing on the remote from somewhere else, as a colleague's would. */
function commitFromElsewhere(origin, near, subject) {
  const other = path.join(path.dirname(near), `other-${subject}`);
  run(path.dirname(near), ["clone", "-q", origin, other]);
  fs.appendFileSync(path.join(other, "a.txt"), `${subject}\n`);
  run(other, [...GIT_IDENTITY, "commit", "-qam", subject]);
  run(other, ["push", "-q", "origin", "main"]);
}

test("a branch that is only behind has nothing of its own to send", (t) => {
  // Arrange: the other end has moved and this repository has been told
  const { origin, work } = makePushClone(t);
  sendFirst(work);
  commitFromElsewhere(origin, work, "theirs");
  const state = press(openedLog(work), "F");

  // Act
  const refused = reduce(state, "P", VIEWPORT);

  // Assert
  assert.strictEqual(refused.message, "main is 1 behind origin/main — nothing to push");
  assert.strictEqual(refused.effect, null);
});

test("a branch with work at both ends is pulled before it is pushed", (t) => {
  // Arrange: a commit here, a commit there, and both of them known about
  const { origin, work } = makePushClone(t);
  sendFirst(work);
  commitFromElsewhere(origin, work, "theirs");
  commitOnWork(work, "mine");
  const state = press(openedLog(work), "F");

  // Act
  const refused = reduce(state, "P", VIEWPORT);

  // Assert: git would refuse this push, and it would be right to — what is there was
  // written by somebody else
  assert.match(refused.message, /diverged/);
  assert.match(refused.message, /pull it first/);
  assert.strictEqual(refused.effect, null);
  assert.ok(!subjectsOn(origin).includes("mine"));
});

test("a repository with nowhere to send it says so", (t) => {
  // Arrange: no remotes at all
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "herdr-deep-code-reading-alone-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  run(root, ["init", "-q", "-b", "main"]);
  fs.writeFileSync(path.join(root, "a.txt"), "one\n");
  run(root, ["add", "-A"]);
  run(root, [...GIT_IDENTITY, "commit", "-qm", "one"]);

  // Act
  const refused = reduce(openedLog(root), "P", VIEWPORT);

  // Assert
  assert.strictEqual(refused.message, "Nowhere to push main to");
});

test("a detached HEAD has no branch to send", (t) => {
  // Arrange
  const { work } = makePushClone(t);
  run(work, ["checkout", "-q", "--detach"]);

  // Act
  const refused = reduce(openedLog(work), "P", VIEWPORT);

  // Assert
  assert.strictEqual(refused.message, "Not on a branch — nothing to push");
});

test("P finds a file everywhere else, and pushes only here", (t) => {
  // Arrange: the one key in the pane that means two things
  const { work } = makePushClone(t);
  const log = openedLog(work);

  // Act
  const inTheLog = reduce(log, "P", VIEWPORT);
  const inTheDiff = reduce(createState(work, "review", COLUMNS), "P", VIEWPORT);

  // Assert
  assert.strictEqual(inTheLog.input, null, "the log opened a field rather than pushing");
  assert.strictEqual(inTheDiff.input.kind, "open", "the diff pushed rather than finding a file");
  assert.match(toScreenModel(log).help, /P push/);
  assert.doesNotMatch(toScreenModel(log).help, /P find/);
  assert.match(toScreenModel(createState(work, "review", COLUMNS)).help, /P find/);
});

// --- when git refuses ------------------------------------------------------------------

test("a push the remote will not take says what git said", (t) => {
  // Arrange: the other end moved and this repository has not been told, so nothing
  // here knows the push cannot land — which is the state a rejected push arrives from
  const { origin, work } = makePushClone(t);
  sendFirst(work);
  const other = path.join(path.dirname(work), "other");
  run(path.dirname(work), ["clone", "-q", origin, other]);
  fs.appendFileSync(path.join(other, "a.txt"), "theirs\n");
  run(other, [...GIT_IDENTITY, "commit", "-qam", "theirs"]);
  run(other, ["push", "-q", "origin", "main"]);
  commitOnWork(work, "mine");

  // Act
  const failed = performPush({ ...openedLog(work), effect: pushEffect("main") });

  // Assert
  assert.match(failed.message, /^Push failed: /);
  assert.strictEqual(failed.effect, null);
  assert.ok(!subjectsOn(origin).includes("mine"), "it went out anyway");
});

test("a pull git will not begin says what git said, not what it advised", (t) => {
  // Arrange: an edit here that has not been committed, to the file the incoming commit
  // changes. git refuses to start a merge that would write over it.
  const { origin, work } = makeClone(t);
  commitOnOrigin(origin, "theirs");
  fs.appendFileSync(path.join(work, "a.txt"), "uncommitted\n");
  const state = openedLog(work);

  // Act
  const failed = performPull(state);

  // Assert
  assert.match(failed.message, /^Pull failed: error:/);
  assert.doesNotMatch(failed.message, /hint:/);
  assert.strictEqual(failed.effect, null);
  assert.strictEqual(failed.merge.merging, false, "nothing was left half-merged");
});

test("git's verdict is picked out of its advice", () => {
  const said = ["hint: you could merge", "hint: or rebase", "fatal: not possible"].join("\n");

  assert.strictEqual(gitComplaint(said), "fatal: not possible");
  assert.strictEqual(gitComplaint("hint: only advice"), "hint: only advice");
  assert.strictEqual(gitComplaint("just a line"), "just a line");
  assert.strictEqual(gitComplaint("error: first\nfatal: second"), "error: first");
  assert.strictEqual(gitComplaint(""), "no reason given");
  assert.strictEqual(gitComplaint(null), "no reason given");
});

test("a fetch that fails leaves the counts as they were and says so", (t) => {
  // Arrange: a remote pointing at a directory that is not there
  const { work } = makeClone(t);
  run(work, ["remote", "set-url", "origin", path.join(os.tmpdir(), "herdr-deep-code-reading-nowhere")]);

  // Act
  const failed = press(openedLog(work), "F");

  // Assert
  assert.match(failed.message, /^Fetch failed: /);
  assert.strictEqual(failed.effect, null);
});
