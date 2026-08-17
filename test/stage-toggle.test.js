"use strict";

const test = require("node:test");
const assert = require("node:assert");

const { shouldUnstage } = require("../bin/review");

test("unstages a file whose changes are entirely staged", () => {
  assert.strictEqual(shouldUnstage("M "), true);
  assert.strictEqual(shouldUnstage("A "), true);
  assert.strictEqual(shouldUnstage("D "), true);
});

test("stages a file with unstaged changes", () => {
  assert.strictEqual(shouldUnstage(" M"), false);
  assert.strictEqual(shouldUnstage(" D"), false);
});

test("stages the remainder of a file that is staged and changed again", () => {
  // "MM" still has work in the tree, so space should add it rather than remove it
  assert.strictEqual(shouldUnstage("MM"), false);
});

test("stages an untracked file", () => {
  assert.strictEqual(shouldUnstage("??"), false);
});

test("stages when the status is unknown", () => {
  assert.strictEqual(shouldUnstage(null), false);
  assert.strictEqual(shouldUnstage(""), false);
  assert.strictEqual(shouldUnstage("M"), false);
});
