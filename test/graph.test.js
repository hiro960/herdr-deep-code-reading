"use strict";

// Reading the commit graph git draws: which line is a commit, which is only an edge,
// and what the decoration on a commit says about where the branches are.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const {
  KIND_HEAD,
  KIND_LOCAL,
  KIND_REMOTE,
  KIND_TAG,
  graphLogArgs,
  graphWidth,
  laneOfColumn,
  loadGraph,
  parseGraphLog,
  parseRefs,
} = require("../lib/graph");

const RECORD = "\u001e";
const UNIT = "\u001f";
const GIT_IDENTITY = ["-c", "user.email=test@example.com", "-c", "user.name=herdr-deep-code-reading test"];

/** One line of `git log --graph` output, as git writes it. */
function commitLine(graph, fields) {
  const { sha, shortSha, parents, date, author, refs, subject } = fields;
  const record = [sha, shortSha, parents || "", date, author, refs || "", subject];
  return graph + RECORD + record.join(UNIT);
}

function run(cwd, args) {
  execFileSync("git", args, { cwd, stdio: "ignore" });
}

// --- telling a commit from an edge -------------------------------------------------

test("a line carrying the record separator is a commit", () => {
  const stdout = commitLine("* ", {
    sha: "full",
    shortSha: "abc1234",
    date: "2026-08-15",
    author: "A Reader",
    subject: "fix it",
  });

  const rows = parseGraphLog(stdout, []);

  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].graph, "*");
  assert.strictEqual(rows[0].commit.shortSha, "abc1234");
  assert.strictEqual(rows[0].commit.subject, "fix it");
});

test("a line without one is an edge, and carries no commit", () => {
  const stdout = ["|\\  ", "| |/  "].join("\n");

  const rows = parseGraphLog(stdout, []);

  assert.deepStrictEqual(rows, [
    { graph: "|\\", commit: null },
    { graph: "| |/", commit: null },
  ]);
});

test("the edges between two commits are kept, in the order git drew them", () => {
  const stdout = [
    commitLine("*   ", { sha: "a", shortSha: "a", date: "d", author: "n", subject: "merge" }),
    "|\\  ",
    "| |/  ",
    commitLine("| * ", { sha: "b", shortSha: "b", date: "d", author: "n", subject: "side" }),
  ].join("\n");

  const rows = parseGraphLog(stdout, []);

  assert.deepStrictEqual(
    rows.map((row) => (row.commit === null ? row.graph : row.commit.subject)),
    ["merge", "|\\", "| |/", "side"]
  );
});

test("the graph column of a commit line stops at the record separator", () => {
  const stdout = commitLine("| * ", {
    sha: "a",
    shortSha: "a",
    date: "d",
    author: "n",
    subject: "s",
  });

  assert.strictEqual(parseGraphLog(stdout, [])[0].graph, "| *");
});

test("a record with fields missing is skipped rather than guessed at", () => {
  const stdout = [
    "* " + RECORD + "only-one-field",
    commitLine("* ", { sha: "a", shortSha: "a", date: "d", author: "n", subject: "kept" }),
  ].join("\n");

  assert.deepStrictEqual(
    parseGraphLog(stdout, []).map((row) => row.commit.subject),
    ["kept"]
  );
});

test("a subject holding the field separator stays whole", () => {
  const stdout = commitLine("* ", {
    sha: "a",
    shortSha: "a",
    date: "d",
    author: "n",
    subject: `fix: a${UNIT}b`,
  });

  assert.strictEqual(parseGraphLog(stdout, [])[0].commit.subject, `fix: a${UNIT}b`);
});

test("a merge carries both of the shas it was made from", () => {
  const stdout = commitLine("*   ", {
    sha: "m",
    shortSha: "m",
    parents: "first second",
    date: "d",
    author: "n",
    subject: "merge it",
  });

  assert.deepStrictEqual(parseGraphLog(stdout, [])[0].commit.parents, ["first", "second"]);
});

test("the very first commit of a repository has no parent at all", () => {
  const stdout = commitLine("* ", {
    sha: "r",
    shortSha: "r",
    date: "d",
    author: "n",
    subject: "root",
  });

  assert.deepStrictEqual(parseGraphLog(stdout, [])[0].commit.parents, []);
});

test("nothing at all reads as no rows", () => {
  assert.deepStrictEqual(parseGraphLog("", []), []);
  assert.deepStrictEqual(parseGraphLog("\n\n", []), []);
});

// --- what the decoration says ------------------------------------------------------

test("the branch HEAD points at is told apart from the rest", () => {
  const refs = parseRefs("HEAD -> main, origin/main, feat/x", ["origin"]);

  assert.deepStrictEqual(refs, [
    { name: "main", kind: KIND_HEAD },
    { name: "origin/main", kind: KIND_REMOTE },
    { name: "feat/x", kind: KIND_LOCAL },
  ]);
});

test("a tag is named without the prefix git writes it with", () => {
  const refs = parseRefs("tag: v1.0.0", []);

  assert.deepStrictEqual(refs, [{ name: "v1.0.0", kind: KIND_TAG }]);
});

test("a detached HEAD is a head of its own", () => {
  assert.deepStrictEqual(parseRefs("HEAD, origin/main", ["origin"]), [
    { name: "HEAD", kind: KIND_HEAD },
    { name: "origin/main", kind: KIND_REMOTE },
  ]);
});

test("a remote is only a remote when a remote of that name exists", () => {
  // A local branch may be called anything, `origin/thing` included, and calling it a
  // remote because of its name would put it under the wrong colour and the wrong list
  assert.deepStrictEqual(parseRefs("origin/main", []), [
    { name: "origin/main", kind: KIND_LOCAL },
  ]);
});

test("a commit nothing points at has no refs", () => {
  assert.deepStrictEqual(parseRefs("", ["origin"]), []);
  assert.deepStrictEqual(parseRefs(undefined, ["origin"]), []);
});

test("a commit's refs come through the parse", () => {
  const stdout = commitLine("* ", {
    sha: "a",
    shortSha: "a",
    date: "d",
    author: "n",
    refs: "HEAD -> main",
    subject: "s",
  });

  assert.deepStrictEqual(parseGraphLog(stdout, [])[0].commit.refs, [
    { name: "main", kind: KIND_HEAD },
  ]);
});

// --- the column the graph is drawn in ------------------------------------------------

test("the graph column is as wide as its widest row", () => {
  const rows = [{ graph: "*" }, { graph: "| |/" }, { graph: "* |" }];

  assert.strictEqual(graphWidth(rows), "| |/".length + 1);
});

test("an empty graph still leaves a column", () => {
  assert.strictEqual(graphWidth([]), 1);
});

test("two characters of graph are one lane", () => {
  assert.strictEqual(laneOfColumn(0), 0);
  assert.strictEqual(laneOfColumn(1), 0);
  assert.strictEqual(laneOfColumn(2), 1);
  assert.strictEqual(laneOfColumn(3), 1);
  assert.strictEqual(laneOfColumn(4), 2);
});

// --- what git is asked ---------------------------------------------------------------

test("every branch is asked for by default", () => {
  const args = graphLogArgs({});

  assert.strictEqual(args[0], "log");
  assert.ok(args.includes("--graph"));
  assert.ok(args.includes("--all"));
});

test("one ref narrows the log to it, and drops --all", () => {
  const args = graphLogArgs({ ref: "feat/x" });

  assert.ok(!args.includes("--all"));
  // The trailing `--` keeps a branch named like a file from being read as one
  assert.deepStrictEqual(args.slice(-2), ["feat/x", "--"]);
});

// --- against a real repository ---------------------------------------------------------

function makeRepo(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "herdr-deep-code-reading-graph-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  run(root, ["init", "-q", "-b", "main"]);
  fs.writeFileSync(path.join(root, "a.txt"), "one\n");
  run(root, ["add", "-A"]);
  run(root, [...GIT_IDENTITY, "commit", "-qm", "root"]);

  run(root, ["checkout", "-q", "-b", "side"]);
  fs.writeFileSync(path.join(root, "b.txt"), "two\n");
  run(root, ["add", "-A"]);
  run(root, [...GIT_IDENTITY, "commit", "-qm", "on the side"]);

  run(root, ["checkout", "-q", "main"]);
  fs.writeFileSync(path.join(root, "a.txt"), "one\ntwo\n");
  run(root, ["add", "-A"]);
  run(root, [...GIT_IDENTITY, "commit", "-qm", "on main"]);
  run(root, [...GIT_IDENTITY, "merge", "-q", "--no-ff", "side", "-m", "merge side"]);

  return root;
}

test("a real merge brings edge rows with it", (t) => {
  const root = makeRepo(t);

  const result = loadGraph(root, {});

  assert.strictEqual(result.ok, true);
  // Topological order, which --graph implies: a side branch is drawn out before the
  // trunk it left, so that no commit is ever above its own parent
  const subjects = result.rows.filter((row) => row.commit !== null).map((row) => row.commit.subject);
  assert.deepStrictEqual(subjects, ["merge side", "on the side", "on main", "root"]);
  assert.ok(
    result.rows.some((row) => row.commit === null),
    "a merge cannot be drawn without an edge row"
  );
});

test("the branches a commit carries are read off the real repository", (t) => {
  const root = makeRepo(t);

  const [head] = loadGraph(root, {}).rows;

  assert.deepStrictEqual(head.commit.refs, [{ name: "main", kind: KIND_HEAD }]);
});

test("narrowing to one branch leaves the other's commits out", (t) => {
  const root = makeRepo(t);

  const result = loadGraph(root, { ref: "side" });

  assert.deepStrictEqual(
    result.rows.filter((row) => row.commit !== null).map((row) => row.commit.subject),
    ["on the side", "root"]
  );
});

test("a repository with no commits answers with none, not a failure", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "herdr-deep-code-reading-graph-empty-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  run(root, ["init", "-q"]);

  const result = loadGraph(root, {});

  assert.strictEqual(result.ok, true);
  assert.deepStrictEqual(result.rows, []);
});

test("a ref git has never heard of is reported, not thrown", (t) => {
  const root = makeRepo(t);

  const result = loadGraph(root, { ref: "nowhere" });

  assert.strictEqual(result.ok, false);
  assert.ok(result.error);
});
