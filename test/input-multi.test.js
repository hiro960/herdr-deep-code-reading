"use strict";

const test = require("node:test");
const assert = require("node:assert");

const { decodeKeys } = require("../lib/input");

const ESC = "\u001b";

test("returns a one-character chunk as a single key", () => {
  assert.deepStrictEqual(decodeKeys("j"), ["j"]);
});

test("splits several keys that arrived in one chunk", () => {
  // stdin does not deliver one key per chunk when typing fast or pasting
  assert.deepStrictEqual(decodeKeys("nn"), ["n", "n"]);
});

test("loses no key in a run of ordinary characters", () => {
  assert.deepStrictEqual(decodeKeys("jjkq"), ["j", "j", "k", "q"]);
});

test("reads an escape sequence as one key", () => {
  assert.deepStrictEqual(decodeKeys(ESC + "[A"), ["up"]);
});

test("splits consecutive escape sequences", () => {
  assert.deepStrictEqual(decodeKeys(ESC + "[A" + ESC + "[B"), ["up", "down"]);
});

test("splits a mix of escape sequences and ordinary characters", () => {
  assert.deepStrictEqual(decodeKeys("j" + ESC + "[B" + "k"), ["j", "down", "k"]);
});

test("reads a lone ESC as escape", () => {
  assert.deepStrictEqual(decodeKeys(ESC), ["escape"]);
});

test("loses no key when an ordinary character follows ESC", () => {
  assert.deepStrictEqual(decodeKeys(ESC + "z"), ["escape", "z"]);
});

test("reads a four-character escape sequence as one key", () => {
  assert.deepStrictEqual(decodeKeys(ESC + "[6~"), ["pagedown"]);
});

test("splits a mix of control and ordinary characters", () => {
  assert.deepStrictEqual(decodeKeys("a\tb"), ["a", "tab", "b"]);
});

test("does not split a surrogate pair", () => {
  assert.deepStrictEqual(decodeKeys("\u{1F363}"), ["\u{1F363}"]);
});

test("accepts a Buffer holding several keys", () => {
  assert.deepStrictEqual(decodeKeys(Buffer.from("nn", "utf8")), ["n", "n"]);
});

test("returns an empty array for empty input", () => {
  assert.deepStrictEqual(decodeKeys(""), []);
});
