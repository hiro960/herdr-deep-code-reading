"use strict";

// Searching a directory git has never heard of.
//
// `git grep` answers for a repository. A plain directory has nobody to ask, so the
// files are walked and read here — the same shape of answer, so that following a name,
// listing its uses, the imports list, the quick find and the browser's own search all
// go on working without knowing which of the two answered them.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { searchFiles } = require("../lib/grep");
const { MAX_HITS } = require("../lib/search");

function makeTree(t, files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "herdr-deep-code-reading-grep-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  for (const [name, body] of Object.entries(files)) {
    const full = path.join(root, name);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, body);
  }
  return root;
}

test("finds the line, and says where it is", (t) => {
  const root = makeTree(t, { "a.js": "one\nfunction greet() {\nthree\n", "lib/b.js": "greet();\n" });

  const found = searchFiles(root, "greet");

  assert.strictEqual(found.ok, true);
  assert.deepStrictEqual(
    found.hits.map((hit) => [hit.path, hit.line, hit.text]),
    [
      ["a.js", 2, "function greet() {"],
      ["lib/b.js", 1, "greet();"],
    ]
  );
});

test("nothing found is an answer rather than a failure", (t) => {
  const found = searchFiles(makeTree(t, { "a.js": "one\n" }), "nowhere");

  assert.strictEqual(found.ok, true);
  assert.deepStrictEqual(found.hits, []);
  assert.strictEqual(found.total, 0);
});

test("case is honoured, because a reader searches for what they typed", (t) => {
  const root = makeTree(t, { "a.js": "Greet\ngreet\n" });

  assert.deepStrictEqual(searchFiles(root, "greet").hits.map((h) => h.line), [2]);
});

test("a name being looked up is asked for without case", (t) => {
  const root = makeTree(t, { "a.js": "Greet\ngreet\n" });

  assert.deepStrictEqual(
    searchFiles(root, "greet", { ignoreCase: true }).hits.map((h) => h.line),
    [1, 2]
  );
});

test("a query is literal text unless a pattern was asked for", (t) => {
  const root = makeTree(t, { "a.js": "a.js\naXjs\n" });

  assert.deepStrictEqual(searchFiles(root, "a.js").hits.map((h) => h.line), [1]);
  assert.deepStrictEqual(
    searchFiles(root, "a.js", { regex: true }).hits.map((h) => h.line),
    [1, 2]
  );
});

test("a pattern nothing can parse is a failure with something to say", (t) => {
  const found = searchFiles(makeTree(t, { "a.js": "x\n" }), "a(", { regex: true });

  assert.strictEqual(found.ok, false);
  assert.ok(found.error.length > 0);
});

test("a file too big to read, or not text at all, is passed over", (t) => {
  const root = makeTree(t, { "small.js": "needle\n" });
  fs.writeFileSync(path.join(root, "binary.bin"), Buffer.from([0x6e, 0x00, 0x65]));
  fs.writeFileSync(path.join(root, "huge.js"), "needle\n" + "x".repeat(3 * 1024 * 1024));

  assert.deepStrictEqual(searchFiles(root, "needle").hits.map((h) => h.path), ["small.js"]);
});

test("what is counted is everything found, and what is handed back is capped", (t) => {
  const lines = Array.from({ length: MAX_HITS + 20 }, () => "needle").join("\n") + "\n";
  const root = makeTree(t, { "a.js": lines });

  const found = searchFiles(root, "needle", undefined, MAX_HITS);

  assert.strictEqual(found.hits.length, MAX_HITS);
  assert.strictEqual(found.total, MAX_HITS + 20);
});

test("nothing to search for is refused the way git's answer is", (t) => {
  const found = searchFiles(makeTree(t, { "a.js": "x\n" }), "   ");

  assert.strictEqual(found.ok, false);
  assert.strictEqual(found.hits.length, 0);
});

test("a directory that is not there is not a search with no matches", () => {
  const found = searchFiles(path.join(os.tmpdir(), "herdr-dcr-no-such-place"), "needle");

  assert.strictEqual(found.ok, false);
  assert.match(found.error, /cannot read/);
});
