"use strict";

// The branch list down the left of the log: what the repository's refs are, grouped
// the way a reader thinks of them.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const { KIND_HEAD, KIND_LOCAL, KIND_REMOTE, KIND_TAG } = require("../lib/graph");
const {
  HEADING_BRANCHES,
  HEADING_REMOTES,
  HEADING_TAGS,
  branchAt,
  branchRows,
  loadBranches,
  parseRefLines,
  refIndexOf,
} = require("../lib/refs");

const UNIT = "\u001f";
const GIT_IDENTITY = ["-c", "user.email=test@example.com", "-c", "user.name=herdr-deep-code-reading test"];

function line(shortName, fullName, headMark) {
  return [shortName, fullName, headMark].join(UNIT);
}

function run(cwd, args) {
  execFileSync("git", args, { cwd, stdio: "ignore" });
}

// --- reading what for-each-ref wrote -------------------------------------------------

test("a local branch, a remote one and a tag are told apart by where they live", () => {
  const stdout = [
    line("main", "refs/heads/main", " "),
    line("origin/main", "refs/remotes/origin/main", " "),
    line("v1.0.0", "refs/tags/v1.0.0", " "),
  ].join("\n");

  assert.deepStrictEqual(
    parseRefLines(stdout).map((branch) => branch.kind),
    [KIND_LOCAL, KIND_REMOTE, KIND_TAG]
  );
});

test("the branch HEAD is on is the one git marks", () => {
  const stdout = [
    line("main", "refs/heads/main", " "),
    line("feat/x", "refs/heads/feat/x", "*"),
  ].join("\n");

  const branches = parseRefLines(stdout);

  assert.strictEqual(branches[0].kind, KIND_LOCAL);
  assert.strictEqual(branches[1].kind, KIND_HEAD);
});

test("a branch keeps the full ref as well as the name it is known by", () => {
  const [branch] = parseRefLines(line("feat/x", "refs/heads/feat/x", " "));

  assert.strictEqual(branch.name, "feat/x");
  assert.strictEqual(branch.ref, "refs/heads/feat/x");
});

test("origin/HEAD is a pointer at a branch rather than a branch", () => {
  const stdout = [
    line("origin/HEAD", "refs/remotes/origin/HEAD", " "),
    line("origin/main", "refs/remotes/origin/main", " "),
  ].join("\n");

  assert.deepStrictEqual(
    parseRefLines(stdout).map((branch) => branch.name),
    ["origin/main"]
  );
});

test("a line that is not a record is skipped rather than guessed at", () => {
  const stdout = ["nonsense", line("main", "refs/heads/main", " ")].join("\n");

  assert.deepStrictEqual(
    parseRefLines(stdout).map((branch) => branch.name),
    ["main"]
  );
});

test("a ref living somewhere else entirely is left out", () => {
  const stdout = line("stash", "refs/stash", " ");

  assert.deepStrictEqual(parseRefLines(stdout), []);
});

test("nothing at all reads as no branches", () => {
  assert.deepStrictEqual(parseRefLines(""), []);
});

// --- the rows they become ---------------------------------------------------------

test("each group is drawn under a heading of its own", () => {
  const branches = parseRefLines(
    [
      line("main", "refs/heads/main", "*"),
      line("origin/main", "refs/remotes/origin/main", " "),
      line("v1.0.0", "refs/tags/v1.0.0", " "),
    ].join("\n")
  );

  assert.deepStrictEqual(
    branchRows(branches).map((row) => (row.kind === "heading" ? row.text : row.branch.name)),
    [HEADING_BRANCHES, "main", HEADING_REMOTES, "origin/main", HEADING_TAGS, "v1.0.0"]
  );
});

test("a group nothing belongs to gets no heading", () => {
  const branches = parseRefLines(line("main", "refs/heads/main", "*"));

  assert.deepStrictEqual(
    branchRows(branches).map((row) => row.kind),
    ["heading", "branch"]
  );
});

test("an empty repository still says what the list is for", () => {
  const rows = branchRows([]);

  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].kind, "note");
});

// --- moving through them -------------------------------------------------------------

test("the branch a row index points at, when it points at one", () => {
  const rows = branchRows(parseRefLines(line("main", "refs/heads/main", "*")));

  assert.strictEqual(branchAt(rows, 0), null, "a heading is not a branch");
  assert.strictEqual(branchAt(rows, 1).name, "main");
  assert.strictEqual(branchAt(rows, 9), null);
});

test("the row a named ref sits on, so the list opens on the branch being read", () => {
  const rows = branchRows(
    parseRefLines(
      [line("main", "refs/heads/main", "*"), line("side", "refs/heads/side", " ")].join("\n")
    )
  );

  assert.strictEqual(refIndexOf(rows, "side"), 2);
  assert.strictEqual(refIndexOf(rows, "nowhere"), -1);
});

test("nothing named lands on the first branch there is", () => {
  const rows = branchRows(parseRefLines(line("main", "refs/heads/main", "*")));

  assert.strictEqual(refIndexOf(rows, null), 1, "past the heading above it");
});

// --- against a real repository ---------------------------------------------------------

test("reads a real repository's branches and tags", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "herdr-deep-code-reading-refs-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  run(root, ["init", "-q", "-b", "main"]);
  fs.writeFileSync(path.join(root, "a.txt"), "one\n");
  run(root, ["add", "-A"]);
  run(root, [...GIT_IDENTITY, "commit", "-qm", "root"]);
  run(root, ["branch", "side"]);
  run(root, ["tag", "v1.0.0"]);

  const result = loadBranches(root);

  assert.strictEqual(result.ok, true);
  assert.deepStrictEqual(
    result.branches.map((branch) => `${branch.kind}:${branch.name}`),
    [`${KIND_HEAD}:main`, `${KIND_LOCAL}:side`, `${KIND_TAG}:v1.0.0`]
  );
});

test("a repository with no commits has no branches, and that is not a failure", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "herdr-deep-code-reading-refs-empty-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  run(root, ["init", "-q"]);

  const result = loadBranches(root);

  assert.strictEqual(result.ok, true);
  assert.deepStrictEqual(result.branches, []);
});
