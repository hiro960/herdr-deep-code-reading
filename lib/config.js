"use strict";

// The config file, read out of the directory Herdr gives every plugin.
//
// Settings arrive as environment variables. That is not a translation layer for its
// own sake: lib/ansi settles the palette the moment it is first required, and
// lib/render/diff-rows takes its token colours from it at the same moment, so a
// setting handed in after startup would arrive too late to be a colour. Reading the
// file before anything else is required, and answering with variables, is what makes
// one mechanism serve both the file and `HERDR_DEEP_CODE_READING_THEME=... herdr ...`.
//
// The environment wins. A variable set for one invocation is how a reader tries a
// palette out, and a file that overrode it would make the variable do nothing.
//
// This module requires nothing of the plugin's own, deliberately: it runs before
// lib/ansi, and requiring anything that reaches lib/ansi would settle the palette
// from the environment this is about to change.

const fs = require("node:fs");
const path = require("node:path");

const CONFIG_FILENAME = "config.toml";

// Every setting there is, and the variable each one speaks through. A key absent from
// here is ignored rather than refused: a file written for a later version should not
// stop this one from starting.
const SETTINGS = {
  theme: "HERDR_DEEP_CODE_READING_THEME",
  layout: "HERDR_DEEP_CODE_READING_LAYOUT",
  editor: "HERDR_DEEP_CODE_READING_EDITOR",
  cursorline: "HERDR_DEEP_CODE_READING_CURSORLINE",
  worddiff: "HERDR_DEEP_CODE_READING_WORDDIFF",
};

// `key = value`, and nothing else. The subset is flat scalars, which is what every
// setting above is; a table header ends the reading rather than being descended into.
const SETTING_LINE = /^\s*([A-Za-z][A-Za-z0-9_-]*)\s*=\s*(.*?)\s*$/;
const TABLE_HEADER = /^\s*\[/;
const QUOTES = ['"', "'"];

/**
 * The value a line was given, as a string.
 *
 * A quoted value is taken verbatim between its quotes, so a `#` inside one is part of
 * it — an editor invocation is the value most likely to carry one. An unquoted value
 * ends at the first `#`, which is how a comment is written beside a bare `false`.
 *
 * Escapes are not read. `\n` in a config file here is a backslash and an n, and no
 * setting this reads has any use for one.
 *
 * @returns {string|null} null when there was no value on the line
 */
function valueOf(raw) {
  const quote = QUOTES.find((mark) => raw.startsWith(mark));

  if (quote !== undefined) {
    const closing = raw.lastIndexOf(quote);
    return closing > 0 ? raw.slice(1, closing) : null;
  }

  const bare = raw.split("#")[0].trim();
  return bare === "" ? null : bare;
}

/**
 * Read the settings out of a config file's text.
 *
 * Anything unreadable is passed over rather than reported. A misspelt line should
 * cost the reader that line, not the pane: refusing to open a diff over a config file
 * is a worse answer than opening one with a default in it.
 *
 * @param {string} text The file's contents
 * @returns {object} The settings it named, keyed as SETTINGS keys them
 */
function parseConfig(text) {
  const found = {};

  for (const line of text.split("\n")) {
    if (TABLE_HEADER.test(line)) {
      break;
    }

    const match = SETTING_LINE.exec(line);
    if (match === null || SETTINGS[match[1]] === undefined) {
      continue;
    }

    const value = valueOf(match[2]);
    if (value !== null) {
      found[match[1]] = value;
    }
  }

  return found;
}

/** The config file's text, or null when there is nothing to read. */
function readConfigFile(directory) {
  try {
    return fs.readFileSync(path.join(directory, CONFIG_FILENAME), "utf8");
  } catch {
    // No directory, no file, no permission, a directory where the file should be —
    // all four mean the same thing here, which is that there is no configuration.
    return null;
  }
}

/**
 * The environment variables the config file asks for, minus the ones already set.
 *
 * Answers with the pairs rather than setting them, so that the one write to
 * process.env happens in bin/review.js where it can be seen — and so that this can be
 * tested without an environment.
 *
 * @param {object} env The environment to defer to
 * @returns {object} Pairs to add; empty when there is no file or it says nothing new
 */
function settingsFromConfig(env) {
  const directory = env.HERDR_PLUGIN_CONFIG_DIR;
  if (!directory) {
    return {};
  }

  const text = readConfigFile(directory);
  if (text === null) {
    return {};
  }

  const settings = parseConfig(text);
  const pairs = {};

  for (const [key, value] of Object.entries(settings)) {
    const variable = SETTINGS[key];
    if (env[variable] === undefined) {
      pairs[variable] = value;
    }
  }

  return pairs;
}

module.exports = {
  CONFIG_FILENAME,
  parseConfig,
  settingsFromConfig,
};
