"use strict";

// Where the cursor is along a line, and which word that puts it on.

const test = require("node:test");
const assert = require("node:assert");

const { clampColumn, moveWord, wordAt, wordsIn } = require("../lib/line-cursor");

const LINE = 'const { withFilter } = require("./browse-state");';
//            0123456789...

test("finds every identifier on a line, in order", () => {
  assert.deepStrictEqual(
    wordsIn(LINE).map((word) => word.text),
    ["const", "withFilter", "require", "browse", "state"]
  );
});

test("reports where each identifier starts and ends", () => {
  const [first] = wordsIn(LINE);

  assert.strictEqual(first.start, 0);
  assert.strictEqual(first.end, 5);
  assert.strictEqual(LINE.slice(first.start, first.end), "const");
});

test("finds nothing on a line with no identifiers", () => {
  assert.deepStrictEqual(wordsIn("  ---  "), []);
  assert.deepStrictEqual(wordsIn(""), []);
});

test("does not carry its position between lines", () => {
  // A shared global regex would resume from where the last line left off
  wordsIn("aaa bbb ccc");

  assert.deepStrictEqual(
    wordsIn("zzz").map((word) => word.text),
    ["zzz"]
  );
});

// --- the word under a column ------------------------------------------------

test("reads the identifier the column sits inside", () => {
  assert.strictEqual(wordAt(LINE, 0).text, "const");
  assert.strictEqual(wordAt(LINE, 4).text, "const");
  assert.strictEqual(wordAt(LINE, 8).text, "withFilter");
});

test("reads nothing between two identifiers", () => {
  // The reader is pointing at whitespace, and a jump has nothing to follow
  assert.strictEqual(wordAt(LINE, 5), null);
});

test("reads nothing past the end of the line", () => {
  assert.strictEqual(wordAt(LINE, 500), null);
});

// --- stepping between words -------------------------------------------------

test("w steps to the start of the next identifier", () => {
  const second = wordsIn(LINE)[1];

  assert.strictEqual(moveWord(LINE, 0, 1), second.start);
});

test("b steps back to the start of the previous one", () => {
  const words = wordsIn(LINE);

  assert.strictEqual(moveWord(LINE, words[2].start, -1), words[1].start);
});

test("b from inside a word goes to that word's start first", () => {
  // The same two steps vim takes: to the head of this word, then to the one before
  const words = wordsIn(LINE);
  const insideSecond = words[1].start + 2;

  const head = moveWord(LINE, insideSecond, -1);
  assert.strictEqual(head, words[1].start);
  assert.strictEqual(moveWord(LINE, head, -1), words[0].start);
});

test("w at the last identifier stays on it", () => {
  const words = wordsIn(LINE);
  const last = words[words.length - 1].start;

  assert.strictEqual(moveWord(LINE, last, 1), last);
});

test("b at the first identifier stays on it", () => {
  assert.strictEqual(moveWord(LINE, 0, -1), 0);
});

test("stepping on a line with no identifiers keeps the column", () => {
  assert.strictEqual(moveWord("   ", 2, 1), 2);
});

// --- clamping ---------------------------------------------------------------

test("keeps a column inside the line", () => {
  assert.strictEqual(clampColumn("abc", 9), 2);
  assert.strictEqual(clampColumn("abc", -4), 0);
  assert.strictEqual(clampColumn("", 3), 0);
});

test("survives a column that is not a number", () => {
  // The jump keys pass a delta larger than any line, which arrives as Infinity
  assert.strictEqual(clampColumn("abcde", Infinity), 4);
  assert.strictEqual(clampColumn("abcde", -Infinity), 0);
});
