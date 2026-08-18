#!/usr/bin/env node
"use strict";

// Action entry point. Resolves the repository from the calling pane's working
// directory and opens the pane the requested mode belongs to.
//
// Note: Herdr sets this script's working directory to the plugin root, so the
// user's repository must be read from HERDR_PLUGIN_CONTEXT_JSON.

const fs = require("node:fs");
const { spawnSync } = require("node:child_process");

const { DEFAULT_MODE, entrypointFor } = require("../lib/entrypoints");
const git = require("../lib/git");

const PANE_PLACEMENT = "zoomed";
const EXIT_FAILURE = 1;
const NOTIFICATION_TITLE = "herdr-deep-code-reading";

function herdrBin() {
  return process.env.HERDR_BIN_PATH || "herdr";
}

/** Report a failure on stderr and as a Herdr notification, then exit. */
function fail(message) {
  process.stderr.write(`${NOTIFICATION_TITLE}: ${message}\n`);
  spawnSync(herdrBin(), ["notification", "show", NOTIFICATION_TITLE, "--body", message], {
    stdio: "ignore",
  });
  process.exit(EXIT_FAILURE);
}

/** Whether a path is a directory that can be read. */
function isDirectory(target) {
  try {
    return fs.statSync(target).isDirectory();
  } catch {
    return false;
  }
}

/** Read the calling pane's working directory out of the context JSON. */
function callerCwd() {
  const raw = process.env.HERDR_PLUGIN_CONTEXT_JSON;
  if (!raw) {
    return null;
  }

  try {
    const context = JSON.parse(raw);
    return context.focused_pane_cwd || context.workspace_cwd || null;
  } catch (error) {
    process.stderr.write(`${NOTIFICATION_TITLE}: could not parse context: ${error.message}\n`);
    return null;
  }
}

function openPane(entrypoint, repoDir, mode) {
  const result = spawnSync(
    herdrBin(),
    [
      "plugin",
      "pane",
      "open",
      "--plugin",
      process.env.HERDR_PLUGIN_ID || "herdr-deep-code-reading",
      "--entrypoint",
      entrypoint,
      "--placement",
      PANE_PLACEMENT,
      "--env",
      `HERDR_DEEP_CODE_READING_REPO=${repoDir}`,
      "--env",
      `HERDR_DEEP_CODE_READING_MODE=${mode}`,
      "--focus",
    ],
    { encoding: "utf8" }
  );

  if (result.error) {
    fail(`could not start herdr: ${result.error.message}`);
    return;
  }
  if (result.status !== 0) {
    fail(`could not open the pane: ${(result.stderr || "").trim()}`);
    return;
  }

  // Nothing is written on the way out. Opening the pane is the whole result, and it
  // is already on screen; echoing what `pane open` answered with put a stray `{}`
  // under the invocation of anyone who ran the action from a shell. A failure still
  // has something to say, and says it on stderr.
}

function main() {
  const mode = process.argv[2] || DEFAULT_MODE;
  const entrypoint = entrypointFor(mode);
  if (entrypoint === null) {
    fail(`unknown mode: ${mode}`);
    return;
  }

  const cwd = callerCwd();
  if (cwd === null) {
    fail("could not determine the calling pane's working directory");
    return;
  }

  // A directory git has never heard of is still full of files, and reading them is most
  // of what this pane does — so the place the reader was standing is the place it opens
  // on, and what needs a history is withheld inside. A directory that is not there at
  // all is the one thing still refused: nothing can be read from it, and the refusal
  // has to happen here rather than in a pane whose message is already off screen.
  if (!isDirectory(cwd)) {
    fail(`no such directory: ${cwd}`);
    return;
  }

  openPane(entrypoint, git.resolveRepoRoot(cwd) || cwd, mode);
}

// git is a child process, so it can fail to start at all. Reporting that through the
// same notification the other failures use beats a stack trace in a pane nobody reads.
try {
  main();
} catch (error) {
  fail(error.message);
}
