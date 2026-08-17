"use strict";

// Breaking a long line into the rows a screen can show.

const test = require("node:test");
const assert = require("node:assert");

const { needsWrapping, sliceTokens, wrapSegments } = require("../lib/wrap");
const { displayWidth } = require("../lib/text");

/** The pieces a line is cut into, as strings. */
function piecesOf(text, width) {
  return wrapSegments(text, width).map((seg) => text.slice(seg.from, seg.to));
}

test("leaves a line that already fits in one piece", () => {
  assert.deepStrictEqual(wrapSegments("short", 20), [{ from: 0, to: 5 }]);
  assert.strictEqual(needsWrapping("short", 20), false);
});

test("cuts an ASCII line at the width", () => {
  assert.deepStrictEqual(piecesOf("abcdefghij", 4), ["abcd", "efgh", "ij"]);
});

test("loses nothing to the cut", () => {
  const text = "a".repeat(37);

  assert.strictEqual(piecesOf(text, 8).join(""), text);
});

test("counts full-width characters as two columns", () => {
  // Eight columns is four Japanese characters, not eight
  assert.deepStrictEqual(piecesOf("日本語です", 8), ["日本語で", "す"]);
});

test("never lets a piece be wider than it was allowed", () => {
  const mixed = "abc日本語def漢字ghi🚀jkl";

  for (let width = 1; width <= 30; width += 1) {
    for (const piece of piecesOf(mixed, width)) {
      // One character can outgrow the width — half of a full-width character is
      // not a character — but nothing else may
      const overflows = displayWidth(piece) > width;
      assert.ok(
        !overflows || [...piece].length === 1,
        `at width ${width}: "${piece}" is ${displayWidth(piece)} columns`
      );
    }
  }
});

test("a character wider than the width still gets a piece of its own", () => {
  assert.deepStrictEqual(piecesOf("日本", 1), ["日", "本"]);
});

test("starts a new piece rather than splitting a full-width character", () => {
  // Seven columns cannot hold three Japanese characters, and half of one is
  // not a character at all
  const pieces = piecesOf("日本語", 5);

  assert.deepStrictEqual(pieces, ["日本", "語"]);
});

test("keeps a surrogate pair whole", () => {
  const pieces = piecesOf("\u{1F680}\u{1F680}\u{1F680}", 5);

  for (const piece of pieces) {
    assert.doesNotMatch(piece, /[\uD800-\uDBFF]$/, "a piece ended on a lone high surrogate");
  }
  assert.strictEqual(pieces.join(""), "\u{1F680}\u{1F680}\u{1F680}");
});

test("gives an empty line one empty piece, so it still gets a row", () => {
  assert.deepStrictEqual(wrapSegments("", 10), [{ from: 0, to: 0 }]);
});

test("does not wrap when no width is given", () => {
  assert.deepStrictEqual(wrapSegments("a".repeat(50), Infinity), [{ from: 0, to: 50 }]);
  assert.deepStrictEqual(wrapSegments("a".repeat(50), 0), [{ from: 0, to: 50 }]);
});

// --- tokens alongside the text ----------------------------------------------

const TOKENS = [
  { text: "const", type: "keyword" },
  { text: " x = ", type: "plain" },
  { text: "42", type: "number" },
];

test("cuts tokens to the same range as the text", () => {
  assert.deepStrictEqual(sliceTokens(TOKENS, 0, 5), [{ text: "const", type: "keyword" }]);
});

test("cuts a token that straddles the range", () => {
  assert.deepStrictEqual(sliceTokens(TOKENS, 3, 8), [
    { text: "st", type: "keyword" },
    { text: " x ", type: "plain" },
  ]);
});

test("the pieces of a token list add back up to the whole", () => {
  const whole = TOKENS.map((t) => t.text).join("");
  const first = sliceTokens(TOKENS, 0, 6).map((t) => t.text).join("");
  const rest = sliceTokens(TOKENS, 6, whole.length).map((t) => t.text).join("");

  assert.strictEqual(first + rest, whole);
});

test("drops the tokens outside the range entirely", () => {
  assert.deepStrictEqual(sliceTokens(TOKENS, 10, 12), [{ text: "42", type: "number" }]);
});

test("has nothing to say about a line with no tokens", () => {
  assert.strictEqual(sliceTokens(null, 0, 5), null);
});
