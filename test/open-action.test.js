"use strict";

// The action entry point decides whether a pane is worth opening at all. Getting
// that wrong is only visible from outside the process, so this one runs the script.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync, spawnSync } = require("node:child_process");

const OPEN_SCRIPT = path.join(__dirname, "..", "bin", "open.js");
// `true` accepts any arguments and says nothing, so a pane is never really opened
const STUB_HERDR = "/usr/bin/true";

/** Run the action with a stubbed herdr, and report what it wrote and returned. */
function runOpen(mode, cwd, herdrBin) {
  const result = spawnSync(process.execPath, [OPEN_SCRIPT, mode], {
    encoding: "utf8",
    env: {
      ...process.env,
      HERDR_BIN_PATH: herdrBin || STUB_HERDR,
      HERDR_PLUGIN_CONTEXT_JSON: JSON.stringify({ focused_pane_cwd: cwd }),
    },
  });

  return {
    status: result.status,
    stdout: result.stdout || "",
    stderr: (result.stderr || "").trim(),
  };
}

/** A stand-in herdr that writes down what it was asked for. */
function recordingHerdr(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "herdr-deep-code-reading-record-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const bin = path.join(root, "herdr");
  const record = path.join(root, "asked");
  fs.writeFileSync(bin, ["#!/bin/sh", `printf '%s\n' "$@" > ${record}`, "exit 0"].join("\n") + "\n");
  fs.chmodSync(bin, 0o755);

  return { bin, record };
}

/** A stand-in herdr that answers `pane open` the way the real one does. */
function talkativeHerdr(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "herdr-deep-code-reading-stub-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const bin = path.join(root, "herdr");
  fs.writeFileSync(bin, ['#!/bin/sh', 'echo "{}"', "exit 0"].join("\n") + "\n");
  fs.chmodSync(bin, 0o755);

  return bin;
}

test("says nothing on stdout when the pane opens", (t) => {
  // Regression: the answer to `pane open` was echoed, so invoking the action from
  // a shell printed a stray `{}` under it. Opening the pane is the whole result,
  // and it is already on screen.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "herdr-deep-code-reading-quiet-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  execFileSync("git", ["init", "-q"], { cwd: root, stdio: "ignore" });

  const result = runOpen("review", root, talkativeHerdr(t));

  assert.strictEqual(result.status, 0);
  assert.strictEqual(result.stdout, "", "the action wrote to stdout");
});

test("a failure still has something to say, on stderr", (t) => {
  const missing = path.join(os.tmpdir(), "herdr-deep-code-reading-quiet-nowhere");

  const result = runOpen("review", missing, talkativeHerdr(t));

  assert.strictEqual(result.stdout, "");
  assert.match(result.stderr, /no such directory/);
});

test("opens the file browser outside a repository", (t) => {
  // Most of what this pane does is reading, and a directory git has never heard of is
  // still full of files. What it cannot show it withholds — see lib/state/reducers.
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "herdr-deep-code-reading-norepo-"));
  t.after(() => fs.rmSync(outside, { recursive: true, force: true }));

  const result = runOpen("files", outside, talkativeHerdr(t));

  assert.strictEqual(result.status, 0);
  assert.strictEqual(result.stderr, "");
});

test("opens a diff asked for outside a repository, on what there is", (t) => {
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "herdr-deep-code-reading-norepo-"));
  t.after(() => fs.rmSync(outside, { recursive: true, force: true }));

  assert.strictEqual(runOpen("review", outside, talkativeHerdr(t)).status, 0);
});

test("passes the directory itself as the root when there is no repository", (t) => {
  // There is no repository root to resolve, so the place the reader was standing is
  // the place the pane opens on
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "herdr-deep-code-reading-norepo-"));
  t.after(() => fs.rmSync(outside, { recursive: true, force: true }));
  const asked = recordingHerdr(t);

  runOpen("files", outside, asked.bin);

  assert.ok(
    fs.readFileSync(asked.record, "utf8").includes(`HERDR_DEEP_CODE_READING_REPO=${outside}`)
  );
});

test("reports a working directory that does not exist", () => {
  // git cannot even start there, which used to reach the user as a stack trace
  const result = runOpen("review", path.join(os.tmpdir(), "herdr-deep-code-reading-missing-directory"));

  assert.strictEqual(result.status, 1);
  assert.match(result.stderr, /^herdr-deep-code-reading: /);
  assert.doesNotMatch(result.stderr, /at .*\.js:\d+/, "a stack trace reached the user");
});

test("reports an unknown mode", () => {
  assert.match(runOpen("nonsense", os.tmpdir()).stderr, /unknown mode/);
});
