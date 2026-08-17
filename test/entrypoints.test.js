"use strict";

const test = require("node:test");
const assert = require("node:assert");

const { entrypointFor, isKnownMode, startsInBrowser } = require("../lib/entrypoints");

test("routes every mode to the one review pane", () => {
  // One pane is what lets comments from the diff and the browser go out together
  for (const mode of ["review", "staged", "branch", "files"]) {
    assert.strictEqual(entrypointFor(mode), "review", `mode ${mode}`);
  }
});

test("returns null for an unknown mode", () => {
  assert.strictEqual(entrypointFor("nonsense"), null);
});

test("accepts the modes the manifest declares", () => {
  for (const mode of ["review", "staged", "branch", "files"]) {
    assert.strictEqual(isKnownMode(mode), true, `mode ${mode}`);
  }
});

test("rejects an unknown mode", () => {
  assert.strictEqual(isKnownMode("nonsense"), false);
  assert.strictEqual(isKnownMode(""), false);
});

test("opens the browser first only for the files mode", () => {
  assert.strictEqual(startsInBrowser("files"), true);
  assert.strictEqual(startsInBrowser("review"), false);
  assert.strictEqual(startsInBrowser("branch"), false);
});
