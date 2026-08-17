"use strict";

// How much of the file around a change git is asked for, and whether it is asked to
// treat whitespace as nothing.
//
// Both are questions the reader asks constantly and could not ask at all: "what is
// around this" and "show me the change, not the reindent". Both are answered by
// running git again with one more flag, which is why they live next to each other.

const test = require("node:test");
const assert = require("node:assert");

const {
  CONTEXT_STEPS,
  DEFAULT_CONTEXT,
  WHOLE_FILE,
  contextLabel,
  diffFlags,
  narrowerContext,
  widerContext,
} = require("../lib/diff-options");

// --- the ladder ----------------------------------------------------------------

test("a pane opens at the amount git would have given it anyway", () => {
  // Three lines is git's own default, so a reader who never presses either key sees
  // exactly what `git diff` shows
  assert.strictEqual(DEFAULT_CONTEXT, 3);
  assert.ok(CONTEXT_STEPS.includes(DEFAULT_CONTEXT));
});

test("the ladder climbs and never repeats a rung", () => {
  for (let at = 1; at < CONTEXT_STEPS.length; at += 1) {
    assert.ok(CONTEXT_STEPS[at] > CONTEXT_STEPS[at - 1], "the ladder goes down somewhere");
  }
});

test("widening doubles rather than counting, so the whole file is a few presses away", () => {
  assert.strictEqual(widerContext(0), 3);
  assert.strictEqual(widerContext(3), 6);
  assert.strictEqual(widerContext(6), 12);
});

test("the top of the ladder is the whole file, and it stays there", () => {
  assert.strictEqual(widerContext(WHOLE_FILE), WHOLE_FILE);
  assert.strictEqual(CONTEXT_STEPS[CONTEXT_STEPS.length - 1], WHOLE_FILE);
});

test("narrowing reaches nothing but the change, and stays there", () => {
  assert.strictEqual(narrowerContext(3), 0);
  assert.strictEqual(narrowerContext(0), 0);
});

test("a value off the ladder is brought back onto it", () => {
  // Nothing sets one today, but a config file or a later feature could
  assert.strictEqual(widerContext(7), 12);
  assert.strictEqual(narrowerContext(7), 6);
});

test("the label says what the reader is looking at, not a number they must decode", () => {
  assert.strictEqual(contextLabel(0), "no context");
  assert.strictEqual(contextLabel(3), "3 lines");
  assert.strictEqual(contextLabel(WHOLE_FILE), "whole file");
});

// --- what git is told ------------------------------------------------------------

test("the default asks git for nothing it would not have done", () => {
  // A -U3 on every invocation would be the same diff and one more thing to be wrong
  assert.deepStrictEqual(diffFlags({ context: DEFAULT_CONTEXT, ignoreWhitespace: false }), []);
  assert.deepStrictEqual(diffFlags({}), []);
});

test("a widened diff asks for that many lines", () => {
  assert.deepStrictEqual(diffFlags({ context: 12 }), ["-U12"]);
  assert.deepStrictEqual(diffFlags({ context: 0 }), ["-U0"]);
});

test("the whole file is a number too, because git has no flag for it", () => {
  const [flag] = diffFlags({ context: WHOLE_FILE });

  assert.match(flag, /^-U\d+$/);
  assert.ok(Number(flag.slice(2)) >= WHOLE_FILE);
});

test("ignoring whitespace is git's own -w", () => {
  assert.deepStrictEqual(diffFlags({ ignoreWhitespace: true }), ["-w"]);
});

test("both at once come back in a stable order", () => {
  assert.deepStrictEqual(diffFlags({ context: 25, ignoreWhitespace: true }), ["-U25", "-w"]);
});
