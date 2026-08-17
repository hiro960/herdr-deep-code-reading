"use strict";

const test = require("node:test");
const assert = require("node:assert");

const { ESC, RESET, moveTo, paint, screen } = require("../lib/ansi");

const ESCAPE_CODE = 27;

test("ESC is the escape control character", () => {
  // Regression: an empty ESC silently turns every sequence into visible text,
  // and makes the ANSI-stripping test helpers pass on unstripped output.
  assert.strictEqual(ESC.length, 1);
  assert.strictEqual(ESC.charCodeAt(0), ESCAPE_CODE);
});

test("every screen control sequence starts with ESC", () => {
  for (const [name, sequence] of Object.entries(screen)) {
    assert.strictEqual(
      sequence.charCodeAt(0),
      ESCAPE_CODE,
      `screen.${name} does not start with ESC`
    );
  }
});

test("cursor movement emits a CSI sequence", () => {
  assert.strictEqual(moveTo(3, 7), ESC + "[3;7H");
});

test("paint wraps text in a color sequence and a reset", () => {
  const painted = paint("x", { fg: 1 });

  assert.ok(painted.startsWith(ESC + "["));
  assert.ok(painted.endsWith(RESET));
  assert.ok(painted.includes("x"));
});

test("paint returns the text untouched when no style is given", () => {
  assert.strictEqual(paint("x", {}), "x");
});

test("paint applies background and foreground together", () => {
  const painted = paint("x", { bg: 2, fg: 3 });

  assert.ok(painted.includes("48;5;2m"));
  assert.ok(painted.includes("38;5;3m"));
});
