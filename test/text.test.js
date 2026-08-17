"use strict";

const test = require("node:test");
const assert = require("node:assert");

const {
  displayWidth,
  expandTabs,
  fitToWidth,
  padToWidth,
  sanitize,
  truncateToWidth,
} = require("../lib/text");

const ESC = "\u001b";
const BELL = "\u0007";

test("measures ASCII width as the character count", () => {
  assert.strictEqual(displayWidth("hello"), 5);
});

test("counts a full-width character as two columns", () => {
  assert.strictEqual(displayWidth("日本語"), 6);
});

test("sums the widths of mixed half-width and full-width text", () => {
  assert.strictEqual(displayWidth("ab日本"), 6);
});

test("counts an emoji as two columns", () => {
  assert.strictEqual(displayWidth("\u{1F363}"), 2);
});

test("counts the emoji blocks outside the main range as two columns", () => {
  // Regression: these are all East Asian Wide, but sat between the listed ranges
  // and measured as one column, so a line carrying one drifted a column right.
  const wide = {
    "\u{1F680}": "rocket, Transport and Map Symbols",
    "\u{1F6F9}": "the end of Transport and Map Symbols",
    "\u{1F7E0}": "orange circle",
    "\u{1F004}": "mahjong red dragon",
    "\u{1F21A}": "squared CJK unified ideograph",
  };

  for (const [emoji, name] of Object.entries(wide)) {
    assert.strictEqual(displayWidth(emoji), 2, `${name} measured as one column`);
  }
});

test("counts a combining mark as zero and keeps the base width", () => {
  // "か" plus a combining dakuten renders as one glyph, two columns wide
  assert.strictEqual(displayWidth("が"), 2);
});

test("counts half-width katakana as one column", () => {
  assert.strictEqual(displayWidth("ｶﾅ"), 2);
});

test("measures an empty string as zero", () => {
  assert.strictEqual(displayWidth(""), 0);
});

test("expands a tab to the next tab stop", () => {
  assert.strictEqual(expandTabs("a\tb", 4), "a   b");
});

test("expands a leading tab to a full tab width", () => {
  assert.strictEqual(expandTabs("\tx", 4), "    x");
});

test("advances a full tab width when already on a tab stop", () => {
  assert.strictEqual(expandTabs("abcd\tx", 4), "abcd    x");
});

test("computes tab stops from display width, not character count", () => {
  // "日" is two columns wide, so two spaces reach the tab stop at 4
  assert.strictEqual(expandTabs("日\tx", 4), "日  x");
});

test("truncates ASCII text beyond the given width", () => {
  assert.strictEqual(truncateToWidth("abcdef", 3), "abc");
});

test("does not split a full-width character when truncating", () => {
  // Only "日" (two columns) fits in a width of three
  assert.strictEqual(truncateToWidth("日本語", 3), "日");
});

test("returns text that already fits unchanged", () => {
  assert.strictEqual(truncateToWidth("ab", 5), "ab");
});

test("truncating to zero width returns an empty string", () => {
  assert.strictEqual(truncateToWidth("abc", 0), "");
});

test("pads on the right up to the given width", () => {
  assert.strictEqual(padToWidth("ab", 5), "ab   ");
});

test("pads by display width for full-width text", () => {
  assert.strictEqual(padToWidth("日", 5), "日   ");
});

test("returns text that is already the target width unchanged", () => {
  assert.strictEqual(padToWidth("abc", 3), "abc");
});

test("returns text wider than the target unchanged", () => {
  assert.strictEqual(padToWidth("abcdef", 3), "abcdef");
});

test("strips control characters such as the bell", () => {
  assert.strictEqual(sanitize("a" + BELL + "b"), "ab");
});

test("neutralizes ANSI escapes embedded in a diff", () => {
  assert.strictEqual(sanitize("a" + ESC + "[31mred" + ESC + "[0m"), "a[31mred[0m");
});

test("keeps tabs, which expandTabs handles", () => {
  assert.strictEqual(sanitize("a\tb"), "a\tb");
});

test("returns ordinary text unchanged", () => {
  assert.strictEqual(sanitize("ordinary text"), "ordinary text");
});

test("strips the eight-bit control characters as well as the seven-bit ones", () => {
  // U+009B is CSI and U+009D is OSC in their eight-bit form, and a terminal reading
  // UTF-8 may act on either. Written by code point: they are not ESC, so a guard
  // looking for ESC alone would leave the sequence intact and still working.
  const CSI = String.fromCharCode(0x9b);
  const PADDING = String.fromCharCode(0x80);
  const APPLICATION_PROGRAM_COMMAND = String.fromCharCode(0x9f);

  assert.strictEqual(sanitize("a" + CSI + "2Jb"), "a2Jb");
  assert.strictEqual(sanitize(PADDING + APPLICATION_PROGRAM_COMMAND), "");
});

test("strips the bidi controls, which draw a line in an order it was not written in", () => {
  // The trojan-source trick: an override reorders what follows it, so one line of source
  // can read on screen as a comment and compile as the code after it
  const RIGHT_TO_LEFT_OVERRIDE = String.fromCharCode(0x202e);
  const FIRST_STRONG_ISOLATE = String.fromCharCode(0x2068);
  const POP_DIRECTIONAL_ISOLATE = String.fromCharCode(0x2069);

  assert.strictEqual(sanitize("if (admin) {" + RIGHT_TO_LEFT_OVERRIDE + " }"), "if (admin) { }");
  assert.strictEqual(sanitize(FIRST_STRONG_ISOLATE + "x" + POP_DIRECTIONAL_ISOLATE), "x");
});

test("keeps the bidi marks, which lean on a neighbour and reorder nothing", () => {
  // U+200E and U+200F are how ordinary Arabic and Hebrew text says which way a digit
  // or a bracket leans, and a file holding them is a file, not an attack
  const LEFT_TO_RIGHT_MARK = String.fromCharCode(0x200e);
  const RIGHT_TO_LEFT_MARK = String.fromCharCode(0x200f);

  assert.strictEqual(
    sanitize("a" + LEFT_TO_RIGHT_MARK + RIGHT_TO_LEFT_MARK),
    "a" + LEFT_TO_RIGHT_MARK + RIGHT_TO_LEFT_MARK
  );
});

test("keeps the printable characters either side of the eight-bit range", () => {
  // U+00A0 is a no-break space and U+007E a tilde: both are drawn rather than acted on
  const NO_BREAK_SPACE = String.fromCharCode(0xa0);

  assert.strictEqual(sanitize("~" + NO_BREAK_SPACE), "~" + NO_BREAK_SPACE);
});

test("fitting to a width strips what a terminal would act on", () => {
  // The one place every cell of every frame passes through. A file name or a commit
  // subject reaches it having been through nothing else — see test/escape-injection.
  // What is left is the printable remainder of the sequence, which is drawn as text.
  assert.strictEqual(fitToWidth("a" + ESC + "[2Jb", 8), "a[2Jb   ");
});

test("a fitted cell is exactly the width asked for however many escapes it held", () => {
  // An escape counts as a column to anything measuring characters and none to the
  // terminal drawing them, so a cell holding one used to come out narrower
  assert.strictEqual(displayWidth(fitToWidth(ESC + "[31m" + ESC + "[2Jname", 10)), 10);
});
