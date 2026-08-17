"use strict";

// The plugin is described in two files: Herdr reads herdr-plugin.toml, npm reads
// package.json, and both carry a version. Nothing makes them agree, so a release that
// moves one and forgets the other ships a plugin whose two halves disagree about what
// it is. These say so at test time instead.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const { KNOWN_MODES, REVIEW_PANE } = require("../lib/entrypoints");

const ROOT = path.join(__dirname, "..");

const manifest = fs.readFileSync(path.join(ROOT, "herdr-plugin.toml"), "utf8");
const packaged = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));

/** A top-level `key = "value"` from the manifest. */
function manifestValue(key) {
  const match = new RegExp(`^${key}\\s*=\\s*"([^"]*)"`, "m").exec(manifest);
  return match === null ? null : match[1];
}

/** Every `id = "..."` under a given table heading. */
function manifestIds(table) {
  const section = new RegExp(`\\[\\[${table}\\]\\]\\s*\\nid = "([^"]*)"`, "g");
  const ids = [];
  let match = section.exec(manifest);

  while (match !== null) {
    ids.push(match[1]);
    match = section.exec(manifest);
  }

  return ids;
}

test("the manifest and the package agree on the version", () => {
  // Act
  const declared = manifestValue("version");

  // Assert
  assert.strictEqual(declared, packaged.version);
});

test("every action the manifest declares is a mode the code knows", () => {
  // Arrange
  const actions = manifestIds("actions");
  assert.ok(actions.length > 0, "the manifest declares no actions");

  // Assert
  for (const action of actions) {
    assert.ok(KNOWN_MODES.has(action), `the manifest offers "${action}", which no mode answers to`);
  }
});

test("every mode the code knows is an action the manifest offers", () => {
  // A mode nothing can invoke is a mode nobody reaches
  const actions = new Set(manifestIds("actions"));

  for (const mode of KNOWN_MODES) {
    assert.ok(actions.has(mode), `nothing in the manifest opens the "${mode}" mode`);
  }
});

test("the pane the actions open is the one the manifest declares", () => {
  // Arrange
  const panes = manifestIds("panes");

  // Assert
  assert.deepStrictEqual(panes, [REVIEW_PANE]);
});
