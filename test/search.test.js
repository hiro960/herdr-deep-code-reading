"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const { MAX_HITS, buildResultRows, parseGrepOutput, runSearch } = require("../lib/search");

const NUL = "\u0000";

function record(filePath, line, text) {
  return filePath + NUL + line + NUL + text;
}

// --- parsing -------------------------------------------------------------

test("parses one hit per line", () => {
  const stdout = [record("lib/a.js", "12", "const x = 1;"), ""].join("\n");

  assert.deepStrictEqual(parseGrepOutput(stdout), [
    { path: "lib/a.js", line: 12, text: "const x = 1;" },
  ]);
});

test("parses several hits", () => {
  const stdout = [
    record("a.js", "1", "one"),
    record("b.js", "2", "two"),
    "",
  ].join("\n");

  assert.deepStrictEqual(
    parseGrepOutput(stdout).map((hit) => hit.path),
    ["a.js", "b.js"]
  );
});

test("keeps a path that contains a colon", () => {
  // NUL separators are why the path is safe to read
  const stdout = record("weird:name.js", "3", "text") + "\n";

  assert.strictEqual(parseGrepOutput(stdout)[0].path, "weird:name.js");
});

test("keeps matched text that contains a colon", () => {
  const stdout = record("a.js", "4", "const url = 'http://x';") + "\n";

  assert.strictEqual(parseGrepOutput(stdout)[0].text, "const url = 'http://x';");
});

test("reads the line number as a number", () => {
  assert.strictEqual(parseGrepOutput(record("a.js", "42", "x") + "\n")[0].line, 42);
});

test("returns nothing for empty output", () => {
  assert.deepStrictEqual(parseGrepOutput(""), []);
});

test("skips a malformed record rather than throwing", () => {
  const stdout = ["no separators here", record("a.js", "1", "ok"), ""].join("\n");

  assert.deepStrictEqual(
    parseGrepOutput(stdout).map((hit) => hit.path),
    ["a.js"]
  );
});

// --- display rows --------------------------------------------------------

test("renders each hit as a row carrying its location", () => {
  const rows = buildResultRows([{ path: "lib/a.js", line: 12, text: "const x = 1;" }]);

  assert.strictEqual(rows[0].kind, "hit");
  assert.strictEqual(rows[0].hit.path, "lib/a.js");
});

test("shows a note when nothing matched", () => {
  const rows = buildResultRows([]);

  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].kind, "note");
  assert.match(rows[0].text, /No matches/i);
});

// --- searching a real repository -----------------------------------------

function makeRepo(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "herdr-deep-code-reading-search-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  execFileSync("git", ["init", "-q"], { cwd: root, stdio: "ignore" });
  fs.mkdirSync(path.join(root, "lib"), { recursive: true });
  fs.writeFileSync(path.join(root, "lib", "a.js"), "const needle = 1;\nconst other = 2;\n");
  fs.writeFileSync(path.join(root, "tracked.js"), "// needle again\n");
  execFileSync("git", ["add", "-A"], { cwd: root, stdio: "ignore" });
  execFileSync(
    "git",
    ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init"],
    { cwd: root, stdio: "ignore" }
  );
  // Untracked files must be searched too, since the browser lists them
  fs.writeFileSync(path.join(root, "fresh.js"), "const needle = 3;\n");

  return root;
}

test("finds matches across the repository", (t) => {
  const root = makeRepo(t);

  const result = runSearch(root, "needle");

  assert.strictEqual(result.ok, true);
  assert.ok(result.hits.length >= 2);
});

test("searches untracked files as well", (t) => {
  const root = makeRepo(t);

  const paths = runSearch(root, "needle").hits.map((hit) => hit.path);

  assert.ok(paths.includes("fresh.js"), `got ${paths.join(", ")}`);
});

test("reports no matches without calling it an error", (t) => {
  const root = makeRepo(t);

  const result = runSearch(root, "definitely-not-present");

  assert.strictEqual(result.ok, true);
  assert.deepStrictEqual(result.hits, []);
});

test("treats the query as literal text, not a pattern", (t) => {
  // A reader searching for "a.js" should not have it read as a regex
  const root = makeRepo(t);

  const result = runSearch(root, "needle = 1;");

  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.hits.length, 1);
});

test("refuses an empty query", (t) => {
  const root = makeRepo(t);

  const result = runSearch(root, "   ");

  assert.strictEqual(result.ok, false);
  assert.ok(result.error);
});

test("caps how many hits it returns", (t) => {
  const root = makeRepo(t);

  assert.ok(runSearch(root, "const").hits.length <= MAX_HITS);
});

// --- regular expressions, when they are asked for -------------------------

test("reads the query as a pattern when regex is asked for", (t) => {
  const root = makeRepo(t);

  const result = runSearch(root, "needle = [13];", { regex: true });

  assert.strictEqual(result.ok, true);
  // lib/a.js and fresh.js, and not the comment in tracked.js
  assert.deepStrictEqual(
    result.hits.map((hit) => hit.path).sort(),
    ["fresh.js", "lib/a.js"]
  );
});

test("the same query finds nothing while the search is literal", (t) => {
  // The two modes have to differ, or the flag is doing nothing
  const root = makeRepo(t);

  assert.deepStrictEqual(runSearch(root, "needle = [13];").hits, []);
});

test("reports a malformed pattern rather than throwing", (t) => {
  const root = makeRepo(t);

  const result = runSearch(root, "needle[", { regex: true });

  assert.strictEqual(result.ok, false);
  assert.ok(result.error, "an unparseable pattern must say so");
});

test("anchors still work, which is most of why a pattern is wanted", (t) => {
  const root = makeRepo(t);

  const result = runSearch(root, "^const needle", { regex: true });

  assert.strictEqual(result.ok, true);
  assert.ok(result.hits.length >= 1);
  assert.ok(result.hits.every((hit) => hit.text.startsWith("const needle")));
});
