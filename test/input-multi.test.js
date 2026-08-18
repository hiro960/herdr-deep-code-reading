"use strict";

const test = require("node:test");
const assert = require("node:assert");

const { decodeKeys } = require("../lib/input");

const ESC = "\u001b";

test("returns a one-character chunk as a single key", () => {
  assert.deepStrictEqual(decodeKeys("j").keys, ["j"]);
});

test("splits several keys that arrived in one chunk", () => {
  // stdin does not deliver one key per chunk when typing fast or pasting
  assert.deepStrictEqual(decodeKeys("nn").keys, ["n", "n"]);
});

test("loses no key in a run of ordinary characters", () => {
  assert.deepStrictEqual(decodeKeys("jjkq").keys, ["j", "j", "k", "q"]);
});

test("reads an escape sequence as one key", () => {
  assert.deepStrictEqual(decodeKeys(ESC + "[A").keys, ["up"]);
});

test("splits consecutive escape sequences", () => {
  assert.deepStrictEqual(decodeKeys(ESC + "[A" + ESC + "[B").keys, ["up", "down"]);
});

test("splits a mix of escape sequences and ordinary characters", () => {
  assert.deepStrictEqual(decodeKeys("j" + ESC + "[B" + "k").keys, ["j", "down", "k"]);
});

test("reads a lone ESC as escape", () => {
  assert.deepStrictEqual(decodeKeys(ESC).keys, ["escape"]);
});

test("loses no key when an ordinary character follows ESC", () => {
  assert.deepStrictEqual(decodeKeys(ESC + "z").keys, ["escape", "z"]);
});

test("reads a four-character escape sequence as one key", () => {
  assert.deepStrictEqual(decodeKeys(ESC + "[6~").keys, ["pagedown"]);
});

test("splits a mix of control and ordinary characters", () => {
  assert.deepStrictEqual(decodeKeys("a\tb").keys, ["a", "tab", "b"]);
});

test("does not split a surrogate pair", () => {
  assert.deepStrictEqual(decodeKeys("\u{1F363}").keys, ["\u{1F363}"]);
});

test("accepts a Buffer holding several keys", () => {
  assert.deepStrictEqual(decodeKeys(Buffer.from("nn", "utf8")).keys, ["n", "n"]);
});

test("returns an empty array for empty input", () => {
  assert.deepStrictEqual(decodeKeys("").keys, []);
});
