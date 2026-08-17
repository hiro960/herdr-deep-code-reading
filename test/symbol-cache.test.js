"use strict";

// A symbol query costs a git grep, and it is re-asked on every keystroke.
//
// `git grep -F` matches literal text, so every line holding "abc" also holds "ab":
// the hits for a longer query are a subset of the hits for the query it grew out of.
// Typing forward can therefore be answered from what the last grep already found.
//
// That only holds while the earlier answer was complete. The search stops at a cap,
// and narrowing a truncated list would hide matches that never made it into it.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const { MAX_HITS, runSearch } = require("../lib/search");
const { narrowedHits } = require("../lib/quick-open");
const { openQuickFind, withQuickFind } = require("../lib/state/views");
const { createState } = require("../lib/app-state");

const GIT_IDENTITY = ["-c", "user.email=t@t", "-c", "user.name=t"];
const COLUMNS = 120;
const NOWHERE = "/nonexistent-herdr-deep-code-reading-repository";

function run(cwd, args) {
  execFileSync("git", args, { cwd, stdio: "ignore" });
}

/** A repository with a handful of definitions to find. */
function makeRepo(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "herdr-deep-code-reading-symbol-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  run(root, ["init", "-q"]);
  fs.writeFileSync(
    path.join(root, "a.js"),
    ["function renderPanel() {}", "function renderPane() {}", "function readPanel() {}", ""].join("\n")
  );
  fs.writeFileSync(path.join(root, "b.js"), "function renderPanelRow() {}\n");
  run(root, ["add", "."]);
  run(root, [...GIT_IDENTITY, "commit", "-qm", "init"]);

  return root;
}

test("reports how many hits there were before the cap", (t) => {
  // Arrange
  const root = makeRepo(t);

  // Act
  const result = runSearch(root, "function");

  // Assert: a caller reusing the hits has to know whether it has all of them
  assert.strictEqual(result.ok, true);
  assert.strictEqual(typeof result.total, "number");
  assert.strictEqual(result.total, result.hits.length);
  assert.ok(result.total <= MAX_HITS);
});

test("narrows a set of hits the way a longer literal query would", () => {
  // Arrange
  const hits = [
    { path: "a.js", line: 1, text: "function renderPanel() {}" },
    { path: "a.js", line: 2, text: "function renderPane() {}" },
    { path: "a.js", line: 3, text: "function readPanel() {}" },
  ];

  // Act
  const narrowed = narrowedHits(hits, "renderPanel");

  // Assert
  assert.deepStrictEqual(narrowed.map((hit) => hit.line), [1]);
});

test("narrows without regard to case, as the search itself does", () => {
  // Arrange
  const hits = [{ path: "a.js", line: 1, text: "function renderPanel() {}" }];

  // Act
  const narrowed = narrowedHits(hits, "RENDERPANEL");

  // Assert
  assert.strictEqual(narrowed.length, 1);
});

test("answers a longer query without searching again", (t) => {
  // Arrange: type "@render", then extend it to "@renderPanel"
  const root = makeRepo(t);
  const first = withQuickFind(openQuickFind(createState(root, "review", COLUMNS)), "@render");
  assert.ok(first.hits.length > 0, "the first query found nothing to narrow");

  // Act: the repository is moved out from under it, so a second grep cannot succeed
  const extended = withQuickFind({ ...first, repoDir: NOWHERE }, "@renderPanel");

  // Assert: answered from what the first search already had
  assert.deepStrictEqual(
    extended.hits.map((hit) => hit.name).sort(),
    ["renderPanel", "renderPanelRow"]
  );
});

test("searches again when the query stops extending the last one", (t) => {
  // Arrange
  const root = makeRepo(t);
  const first = withQuickFind(openQuickFind(createState(root, "review", COLUMNS)), "@renderPanel");

  // Act: backspacing to a shorter query needs hits the cached set never held
  const shortened = withQuickFind({ ...first, repoDir: NOWHERE }, "@render");

  // Assert: it went back to git rather than answering from a set that is too small
  assert.strictEqual(shortened.hits.length, 0);
  assert.match(shortened.rows[0].text, /Could not look for render/);
});

test("does not narrow a set the cap has already cut short", (t) => {
  // Arrange: a cached answer that stopped at the cap is not a superset of anything
  const root = makeRepo(t);
  const first = withQuickFind(openQuickFind(createState(root, "review", COLUMNS)), "@render");
  const truncated = {
    ...first,
    repoDir: NOWHERE,
    symbolSearch: { ...first.symbolSearch, complete: false },
  };

  // Act
  const extended = withQuickFind(truncated, "@renderPanel");

  // Assert: it searched again rather than trusting a list it knows is short
  assert.match(extended.rows[0].text, /Could not look for renderPanel/);
});

test("forgets the last search when the quick find is opened again", (t) => {
  // Arrange
  const root = makeRepo(t);
  const used = withQuickFind(openQuickFind(createState(root, "review", COLUMNS)), "@render");
  assert.notStrictEqual(used.symbolSearch, null);

  // Act
  const reopened = openQuickFind(used);

  // Assert: a session's cache says what the repository held while it was open, and
  // the next one starts after however long the reader spent away
  assert.strictEqual(reopened.symbolSearch, null);
});
