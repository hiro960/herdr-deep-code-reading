"use strict";

// The operations that change this repository, and nothing that leaves it.
//
// Everything here goes through git and nothing touches the working tree directly. The
// one file this plugin makes for itself it makes empty, at a name the reader typed —
// see lib/state/views/create.js — and no content is ever written by anything here.
//
// ./git-remote is the other half — the two calls that speak to a remote — and it runs
// through the same `run` below, with a longer clock and an environment that cannot
// stop to ask for a password. Everything that makes those two different from these is
// there rather than here.

const { spawnSync } = require("node:child_process");

const { hasCommits } = require("./git");

const MAX_BUFFER_BYTES = 8 * 1024 * 1024;
// git commit runs hooks and may try to sign. The pane is in raw mode on an alternate
// screen, so a child that reads stdin or waits forever would lock the user out with
// no key able to recover. stdin is closed and every call is bounded.
const TIMEOUT_MS = 30_000;
const CHILD_STDIO = ["ignore", "pipe", "pipe"];
const DIFF_FOUND_EXIT_CODE = 1;

// git's own error text is shown to the user verbatim, so a non-ASCII path in it has
// to read as the name the user typed rather than as an escaped C string.
const NO_QUOTE_PATH = ["-c", "core.quotePath=false"];

/**
 * Run a git that changes something, and answer with what happened rather than throwing.
 *
 * @param {{timeout?: number, env?: object, detached?: boolean}} [options] What a call
 *   that reaches the network needs and a local one does not — see ./git-remote, which
 *   is the only caller that passes any of them.
 * @returns {{ok: boolean, status: number|null, output: string, error: string|null}}
 */
function run(repoDir, args, options) {
  const settings = options === undefined || options === null ? {} : options;
  const timeout = settings.timeout === undefined ? TIMEOUT_MS : settings.timeout;
  const added = settings.env;

  const result = spawnSync("git", [...NO_QUOTE_PATH, ...args], {
    cwd: repoDir,
    encoding: "utf8",
    maxBuffer: MAX_BUFFER_BYTES,
    stdio: CHILD_STDIO,
    timeout,
    // Added to this process's environment rather than replacing it: git finds its
    // subcommands through PATH and its configuration through HOME, and a child handed
    // a bare pair would be a git that cannot read the repository's own settings
    ...(added === undefined || added === null ? {} : { env: { ...process.env, ...added } }),
    ...(settings.detached === true ? { detached: true } : {}),
  });

  if (result.error) {
    const reason =
      result.error.code === "ETIMEDOUT"
        ? `git ${args[0]} timed out after ${timeout / 1000}s`
        : `could not start git: ${result.error.message}`;
    return { ok: false, status: null, output: "", error: reason };
  }

  const status = result.status === null ? 1 : result.status;
  if (status !== 0) {
    const detail = (result.stderr || result.stdout || "").trim();
    return { ok: false, status, output: "", error: detail || `exit code ${status}` };
  }

  return { ok: true, status, output: (result.stdout || "").trim(), error: null };
}

/**
 * Stage one or more paths in a single call.
 * A rename must pass both its new and its old path, or only half of it is staged.
 */
function stagePath(repoDir, paths) {
  const list = Array.isArray(paths) ? paths : [paths];
  return run(repoDir, ["add", "--", ...list]);
}

/** Stage every change in the working tree, including untracked files. */
function stageAll(repoDir) {
  return run(repoDir, ["add", "--all"]);
}

/**
 * Remove one or more paths from the index.
 * `restore --staged` needs HEAD, which does not exist before the first commit,
 * so an empty repository falls back to dropping the entries outright.
 */
function unstagePath(repoDir, paths) {
  const list = Array.isArray(paths) ? paths : [paths];
  if (!hasCommits(repoDir)) {
    return run(repoDir, ["rm", "--cached", "--", ...list]);
  }
  return run(repoDir, ["restore", "--staged", "--", ...list]);
}

/**
 * Commit whatever is staged.
 * Hooks and a missing user.email surface as an error string for the caller to show.
 */
function commit(repoDir, message) {
  return run(repoDir, ["commit", "-m", message]);
}

/**
 * Whether anything is staged and therefore committable.
 * `--quiet` exits 1 when it finds differences, so only that exact status means
 * "staged". Any other failure is reported rather than read as an empty index.
 * @returns {{ok: boolean, staged: boolean, error: string|null}}
 */
function hasStagedChanges(repoDir) {
  const result = run(repoDir, ["diff", "--cached", "--quiet", "--no-ext-diff"]);

  if (result.ok) {
    return { ok: true, staged: false, error: null };
  }
  if (result.status === DIFF_FOUND_EXIT_CODE) {
    return { ok: true, staged: true, error: null };
  }
  return { ok: false, staged: false, error: result.error };
}

module.exports = {
  commit,
  hasStagedChanges,
  run,
  stageAll,
  stagePath,
  unstagePath,
};
