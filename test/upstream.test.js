"use strict";

// How far a branch has drifted from the one it follows, and how old that answer is.
//
// The counts are read out of a sentence git wrote, so most of what is worth checking
// here is the reading of it: the two numbers together, each of them alone, neither of
// them, and the branch whose upstream someone deleted.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const {
  describeTracking,
  fetchAge,
  lastFetch,
  loadTracking,
  parseTrack,
  parseTrackingLines,
  pushTarget,
  splitUpstream,
  trackingLabel,
} = require("../lib/upstream");
const { headBranchOf, loadBranches, withTracking } = require("../lib/refs");
const { KIND_HEAD, KIND_LOCAL, KIND_REMOTE } = require("../lib/graph");

const UNIT = "\u001f";
const GIT_IDENTITY = ["-c", "user.email=test@example.com", "-c", "user.name=herdr-deep-code-reading test"];

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

function line(name, upstream, track) {
  return [name, upstream, track].join(UNIT);
}

function run(cwd, args) {
  execFileSync("git", args, { cwd, stdio: "ignore" });
}

/**
 * A repository with a remote, made of two directories on disk.
 *
 * A clone of a local path is a remote in every way this code cares about: it has a
 * name, it has branches, and fetching from it goes through the same machinery as a
 * fetch over the network — without a test suite that needs one.
 *
 * @returns {{origin: string, work: string}}
 */
function makeClone(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "herdr-deep-code-reading-upstream-"));
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

/** Another commit at the other end, which this repository has not been told about. */
function commitOnOrigin(origin, text) {
  fs.appendFileSync(path.join(origin, "a.txt"), `${text}\n`);
  run(origin, [...GIT_IDENTITY, "commit", "-qam", text]);
}

// --- reading what git wrote ------------------------------------------------------------

test("reads both counts out of a branch that has drifted in both directions", () => {
  // Arrange
  const field = "[ahead 2, behind 3]";

  // Act
  const track = parseTrack(field);

  // Assert
  assert.deepStrictEqual(track, { ahead: 2, behind: 3, gone: false });
});

test("reads a branch that is only behind", () => {
  assert.deepStrictEqual(parseTrack("[behind 3]"), { ahead: 0, behind: 3, gone: false });
});

test("reads a branch that is only ahead", () => {
  assert.deepStrictEqual(parseTrack("[ahead 2]"), { ahead: 2, behind: 0, gone: false });
});

test("a branch level with its upstream is neither ahead nor behind", () => {
  assert.deepStrictEqual(parseTrack(""), { ahead: 0, behind: 0, gone: false });
});

test("reads an upstream that has been deleted at the other end", () => {
  assert.deepStrictEqual(parseTrack("[gone]"), { ahead: 0, behind: 0, gone: true });
});

test("reads the counts whether or not git brackets them", () => {
  // A later git may write the field without its brackets; the numbers are what is read
  assert.deepStrictEqual(parseTrack("ahead 1, behind 1"), parseTrack("[ahead 1, behind 1]"));
});

test("a branch that follows nothing is left out of the list", () => {
  // Arrange
  const stdout = [line("main", "origin/main", "[behind 1]"), line("solo", "", "")].join("\n");

  // Act
  const tracking = parseTrackingLines(stdout);

  // Assert
  assert.deepStrictEqual(
    tracking.map((entry) => entry.name),
    ["main"]
  );
});

test("a line with the wrong number of fields is skipped rather than guessed at", () => {
  const stdout = ["main", line("side", "origin/side", "[ahead 1]")].join("\n");

  assert.deepStrictEqual(
    parseTrackingLines(stdout).map((entry) => entry.name),
    ["side"]
  );
});

test("no output at all is no tracking at all", () => {
  assert.deepStrictEqual(parseTrackingLines(""), []);
});

// --- what goes beside a name -----------------------------------------------------------

test("a branch with work waiting shows how much, and which way it goes", () => {
  assert.strictEqual(trackingLabel({ ahead: 2, behind: 3, gone: false }), "↑2↓3");
  assert.strictEqual(trackingLabel({ ahead: 0, behind: 3, gone: false }), "↓3");
  assert.strictEqual(trackingLabel({ ahead: 2, behind: 0, gone: false }), "↑2");
});

test("a branch level with its upstream is left unmarked", () => {
  assert.strictEqual(trackingLabel({ ahead: 0, behind: 0, gone: false }), "");
});

test("a branch following nothing is left unmarked too", () => {
  assert.strictEqual(trackingLabel(null), "");
  assert.strictEqual(trackingLabel(undefined), "");
});

test("an upstream that is gone says so in a word", () => {
  assert.strictEqual(trackingLabel({ ahead: 0, behind: 0, gone: true }), "gone");
});

// --- the same thing as a sentence ------------------------------------------------------

function branch(track) {
  return { name: "main", ref: "refs/heads/main", kind: KIND_HEAD, track };
}

test("the footer names the branch, the upstream, and which way the work is going", () => {
  assert.strictEqual(
    describeTracking(branch({ upstream: "origin/main", ahead: 0, behind: 3, gone: false })),
    "main is 3 behind origin/main"
  );
  assert.strictEqual(
    describeTracking(branch({ upstream: "origin/main", ahead: 2, behind: 0, gone: false })),
    "main is 2 ahead of origin/main"
  );
  assert.strictEqual(
    describeTracking(branch({ upstream: "origin/main", ahead: 0, behind: 0, gone: false })),
    "main is up to date with origin/main"
  );
});

test("a branch with work at both ends is called diverged", () => {
  const said = describeTracking(
    branch({ upstream: "origin/main", ahead: 2, behind: 3, gone: false })
  );

  assert.match(said, /diverged/);
  assert.match(said, /2 here/);
  assert.match(said, /3 there/);
});

test("the sentences for a branch with no upstream, and for no branch at all", () => {
  assert.strictEqual(describeTracking(branch(null)), "main follows no branch");
  assert.strictEqual(
    describeTracking(branch({ upstream: "origin/old", ahead: 0, behind: 0, gone: true })),
    "origin/old is gone"
  );
  assert.strictEqual(describeTracking(null), "not on a branch");
  assert.strictEqual(describeTracking(undefined), "not on a branch");
});

// --- where a push would go ---------------------------------------------------------------

test("an upstream is split at the slash a remote answers to, not at the first one", () => {
  // A branch may be called feat/x, so the first slash is not the one that matters
  assert.deepStrictEqual(splitUpstream("origin/feat/x", ["origin"]), {
    remote: "origin",
    ref: "feat/x",
  });
  assert.deepStrictEqual(splitUpstream("upstream/main", ["origin", "upstream"]), {
    remote: "upstream",
    ref: "main",
  });
});

test("an upstream belonging to no remote is one nothing can be pushed to", () => {
  // git allows a branch to follow a local one, which is not somewhere to send commits
  assert.strictEqual(splitUpstream("main", ["origin"]), null);
  assert.strictEqual(splitUpstream("origin/main", []), null);
});

test("a branch that follows something goes back to exactly that", () => {
  // Arrange: an upstream under a different name from the branch's own
  const followed = branch({ upstream: "origin/renamed", ahead: 1, behind: 0, gone: false });

  // Act
  const target = pushTarget(followed, ["origin"]);

  // Assert
  assert.deepStrictEqual(target, { remote: "origin", ref: "renamed", setUpstream: false });
});

test("a branch that follows nothing is sent to origin, and follows it from then on", () => {
  assert.deepStrictEqual(pushTarget(branch(null), ["origin", "fork"]), {
    remote: "origin",
    ref: "main",
    setUpstream: true,
  });
});

test("an upstream deleted at the other end is made again rather than pushed to", () => {
  const gone = branch({ upstream: "origin/main", ahead: 1, behind: 0, gone: true });

  assert.deepStrictEqual(pushTarget(gone, ["origin"]), {
    remote: "origin",
    ref: "main",
    setUpstream: true,
  });
});

test("one remote is chosen without being named origin, and several are not guessed at", () => {
  assert.deepStrictEqual(pushTarget(branch(null), ["fork"]), {
    remote: "fork",
    ref: "main",
    setUpstream: true,
  });
  assert.strictEqual(pushTarget(branch(null), ["fork", "theirs"]), null);
  assert.strictEqual(pushTarget(branch(null), []), null);
});

// --- how old the counts are ------------------------------------------------------------

test("a repository that has never fetched says so rather than claiming a time", () => {
  assert.strictEqual(fetchAge(null, 1000), "never fetched");
  assert.strictEqual(fetchAge(undefined, 1000), "never fetched");
});

test("the age is coarse: just now, then minutes, hours and days", () => {
  const now = 10 * DAY_MS;

  assert.strictEqual(fetchAge(now - 1000, now), "fetched just now");
  assert.strictEqual(fetchAge(now - 20 * MINUTE_MS, now), "fetched 20m ago");
  assert.strictEqual(fetchAge(now - 5 * HOUR_MS, now), "fetched 5h ago");
  assert.strictEqual(fetchAge(now - 3 * DAY_MS, now), "fetched 3d ago");
});

test("a clock that has gone backwards is read as just now rather than as the future", () => {
  assert.strictEqual(fetchAge(2000, 1000), "fetched just now");
});

// --- against a real repository ---------------------------------------------------------

test("a branch behind its upstream is counted from the copy a fetch left", (t) => {
  // Arrange: the other end moves twice, and this repository is told about it
  const { origin, work } = makeClone(t);
  commitOnOrigin(origin, "two");
  commitOnOrigin(origin, "three");
  run(work, ["fetch", "-q"]);

  // Act
  const tracking = loadTracking(work);

  // Assert
  assert.deepStrictEqual(tracking, [
    { name: "main", upstream: "origin/main", ahead: 0, behind: 2, gone: false },
  ]);
});

test("nothing is counted until the remote has been asked", (t) => {
  // Arrange: the other end moves and nobody fetches
  const { origin, work } = makeClone(t);
  commitOnOrigin(origin, "two");

  // Act
  const [main] = loadTracking(work);

  // Assert: the copy under refs/remotes still says what it said at clone time
  assert.strictEqual(main.behind, 0);
});

test("a repository with no remote at all has nothing to track", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "herdr-deep-code-reading-solo-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  run(root, ["init", "-q", "-b", "main"]);
  fs.writeFileSync(path.join(root, "a.txt"), "one\n");
  run(root, ["add", "-A"]);
  run(root, [...GIT_IDENTITY, "commit", "-qm", "one"]);

  assert.deepStrictEqual(loadTracking(root), []);
});

test("a directory that is not a repository answers with no tracking rather than throwing", () => {
  assert.deepStrictEqual(loadTracking(os.tmpdir()), []);
  assert.strictEqual(lastFetch(os.tmpdir()), null);
});

test("nothing has been fetched in a fresh clone, and something has after a fetch", (t) => {
  // Arrange
  const { work } = makeClone(t);
  assert.strictEqual(lastFetch(work), null, "a clone writes no FETCH_HEAD");

  // Act
  run(work, ["fetch", "-q"]);

  // Assert
  const at = lastFetch(work);
  assert.ok(typeof at === "number" && at > 0);
});

// --- what the branch list carries ------------------------------------------------------

test("the branch list carries each local branch's distance from its upstream", (t) => {
  // Arrange
  const { origin, work } = makeClone(t);
  commitOnOrigin(origin, "two");
  run(work, ["fetch", "-q"]);

  // Act
  const loaded = loadBranches(work);

  // Assert
  assert.ok(loaded.ok);
  const head = headBranchOf(loaded.branches);
  assert.strictEqual(head.name, "main");
  assert.deepStrictEqual(head.track, {
    upstream: "origin/main",
    ahead: 0,
    behind: 1,
    gone: false,
  });
});

test("only a local branch carries tracking; a remote copy and a tag carry none", () => {
  // Arrange
  const branches = [
    { name: "main", ref: "refs/heads/main", kind: KIND_HEAD },
    { name: "side", ref: "refs/heads/side", kind: KIND_LOCAL },
    { name: "origin/main", ref: "refs/remotes/origin/main", kind: KIND_REMOTE },
  ];
  const tracking = [
    { name: "main", upstream: "origin/main", ahead: 1, behind: 0, gone: false },
    // A remote-tracking ref follows nothing, and a local branch may be named like one
    { name: "origin/main", upstream: "origin/other", ahead: 9, behind: 9, gone: false },
  ];

  // Act
  const attached = withTracking(branches, tracking);

  // Assert
  assert.deepStrictEqual(
    attached.map((entry) => (entry.track === null ? null : entry.track.ahead)),
    [1, null, null]
  );
});

test("there is no branch to report on a detached HEAD", (t) => {
  // Arrange
  const { work } = makeClone(t);
  run(work, ["checkout", "-q", "--detach"]);

  // Act
  const loaded = loadBranches(work);

  // Assert
  assert.ok(loaded.ok);
  assert.strictEqual(headBranchOf(loaded.branches), null);
  assert.strictEqual(headBranchOf(undefined), null);
});
