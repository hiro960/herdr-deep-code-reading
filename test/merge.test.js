"use strict";

// A merge that stopped, and the git commands that settle it.
//
// The seven kinds of conflict are not seven shades of the same thing: three of them
// have no version of the file on one side at all, and taking that side is a deletion
// rather than a checkout. Which is which is decided from the status letters, so the
// letters are what most of this checks — and the two that can be built out of real
// commits are built and settled for real.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const {
  CONFLICT_KINDS,
  OURS,
  THEIRS,
  isMerging,
  isMergingNow,
  kindOf,
  mergeState,
  mergedConflicts,
  pathsWithMarkers,
  sideExists,
  unresolvedOf,
} = require("../lib/merge");
const { abortMerge, commitMerge, markResolved, takeSide } = require("../lib/git-merge");
const { isUnmerged, parseStatus } = require("../lib/status");

const GIT_IDENTITY = ["-c", "user.email=test@example.com", "-c", "user.name=herdr-deep-code-reading test"];

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

/** Run a command that is allowed to fail, which a conflicting merge is. */
function tryRun(cwd, args) {
  try {
    execFileSync("git", args, { cwd, stdio: "ignore" });
  } catch {
    // A merge that conflicts exits non-zero, which is the state being arranged
  }
}

/**
 * A repository stopped in the middle of a merge.
 *
 * Two files and two kinds of conflict: one both sides edited, and one this side edited
 * while the other deleted it. The second is what makes the difference between the
 * commands worth testing — there is no version of it on the other side to check out.
 */
function makeStoppedMerge(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "herdr-deep-code-reading-merge-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  run(root, ["init", "-q", "-b", "main"]);
  fs.writeFileSync(path.join(root, "a.txt"), "one\ntwo\nthree\n");
  fs.writeFileSync(path.join(root, "b.txt"), "keep\n");
  run(root, ["add", "-A"]);
  run(root, [...GIT_IDENTITY, "commit", "-qm", "base"]);

  run(root, ["checkout", "-q", "-b", "side"]);
  fs.writeFileSync(path.join(root, "a.txt"), "one\ntheirs\nthree\n");
  run(root, ["rm", "-q", path.join(root, "b.txt")]);
  run(root, [...GIT_IDENTITY, "commit", "-qam", "theirs"]);

  run(root, ["checkout", "-q", "main"]);
  fs.writeFileSync(path.join(root, "a.txt"), "one\nours\nthree\n");
  fs.appendFileSync(path.join(root, "b.txt"), "mine\n");
  run(root, [...GIT_IDENTITY, "commit", "-qam", "ours"]);

  tryRun(root, [...GIT_IDENTITY, "merge", "--no-edit", "side"]);

  return root;
}

function contentsOf(root, name) {
  return fs.readFileSync(path.join(root, name), "utf8");
}

function codeOf(root, name) {
  const found = mergeState(root).conflicts.find((conflict) => conflict.path === name);
  return found === undefined ? null : found.code;
}

// --- the letters git writes ------------------------------------------------------------

test("all seven pairs of letters are read as unmerged, including the one without a U", () => {
  // Arrange: AA is both sides adding the same path, and is the one a hand-written
  // test for "either letter is U" gets wrong
  const codes = ["DD", "AU", "UD", "UA", "DU", "AA", "UU"];

  // Act & Assert
  for (const code of codes) {
    const [index, worktree] = code;
    assert.ok(isUnmerged({ index, worktree }), `${code} was not read as unmerged`);
  }
});

test("an ordinary change is not unmerged", () => {
  // The records git writes, NUL between them: modified, untracked, staged
  const entries = parseStatus([" M a.txt", "?? b.txt", "M  c.txt", ""].join("\u0000"));

  assert.strictEqual(entries.length, 3);
  assert.deepStrictEqual(entries.filter(isUnmerged), []);
});

test("each pair of letters says which conflict it is", () => {
  assert.strictEqual(kindOf("UU"), CONFLICT_KINDS.UU);
  assert.strictEqual(kindOf("UD"), "deleted by them");
  assert.strictEqual(kindOf("DU"), "deleted by us");
  // A pair nobody has a name for is still a conflict, and saying so beats guessing
  assert.strictEqual(kindOf("ZZ"), "unmerged");
});

test("three of the seven have no version on one side to take", () => {
  // Taking a side that deleted the file means deleting it, not checking it out
  assert.strictEqual(sideExists("UU", OURS), true);
  assert.strictEqual(sideExists("UU", THEIRS), true);
  assert.strictEqual(sideExists("DU", OURS), false, "we deleted it");
  assert.strictEqual(sideExists("DU", THEIRS), true);
  assert.strictEqual(sideExists("UD", OURS), true);
  assert.strictEqual(sideExists("UD", THEIRS), false, "they deleted it");
  assert.strictEqual(sideExists("UA", OURS), false, "only they added it");
  assert.strictEqual(sideExists("AU", THEIRS), false, "only we added it");
  assert.strictEqual(sideExists("DD", OURS), false);
  assert.strictEqual(sideExists("DD", THEIRS), false);
});

// --- what the repository says ----------------------------------------------------------

test("a repository in the middle of a merge lists what it could not settle", (t) => {
  // Arrange
  const root = makeStoppedMerge(t);

  // Act
  const merge = mergeState(root);

  // Assert
  assert.strictEqual(merge.merging, true);
  assert.strictEqual(isMerging(root), true);
  assert.deepStrictEqual(
    merge.conflicts.map((conflict) => [conflict.path, conflict.code, conflict.kind]),
    [
      ["a.txt", "UU", "both modified"],
      ["b.txt", "UD", "deleted by them"],
    ]
  );
});

test("a repository with no merge in it has no conflicts to list", (t) => {
  // Arrange
  const root = makeStoppedMerge(t);
  abortMerge(root);

  // Act
  const merge = mergeState(root);

  // Assert
  assert.deepStrictEqual(merge, { merging: false, conflicts: [] });
  assert.strictEqual(isMergingNow(merge), false);
  assert.strictEqual(isMergingNow(null), false);
  assert.strictEqual(isMergingNow(undefined), false);
});

test("a directory that is not a repository is not in the middle of anything", () => {
  assert.strictEqual(isMerging(os.tmpdir()), false);
});

// --- the list keeps what it has already shown --------------------------------------------

test("a file that has been settled keeps its row, marked", () => {
  // Arrange: two conflicts, one of them since resolved
  const before = [
    { path: "a.txt", code: "UU", kind: "both modified", resolved: false },
    { path: "b.txt", code: "UD", kind: "deleted by them", resolved: false },
  ];
  const now = [{ path: "b.txt", code: "UD", kind: "deleted by them" }];

  // Act
  const folded = mergedConflicts(before, now);

  // Assert: the row stays, because the reader's cursor is somewhere in this list
  assert.deepStrictEqual(
    folded.map((conflict) => [conflict.path, conflict.resolved]),
    [
      ["a.txt", true],
      ["b.txt", false],
    ]
  );
  assert.deepStrictEqual(
    unresolvedOf({ conflicts: folded }).map((conflict) => conflict.path),
    ["b.txt"]
  );
});

test("a conflict nobody has seen yet is added to the end of the list", () => {
  const folded = mergedConflicts(
    [{ path: "a.txt", code: "UU", kind: "both modified", resolved: true }],
    [{ path: "c.txt", code: "AA", kind: "both added" }]
  );

  assert.deepStrictEqual(
    folded.map((conflict) => [conflict.path, conflict.resolved]),
    [
      ["a.txt", true],
      ["c.txt", false],
    ]
  );
});

test("the first reading of a merge has nothing to fold into", () => {
  const folded = mergedConflicts(null, [{ path: "a.txt", code: "UU", kind: "both modified" }]);

  assert.deepStrictEqual(folded, [
    { path: "a.txt", code: "UU", kind: "both modified", resolved: false },
  ]);
  assert.deepStrictEqual(unresolvedOf(null), []);
});

// --- taking a side -----------------------------------------------------------------------

test("taking our side of a file both sides changed keeps our version, resolved", (t) => {
  // Arrange
  const root = makeStoppedMerge(t);

  // Act
  const result = takeSide(root, "a.txt", codeOf(root, "a.txt"), OURS);

  // Assert
  assert.ok(result.ok, result.error);
  assert.strictEqual(contentsOf(root, "a.txt"), "one\nours\nthree\n");
  assert.strictEqual(codeOf(root, "a.txt"), null, "still listed as unmerged");
});

test("taking their side takes the version that arrived", (t) => {
  // Arrange
  const root = makeStoppedMerge(t);

  // Act
  const result = takeSide(root, "a.txt", codeOf(root, "a.txt"), THEIRS);

  // Assert
  assert.ok(result.ok, result.error);
  assert.strictEqual(contentsOf(root, "a.txt"), "one\ntheirs\nthree\n");
});

test("taking the side that deleted the file deletes it", (t) => {
  // Arrange: b.txt was edited here and deleted there, so theirs is a deletion
  const root = makeStoppedMerge(t);
  assert.strictEqual(codeOf(root, "b.txt"), "UD");

  // Act
  const result = takeSide(root, "b.txt", "UD", THEIRS);

  // Assert
  assert.ok(result.ok, result.error);
  assert.strictEqual(fs.existsSync(path.join(root, "b.txt")), false);
  assert.strictEqual(codeOf(root, "b.txt"), null);
});

test("taking the side that kept the file keeps it", (t) => {
  // Arrange
  const root = makeStoppedMerge(t);

  // Act
  const result = takeSide(root, "b.txt", "UD", OURS);

  // Assert
  assert.ok(result.ok, result.error);
  assert.strictEqual(contentsOf(root, "b.txt"), "keep\nmine\n");
  assert.strictEqual(codeOf(root, "b.txt"), null);
});

test("a path git will not take a side of answers with git's own refusal", (t) => {
  // Arrange
  const root = makeStoppedMerge(t);

  // Act: a file that is not in the merge at all
  const result = takeSide(root, "nothing-here.txt", "UU", OURS);

  // Assert
  assert.strictEqual(result.ok, false);
  assert.ok(result.error.length > 0);
});

// --- finishing, and not finishing --------------------------------------------------------

test("a file edited by hand is settled by saying so", (t) => {
  // Arrange: the reader's own resolution, written by the reader's own editor
  const root = makeStoppedMerge(t);
  fs.writeFileSync(path.join(root, "a.txt"), "one\nboth\nthree\n");

  // Act
  const result = markResolved(root, "a.txt");

  // Assert
  assert.ok(result.ok, result.error);
  assert.strictEqual(codeOf(root, "a.txt"), null);
});

test("a file still holding the markers is found, and one that is not is not", (t) => {
  // Arrange
  const root = makeStoppedMerge(t);

  // Act & Assert
  assert.deepStrictEqual(pathsWithMarkers(root, ["a.txt", "b.txt"]), ["a.txt"]);

  takeSide(root, "a.txt", "UU", OURS);
  assert.deepStrictEqual(pathsWithMarkers(root, ["a.txt", "b.txt"]), []);
});

test("a file that cannot be read is not one that can be shown to hold markers", (t) => {
  const root = makeStoppedMerge(t);

  assert.deepStrictEqual(pathsWithMarkers(root, ["gone.txt"]), []);
});

test("git refuses to commit a merge with anything left unmerged, and says so", (t) => {
  // Arrange
  const root = makeStoppedMerge(t);

  // Act
  const result = commitMerge(root);

  // Assert
  assert.strictEqual(result.ok, false);
  assert.match(result.error, /unmerged|resolve/i);
  assert.strictEqual(isMerging(root), true, "the merge is still there to finish");
});

test("a merge with everything settled commits, and is over", (t) => {
  // Arrange
  const root = makeStoppedMerge(t);
  takeSide(root, "a.txt", "UU", OURS);
  takeSide(root, "b.txt", "UD", OURS);

  // Act
  const result = commitMerge(root);

  // Assert
  assert.ok(result.ok, result.error);
  assert.strictEqual(isMerging(root), false);
  assert.match(result.output, /Merge branch/);
});

test("undoing a merge puts back what was there before it", (t) => {
  // Arrange
  const root = makeStoppedMerge(t);
  takeSide(root, "a.txt", "UU", THEIRS);
  assert.strictEqual(contentsOf(root, "a.txt"), "one\ntheirs\nthree\n");

  // Act
  const result = abortMerge(root);

  // Assert
  assert.ok(result.ok, result.error);
  assert.strictEqual(isMerging(root), false);
  assert.strictEqual(contentsOf(root, "a.txt"), "one\nours\nthree\n", "our own work is back");
});
