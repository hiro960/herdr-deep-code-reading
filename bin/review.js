#!/usr/bin/env node
"use strict";

// The review screen. Launched from a Herdr plugin pane, which passes the target
// repository and the diff mode through environment variables.
//
// State transitions live in lib/app-state.js and the modules under lib/state. What
// the world is asked to do lives in lib/run. This file is the wiring: it resolves the
// repository, builds the opening state, and hands the terminal to the session.

// Before anything else is required. lib/ansi settles the palette the moment it is
// first loaded, and lib/render/diff-rows takes its token colours from it in the same
// breath, so a config file read after that would be read too late to be a colour.
// lib/config requires nothing of the plugin's own for the same reason.
const { settingsFromConfig } = require("../lib/config");

Object.assign(process.env, settingsFromConfig(process.env));

const { createState } = require("../lib/app-state");
const { DEFAULT_MODE } = require("../lib/entrypoints");
const git = require("../lib/git");
const effects = require("../lib/run/effects");
const inputLoop = require("../lib/run/input-loop");
const session = require("../lib/run/session");
const { enterFullScreen, terminalSize } = require("../lib/run/terminal");

const { EXIT_FAILURE } = session;

function fail(message) {
  process.stderr.write(`herdr-deep-code-reading: ${message}\n`);
  process.exit(EXIT_FAILURE);
}

/** Resolve the repository and build the opening state, or exit with a clear reason. */
function startUp() {
  const requestedDir = process.env.HERDR_DEEP_CODE_READING_REPO || process.cwd();
  const mode = process.env.HERDR_DEEP_CODE_READING_MODE || DEFAULT_MODE;

  const repoDir = git.resolveRepoRoot(requestedDir);
  if (repoDir === null) {
    fail(`not a git repository: ${requestedDir}`);
    return null;
  }

  try {
    return createState(repoDir, mode, terminalSize().columns);
  } catch (error) {
    fail(error.message);
    return null;
  }
}

function main() {
  const state = startUp();
  if (state === null) {
    return;
  }

  // A box so the handlers share one mutable reference to the current state
  const box = { state };
  const runtime = session.createRuntime(box);
  // The watcher needs somewhere to draw from, and the effect that arms it reaches the
  // watcher through the runtime. They are tied together here rather than in either.
  runtime.watcher = session.createWatcher(box, runtime);

  enterFullScreen();
  runtime.draw();
  session.installHandlers(box, runtime);
}

if (require.main === module) {
  main();
}

// Exported for the tests; everything else here is reached through main(). The names
// live in lib/run now, and are re-exported rather than moved in the tests, because
// what they are called from a test is not a reason to change what they are.
module.exports = {
  CRASH_FILENAME: effects.CRASH_FILENAME,
  EXPORT_FILENAME: effects.EXPORT_FILENAME,
  MESSAGE_TIMEOUT_MS: session.MESSAGE_TIMEOUT_MS,
  applyKey: inputLoop.applyKey,
  createWatcher: session.createWatcher,
  editFile: effects.editFile,
  expireMessage: session.expireMessage,
  rescueComments: effects.rescueComments,
  shouldUnstage: effects.shouldUnstage,
};
