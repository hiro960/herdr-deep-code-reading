"use strict";

const test = require("node:test");
const assert = require("node:assert");

const { decodeKey } = require("../lib/input");

const ESC = "\u001b";

test("reads the up-arrow escape sequence as up", () => {
  assert.strictEqual(decodeKey(ESC + "[A"), "up");
});

test("reads the down-arrow escape sequence as down", () => {
  assert.strictEqual(decodeKey(ESC + "[B"), "down");
});

test("reads application-cursor-mode arrows too", () => {
  assert.strictEqual(decodeKey(ESC + "OB"), "down");
});

test("reads PageDown as pagedown", () => {
  assert.strictEqual(decodeKey(ESC + "[6~"), "pagedown");
});

test("reads a lone ESC as escape", () => {
  assert.strictEqual(decodeKey(ESC), "escape");
});

test("reads both carriage return and newline as enter", () => {
  assert.strictEqual(decodeKey("\r"), "enter");
  assert.strictEqual(decodeKey("\n"), "enter");
});

test("reads a tab as tab", () => {
  assert.strictEqual(decodeKey("\t"), "tab");
});

test("reads Ctrl+C as ctrl-c", () => {
  assert.strictEqual(decodeKey("\u0003"), "ctrl-c");
});

test("reads Ctrl+D as ctrl-d", () => {
  assert.strictEqual(decodeKey("\u0004"), "ctrl-d");
});

test("returns ordinary characters unchanged", () => {
  assert.strictEqual(decodeKey("q"), "q");
  assert.strictEqual(decodeKey("j"), "j");
});

test("accepts a Buffer", () => {
  assert.strictEqual(decodeKey(Buffer.from(ESC + "[A", "utf8")), "up");
});

test("returns an unknown sequence unchanged", () => {
  assert.strictEqual(decodeKey(ESC + "[99Z"), ESC + "[99Z");
});
