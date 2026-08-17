"use strict";

// Regression: `git diff` quotes a non-ASCII path into an escaped C string when
// core.quotePath is left at its default. `git status -z` and `git ls-files -z` never
// quote, so the diff would key its files by a name nothing else in the repository
// answers to — the panel showed `"b/\346\227\245..."`, the two-letter status went
// missing, and a comment anchored to a path that did not exist.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const git = require("../lib/git");
const { runSearch } = require("../lib/search");
const { createState, toScreenModel } = require("../lib/app-state");

const JAPANESE_NAME = "日本語ファイル.js";
const GIT_IDENTITY = ["-c", "user.email=test@example.com", "-c", "user.name=herdr-deep-code-reading test"];

function run(cwd, args) {
  execFileSync("git", args, { cwd, stdio: "ignore" });
}

/** A repository whose only changed file has a Japanese name. */
function makeRepo(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "herdr-deep-code-reading-utf8-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  run(root, ["init", "-q"]);
  fs.writeFileSync(path.join(root, JAPANESE_NAME), "const a = 1;\n");
  run(root, ["add", "-A"]);
  run(root, [...GIT_IDENTITY, "commit", "-qm", "init"]);

  fs.writeFileSync(path.join(root, JAPANESE_NAME), "const a = 99;\n");

  return root;
}

test("reads a Japanese file name out of the diff header unescaped", (t) => {
  const root = makeRepo(t);

  const { files } = git.loadDiff(root, "review");

  assert.strictEqual(files.length, 1);
  assert.strictEqual(files[0].newPath, JAPANESE_NAME);
  assert.strictEqual(files[0].oldPath, JAPANESE_NAME);
});

test("attaches the git status to a file with a Japanese name", (t) => {
  // The status comes from `git status -z`, which never quoted the path: an escaped
  // diff path simply failed to find its entry and the panel lost the two letters.
  const root = makeRepo(t);

  const { files } = git.loadDiff(root, "review");

  assert.strictEqual(files[0].gitStatus, " M");
});

test("shows the Japanese file name in the panel", (t) => {
  const root = makeRepo(t);

  const model = toScreenModel(createState(root, "review", 179));

  assert.strictEqual(model.files[0].label, JAPANESE_NAME);
  assert.strictEqual(model.files[0].path, JAPANESE_NAME);
});

test("diffs a single file by its Japanese name", (t) => {
  const root = makeRepo(t);

  const file = git.loadFileDiff(root, "review", JAPANESE_NAME);

  assert.notStrictEqual(file, null);
  assert.strictEqual(file.newPath, JAPANESE_NAME);
});

test("lists a Japanese file name among the repository paths", (t) => {
  const root = makeRepo(t);

  assert.ok(git.listRepoPaths(root).includes(JAPANESE_NAME));
});

test("reports a search hit in a file with a Japanese name", (t) => {
  const root = makeRepo(t);

  const result = runSearch(root, "const a");

  assert.strictEqual(result.ok, true);
  assert.deepStrictEqual(
    result.hits.map((hit) => hit.path),
    [JAPANESE_NAME]
  );
});
