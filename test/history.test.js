"use strict";

// Reading the repository's past: which commits there are, and how they are asked for.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const {
  MAX_COMMITS,
  NOTE_NO_COMMITS,
  commitHits,
  commitRows,
  historyTitle,
  loadCommits,
  logArgs,
  parseCommits,
} = require("../lib/history");

const NUL = "\u0000";
const UNIT = "\u001f";
const GIT_IDENTITY = ["-c", "user.email=test@example.com", "-c", "user.name=herdr-deep-code-reading test"];

/** One record, in the order COMMIT_FORMAT writes them. */
function record(sha, shortSha, date, author, subject, parents) {
  return [sha, shortSha, parents === undefined ? "" : parents, date, author, subject].join(UNIT);
}

function run(cwd, args) {
  execFileSync("git", args, { cwd, stdio: "ignore" });
}

// --- parsing ------------------------------------------------------------------

test("reads one commit per record", () => {
  const stdout = record("full-sha", "short", "2026-08-15", "A Reader", "the subject");

  assert.deepStrictEqual(parseCommits(stdout), [
    {
      sha: "full-sha",
      shortSha: "short",
      parents: [],
      date: "2026-08-15",
      author: "A Reader",
      subject: "the subject",
    },
  ]);
});

test("a merge carries both of the shas it was made from", () => {
  const stdout = record("m", "m", "2026-08-15", "R", "merge it", "first second");

  assert.deepStrictEqual(parseCommits(stdout)[0].parents, ["first", "second"]);
});

test("reads several, in the order git gave them", () => {
  const stdout = [
    record("a", "a", "2026-08-15", "one", "newest"),
    record("b", "b", "2026-08-14", "two", "older"),
  ].join(NUL);

  assert.deepStrictEqual(
    parseCommits(stdout).map((commit) => commit.subject),
    ["newest", "older"]
  );
});

test("the newline git puts between records is not part of the sha", () => {
  const stdout = [
    record("a", "a", "2026-08-15", "one", "first"),
    "\n" + record("b", "b", "2026-08-14", "two", "second"),
  ].join(NUL);

  assert.strictEqual(parseCommits(stdout)[1].sha, "b");
});

test("a subject with an author's name in it stays whole", () => {
  const stdout = record("a", "a", "2026-08-15", "one", "fix: handle a — b — c");

  assert.strictEqual(parseCommits(stdout)[0].subject, "fix: handle a — b — c");
});

test("a record with fields missing is skipped, not guessed at", () => {
  const stdout = ["not a record at all", record("a", "a", "d", "n", "kept")].join(NUL);

  assert.deepStrictEqual(
    parseCommits(stdout).map((commit) => commit.subject),
    ["kept"]
  );
});

test("nothing at all reads as no commits", () => {
  assert.deepStrictEqual(parseCommits(""), []);
  assert.deepStrictEqual(parseCommits(NUL), []);
});

// --- what git is asked ----------------------------------------------------------

test("the whole repository is a plain log", () => {
  const args = logArgs();

  assert.strictEqual(args[0], "log");
  assert.ok(args.includes(`--max-count=${MAX_COMMITS}`));
  assert.ok(!args.includes("--follow"));
  assert.ok(!args.includes("-L"));
});

test("one file's history follows it through renames", () => {
  const args = logArgs({ path: "lib/a.js" });

  assert.ok(args.includes("--follow"));
  assert.deepStrictEqual(args.slice(-2), ["--", "lib/a.js"]);
});

test("a run of lines is asked for with -L, and without a patch", () => {
  const args = logArgs({ path: "lib/a.js", start: 10, end: 20 });

  assert.deepStrictEqual(args.slice(0, 3), ["log", "-L", "10,20:lib/a.js"]);
  assert.ok(args.includes("-s"), "-L brings a patch with it unless -s says otherwise");
  assert.ok(!args.includes("--follow"), "-L cannot be combined with --follow");
});

// --- what the header calls each list ---------------------------------------------

test("each list names what it is a history of", () => {
  assert.strictEqual(historyTitle(undefined, 12), "commits  (12)");
  assert.strictEqual(historyTitle({ path: "lib/a.js" }, 3), "history: lib/a.js  (3)");
  assert.strictEqual(
    historyTitle({ path: "lib/a.js", start: 10, end: 20 }, 2),
    "history: lib/a.js:10-20  (2)"
  );
});

test("a single line is named by its number alone", () => {
  assert.strictEqual(
    historyTitle({ path: "a.js", start: 7, end: 7 }, 1),
    "history: a.js:7  (1)"
  );
});

// --- the rows they become ---------------------------------------------------------

test("a commit is a hit that opens a diff rather than a file", () => {
  const [hit] = commitHits([
    { sha: "full", shortSha: "abc1234", date: "2026-08-15", author: "R", subject: "fix it" },
  ]);

  assert.strictEqual(hit.isCommit, true);
  assert.strictEqual(hit.path, null, "a commit is not at a line of a file");
  assert.match(hit.label, /abc1234/);
  assert.match(hit.label, /2026-08-15/);
  assert.match(hit.text, /fix it/);
  assert.strictEqual(hit.commit.sha, "full");
});

test("an empty history says so rather than showing nothing", () => {
  const rows = commitRows([]);

  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].kind, "note");
  assert.strictEqual(rows[0].text, NOTE_NO_COMMITS);
});

// --- against a real repository ------------------------------------------------------

function makeRepo(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "herdr-deep-code-reading-history-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  run(root, ["init", "-q"]);
  fs.writeFileSync(path.join(root, "a.js"), "one\ntwo\nthree\n");
  fs.writeFileSync(path.join(root, "b.js"), "untouched\n");
  run(root, ["add", "-A"]);
  run(root, [...GIT_IDENTITY, "commit", "-qm", "first"]);

  fs.writeFileSync(path.join(root, "a.js"), "one\nchanged\nthree\n");
  run(root, ["add", "-A"]);
  run(root, [...GIT_IDENTITY, "commit", "-qm", "second"]);

  return root;
}

test("lists a repository's commits, newest first", (t) => {
  const root = makeRepo(t);

  const result = loadCommits(root);

  assert.strictEqual(result.ok, true);
  assert.deepStrictEqual(
    result.commits.map((commit) => commit.subject),
    ["second", "first"]
  );
});

test("a file's history covers only the commits that touched it", (t) => {
  const root = makeRepo(t);

  assert.strictEqual(loadCommits(root, { path: "a.js" }).commits.length, 2);
  assert.strictEqual(loadCommits(root, { path: "b.js" }).commits.length, 1);
});

test("a line's history covers only the commits that moved it", (t) => {
  const root = makeRepo(t);

  const lineTwo = loadCommits(root, { path: "a.js", start: 2, end: 2 });
  const lineThree = loadCommits(root, { path: "a.js", start: 3, end: 3 });

  assert.deepStrictEqual(lineTwo.commits.map((c) => c.subject), ["second", "first"]);
  assert.deepStrictEqual(lineThree.commits.map((c) => c.subject), ["first"]);
});

test("a repository with no commits answers with none, not a failure", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "herdr-deep-code-reading-history-empty-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  run(root, ["init", "-q"]);

  const result = loadCommits(root);

  assert.strictEqual(result.ok, true);
  assert.deepStrictEqual(result.commits, []);
});

test("a path git has never heard of is reported, not thrown", (t) => {
  const root = makeRepo(t);

  const result = loadCommits(root, { path: "nowhere.js", start: 1, end: 2 });

  assert.strictEqual(result.ok, false);
  assert.ok(result.error);
});
