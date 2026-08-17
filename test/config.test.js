"use strict";

// The config file, and the flat corner of TOML it is written in.
//
// Herdr gives every plugin a directory of its own to be configured from. This reads
// one file out of it and answers with environment variables, because that is how the
// rest of the plugin already takes its settings — and because the palette is settled
// the moment lib/ansi is first required, which is before anything could be handed in.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { CONFIG_FILENAME, parseConfig, settingsFromConfig } = require("../lib/config");

/** A plugin config directory holding the given file contents. */
function configDir(contents) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "herdr-deep-code-reading-config-"));
  if (contents !== null) {
    fs.writeFileSync(path.join(directory, CONFIG_FILENAME), contents);
  }
  return directory;
}

// --- what the parser reads ----------------------------------------------------

test("a quoted value is read without its quotes", () => {
  assert.deepStrictEqual(parseConfig('theme = "catppuccin-latte"'), {
    theme: "catppuccin-latte",
  });
  assert.deepStrictEqual(parseConfig("theme = 'classic-light'"), { theme: "classic-light" });
});

test("every setting the plugin has can be written", () => {
  const parsed = parseConfig(
    [
      'theme = "classic-light"',
      'layout = "stacked"',
      'editor = "nvim -f"',
      "cursorline = false",
    ].join("\n")
  );

  assert.deepStrictEqual(parsed, {
    theme: "classic-light",
    layout: "stacked",
    editor: "nvim -f",
    cursorline: "false",
  });
});

test("blank lines and comments are not settings", () => {
  const parsed = parseConfig(
    ["# the palette", "", '   theme = "classic"   ', "   # trailing thought"].join("\n")
  );

  assert.deepStrictEqual(parsed, { theme: "classic" });
});

test("a comment after an unquoted value is not part of it", () => {
  assert.deepStrictEqual(parseConfig("cursorline = false  # too loud"), {
    cursorline: "false",
  });
});

test("a hash inside a quoted value is part of it", () => {
  // An editor invocation is the value most likely to carry one
  assert.deepStrictEqual(parseConfig('editor = "sh -c \'e #1\'"'), {
    editor: "sh -c 'e #1'",
  });
});

test("a key nothing reads is ignored rather than refused", () => {
  // A file written for a later version should not stop this one from starting
  assert.deepStrictEqual(parseConfig('theme = "classic"\nsplendour = "maximum"'), {
    theme: "classic",
  });
});

test("nothing below a table header is read", () => {
  // The subset is flat. Reading a key out of a table as though it were top-level
  // would apply a setting the writer scoped somewhere else.
  const parsed = parseConfig(['theme = "classic"', "[keys]", 'theme = "catppuccin-mocha"'].join("\n"));

  assert.deepStrictEqual(parsed, { theme: "classic" });
});

test("a line that is not a setting is passed over", () => {
  assert.deepStrictEqual(parseConfig("theme\n= classic\n]]]\n"), {});
});

test("an empty value is no value", () => {
  assert.deepStrictEqual(parseConfig('theme = ""\nlayout =   '), { theme: "" });
});

// --- what reaches the environment ---------------------------------------------

test("a setting becomes the environment variable that reads it", () => {
  const directory = configDir('theme = "catppuccin-latte"\nlayout = "split"');

  assert.deepStrictEqual(settingsFromConfig({ HERDR_PLUGIN_CONFIG_DIR: directory }), {
    HERDR_DEEP_CODE_READING_THEME: "catppuccin-latte",
    HERDR_DEEP_CODE_READING_LAYOUT: "split",
  });
});

test("the environment wins over the file", () => {
  // HERDR_DEEP_CODE_READING_THEME=... on one invocation is how a reader tries a palette out, and a
  // file that overrode it would make the variable do nothing
  const directory = configDir('theme = "classic"\neditor = "nano"');

  assert.deepStrictEqual(
    settingsFromConfig({
      HERDR_PLUGIN_CONFIG_DIR: directory,
      HERDR_DEEP_CODE_READING_THEME: "catppuccin-mocha",
    }),
    { HERDR_DEEP_CODE_READING_EDITOR: "nano" }
  );
});

test("an empty environment variable is still the environment's answer", () => {
  const directory = configDir('theme = "classic"');

  assert.deepStrictEqual(
    settingsFromConfig({ HERDR_PLUGIN_CONFIG_DIR: directory, HERDR_DEEP_CODE_READING_THEME: "" }),
    {}
  );
});

test("outside Herdr there is no directory, so there is nothing to read", () => {
  assert.deepStrictEqual(settingsFromConfig({}), {});
  assert.deepStrictEqual(settingsFromConfig({ HERDR_PLUGIN_CONFIG_DIR: "" }), {});
});

test("a directory with no config file in it is not a failure", () => {
  assert.deepStrictEqual(settingsFromConfig({ HERDR_PLUGIN_CONFIG_DIR: configDir(null) }), {});
});

test("a directory that is not there is not a failure either", () => {
  const missing = path.join(os.tmpdir(), "herdr-deep-code-reading-config-nowhere-at-all");

  assert.deepStrictEqual(settingsFromConfig({ HERDR_PLUGIN_CONFIG_DIR: missing }), {});
});

test("an unreadable config file is not a failure", () => {
  // A directory where the file should be is the shape of this that can be built
  // without depending on which user the suite runs as
  const directory = configDir(null);
  fs.mkdirSync(path.join(directory, CONFIG_FILENAME));

  assert.deepStrictEqual(settingsFromConfig({ HERDR_PLUGIN_CONFIG_DIR: directory }), {});
});

test("a value nobody recognises is passed on rather than judged", () => {
  // Every reader of these falls back on its own — an unknown palette to the default
  // one, an unknown layout to whatever the width says. Judging here as well would put
  // the same rule in two places and let them disagree.
  const directory = configDir('theme = "dracula"\nlayout = "diagonal"');

  assert.deepStrictEqual(settingsFromConfig({ HERDR_PLUGIN_CONFIG_DIR: directory }), {
    HERDR_DEEP_CODE_READING_THEME: "dracula",
    HERDR_DEEP_CODE_READING_LAYOUT: "diagonal",
  });
});

test("reading the config changes nothing about the environment it was given", () => {
  const directory = configDir('theme = "classic"');
  const env = { HERDR_PLUGIN_CONFIG_DIR: directory };

  settingsFromConfig(env);

  assert.deepStrictEqual(env, { HERDR_PLUGIN_CONFIG_DIR: directory });
});
