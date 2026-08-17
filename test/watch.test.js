"use strict";

// Noticing that the repository has moved under the reader.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const { WATCH_INTERVAL_MS, canReload, fingerprint } = require("../lib/watch");

const GIT_IDENTITY = ["-c", "user.email=test@example.com", "-c", "user.name=herdr-deep-code-reading test"];

function run(cwd, args) {
  execFileSync("git", args, { cwd, stdio: "ignore" });
}

function makeRepo(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "herdr-deep-code-reading-watch-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  run(root, ["init", "-q"]);
  fs.writeFileSync(path.join(root, "a.js"), "one\n");
  run(root, ["add", "-A"]);
  run(root, [...GIT_IDENTITY, "commit", "-qm", "init"]);

  return root;
}

function write(root, name, text) {
  fs.writeFileSync(path.join(root, name), text);
}

// --- the interval ------------------------------------------------------------

test("the poll is often enough to be useful and rare enough to be cheap", () => {
  assert.ok(WATCH_INTERVAL_MS >= 500 && WATCH_INTERVAL_MS <= 5000);
});

// --- what counts as a change --------------------------------------------------

test("an untouched repository fingerprints the same twice", (t) => {
  const root = makeRepo(t);

  assert.strictEqual(fingerprint(root), fingerprint(root));
});

test("a modified file changes it", (t) => {
  const root = makeRepo(t);
  const before = fingerprint(root);

  write(root, "a.js", "changed\n");

  assert.notStrictEqual(fingerprint(root), before);
});

test("a second edit to an already-modified file changes it too", (t) => {
  // The reason `git status` alone will not do: its letters say "modified" both
  // times, and an agent's second edit would go unnoticed
  const root = makeRepo(t);
  write(root, "a.js", "first edit\n");
  const before = fingerprint(root);

  write(root, "a.js", "second edit, a different length\n");

  assert.notStrictEqual(fingerprint(root), before);
});

test("a new untracked file changes it", (t) => {
  const root = makeRepo(t);
  const before = fingerprint(root);

  write(root, "new.js", "fresh\n");

  assert.notStrictEqual(fingerprint(root), before);
});

test("a deleted file changes it", (t) => {
  const root = makeRepo(t);
  const before = fingerprint(root);

  fs.rmSync(path.join(root, "a.js"));

  assert.notStrictEqual(fingerprint(root), before);
});

test("staging changes it", (t) => {
  const root = makeRepo(t);
  write(root, "a.js", "changed\n");
  const before = fingerprint(root);

  run(root, ["add", "-A"]);

  assert.notStrictEqual(fingerprint(root), before);
});

test("a commit made in another pane changes it", (t) => {
  const root = makeRepo(t);
  write(root, "a.js", "changed\n");
  run(root, ["add", "-A"]);
  const before = fingerprint(root);

  run(root, [...GIT_IDENTITY, "commit", "-qm", "second"]);

  assert.notStrictEqual(fingerprint(root), before);
});

test("a repository with no commits yet still fingerprints", (t) => {
  // rev-parse HEAD fails there, and a first commit made elsewhere has to be noticed
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "herdr-deep-code-reading-watch-empty-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  run(root, ["init", "-q"]);

  const before = fingerprint(root);
  assert.ok(typeof before === "string");

  write(root, "a.js", "one\n");
  run(root, ["add", "-A"]);
  run(root, [...GIT_IDENTITY, "commit", "-qm", "init"]);

  assert.notStrictEqual(fingerprint(root), before);
});

test("somewhere that is not a repository answers with nothing, not a change", (t) => {
  const plain = fs.mkdtempSync(path.join(os.tmpdir(), "herdr-deep-code-reading-watch-plain-"));
  t.after(() => fs.rmSync(plain, { recursive: true, force: true }));

  assert.strictEqual(fingerprint(plain), null);
});

// --- when a reload is allowed to happen ----------------------------------------

test("a reload waits for a text field to close", () => {
  // Rebuilding the rows under a half-written comment would take the lines it is
  // anchored to out from under it
  assert.strictEqual(canReload({ input: { kind: "comment" }, picker: null }), false);
});

test("a reload waits for a picker to be answered", () => {
  assert.strictEqual(canReload({ input: null, picker: { agents: [] } }), false);
});

test("otherwise it goes ahead", () => {
  assert.strictEqual(canReload({ input: null, picker: null }), true);
});
