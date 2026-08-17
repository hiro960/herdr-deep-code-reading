"use strict";

// Which words of a changed line actually changed.
//
// A line-oriented diff answers "this line is different", which is the whole of what
// the colour says today: a one-character fix and a total rewrite look the same. This
// finds the part in the middle that moved, by walking in from both ends until the two
// lines stop agreeing — git's own contrib/diff-highlight does exactly this, and its
// virtue is that it never claims a word changed when it did not.

const test = require("node:test");
const assert = require("node:assert");

const { bg, theme } = require("../lib/ansi");
const { parseUnifiedDiff } = require("../lib/diff-parser");
const { renderDiffBody } = require("../lib/render/diff-rows");
const { buildFileRows } = require("../lib/view-model");
const { markWordSpans, pairedLines, tokenize, wordSpans } = require("../lib/word-diff");

/** The substrings a set of spans picks out, for reading a result at a glance. */
function picked(text, spans) {
  return spans.map((span) => text.slice(span.start, span.end));
}

// --- tokens -------------------------------------------------------------------

test("a line breaks into words, spaces and single characters", () => {
  assert.deepStrictEqual(
    tokenize("a = 1;").map((token) => token.text),
    ["a", " ", "=", " ", "1", ";"]
  );
});

test("a token knows where in the line it is", () => {
  const tokens = tokenize("ab cd");

  assert.deepStrictEqual(tokens[0], { text: "ab", start: 0, end: 2 });
  assert.deepStrictEqual(tokens[2], { text: "cd", start: 3, end: 5 });
});

test("a word is a word in any script", () => {
  // Splitting on ASCII alone would make every Japanese line one character per token,
  // and every changed line would highlight from the first character that differs
  assert.deepStrictEqual(
    tokenize("挨拶 = 名前").map((token) => token.text),
    ["挨拶", " ", "=", " ", "名前"]
  );
});

test("an identifier is one token, not its parts", () => {
  assert.deepStrictEqual(
    tokenize("max_name_length").map((token) => token.text),
    ["max_name_length"]
  );
});

// --- what changed --------------------------------------------------------------

test("one word replaced is one word highlighted", () => {
  const spans = wordSpans("const x = 1;", "const y = 1;");

  assert.deepStrictEqual(picked("const x = 1;", spans.old), ["x"]);
  assert.deepStrictEqual(picked("const y = 1;", spans.new), ["y"]);
});

test("something added at the end highlights only the addition", () => {
  const before = "return value.length > 0;";
  const after = "return value.length > 0 && value.length <= MAX;";
  const spans = wordSpans(before, after);

  assert.deepStrictEqual(picked(before, spans.old), []);
  assert.deepStrictEqual(picked(after, spans.new), [" && value.length <= MAX"]);
});

test("something removed from the middle highlights only the removal", () => {
  const before = "greet(name, greeting, punctuation)";
  const after = "greet(name, punctuation)";
  const spans = wordSpans(before, after);

  assert.deepStrictEqual(picked(before, spans.old), ["greeting, "]);
  assert.deepStrictEqual(picked(after, spans.new), []);
});

test("two lines that are the same have nothing to point at", () => {
  const spans = wordSpans("same", "same");

  assert.deepStrictEqual(spans.old, []);
  assert.deepStrictEqual(spans.new, []);
});

test("a token is never cut in half", () => {
  // `name` and `names` share four characters, but they are two different words and
  // highlighting only the `s` would say the plural was inserted into the singular
  const spans = wordSpans("greet(name)", "greet(names)");

  assert.deepStrictEqual(picked("greet(name)", spans.old), ["name"]);
  assert.deepStrictEqual(picked("greet(names)", spans.new), ["names"]);
});

test("only the indentation changing highlights only the indentation", () => {
  const spans = wordSpans("  return x;", "    return x;");

  assert.deepStrictEqual(picked("  return x;", spans.old), ["  "]);
  assert.deepStrictEqual(picked("    return x;", spans.new), ["    "]);
});

test("a line rewritten from end to end is left alone", () => {
  // Highlighting nine tenths of a line says nothing the red and the green did not
  // already say, and it costs the reader the one thing the highlight is for
  const spans = wordSpans("const x = 1;", "await run(defaults, options);");

  assert.deepStrictEqual(spans.old, []);
  assert.deepStrictEqual(spans.new, []);
});

test("a very long line is left alone rather than walked", () => {
  // A minified bundle on one line is not something a reader is reading word by word
  const long = "x".repeat(5000);
  const spans = wordSpans(long, long + "y");

  assert.deepStrictEqual(spans.old, []);
  assert.deepStrictEqual(spans.new, []);
});

test("a span is a real slice of the line it belongs to", () => {
  const before = "  const opening = DEFAULT;";
  const after = "  const opening = greeting;";
  const spans = wordSpans(before, after);

  for (const span of [...spans.old, ...spans.new]) {
    assert.ok(span.start >= 0, "a span starts before the line does");
    assert.ok(span.end > span.start, "an empty span was reported");
  }
  assert.ok(spans.old[0].end <= before.length);
  assert.ok(spans.new[0].end <= after.length);
});

// --- which lines are compared to which -----------------------------------------

function lines(...spec) {
  return spec.map(([type, text]) => ({ type, text }));
}

test("a removed line and the added line replacing it are a pair", () => {
  const hunk = lines(["context", "a"], ["del", "x = 1"], ["add", "x = 2"], ["context", "b"]);

  assert.deepStrictEqual(pairedLines(hunk), [[1, 2]]);
});

test("a run of removals pairs with an equally long run of additions", () => {
  const hunk = lines(
    ["del", "1"], ["del", "2"],
    ["add", "one"], ["add", "two"]
  );

  assert.deepStrictEqual(pairedLines(hunk), [[0, 2], [1, 3]]);
});

test("runs of different lengths are not paired at all", () => {
  // Three lines becoming one is a rewrite, not three edits, and guessing which of the
  // three the survivor came from would put the highlight on a line at random
  const hunk = lines(["del", "1"], ["del", "2"], ["del", "3"], ["add", "one"]);

  assert.deepStrictEqual(pairedLines(hunk), []);
});

test("a pure addition has nothing to pair with", () => {
  assert.deepStrictEqual(pairedLines(lines(["context", "a"], ["add", "b"])), []);
});

test("a pure removal has nothing to pair with either", () => {
  assert.deepStrictEqual(pairedLines(lines(["del", "a"], ["context", "b"])), []);
});

test("context between two runs keeps them apart", () => {
  const hunk = lines(["del", "1"], ["context", "keep"], ["add", "one"]);

  assert.deepStrictEqual(pairedLines(hunk), []);
});

test("several separate pairs in one hunk are all found", () => {
  const hunk = lines(
    ["del", "1"], ["add", "one"],
    ["context", "keep"],
    ["del", "2"], ["add", "two"]
  );

  assert.deepStrictEqual(pairedLines(hunk), [[0, 1], [3, 4]]);
});

// --- from git's output to the screen -------------------------------------------

const REVERSE = "[7m";
const SGR_ALL = /\[[0-9;]*m/g;

const DIFF = [
  "diff --git a/greet.js b/greet.js",
  "--- a/greet.js",
  "+++ b/greet.js",
  "@@ -1,3 +1,3 @@ function greet(name)",
  " keep",
  "-  return DEFAULT + name;",
  "+  return DEFAULT + name + suffix;",
  " tail",
].join("\n");

function firstFile(text) {
  return parseUnifiedDiff(text)[0];
}

function lineRow(cell) {
  return { kind: "line", cell: { num: 2, ...cell } };
}

test("the parser leaves the spans on the lines it parsed", () => {
  const hunk = firstFile(DIFF).hunks[0];
  const removed = hunk.lines[1];
  const added = hunk.lines[2];

  assert.strictEqual(removed.spans, undefined, "nothing was removed from the line");
  assert.deepStrictEqual(picked(added.text, added.spans), [" + suffix"]);
});

test("the offsets are into the line as the screen will have it", () => {
  // The renderer expands tabs before it measures anything, so a span counted against
  // the raw text would land several columns to the left on any indented line
  const tabbed = [
    "diff --git a/a.js b/a.js",
    "@@ -1 +1 @@",
    "-\tconst x = 1;",
    "+\tconst x = 2;",
  ].join("\n");
  const added = firstFile(tabbed).hunks[0].lines[1];

  // Four columns of expanded tab, then `const x = `, then the digit that changed
  assert.strictEqual(added.spans[0].start, 14);
  assert.strictEqual(added.spans[0].end, 15);
});

test("a span is cut to the row it is shown on when the line wraps", () => {
  const long = "x".repeat(30);
  const wrapped = [
    "diff --git a/a.js b/a.js",
    "@@ -1 +1 @@",
    `-${long} one`,
    `+${long} two`,
  ].join("\n");
  const rows = buildFileRows(firstFile(wrapped), false, { unified: 20 });
  const added = rows.filter((row) => row.kind === "line" && row.cell.type === "add");

  assert.ok(added.length > 1, "the line did not wrap");
  for (const row of added) {
    for (const span of row.cell.spans) {
      assert.ok(span.end <= row.cell.text.length, "a span ran off the end of its row");
      assert.ok(span.start >= 0, "a span started before its row did");
    }
  }
});

test("the changed words are painted in the changed-word colour", () => {
  const painted = renderDiffBody(lineRow(firstFile(DIFF).hunks[0].lines[2]), 60, false, null, false);

  assert.ok(painted.includes(bg(theme.addWordBg)), "the added words were not picked out");
  assert.ok(painted.includes(bg(theme.addBg)), "the rest of the line lost its colour");
});

test("an unchanged line is painted no differently than before", () => {
  const painted = renderDiffBody(lineRow(firstFile(DIFF).hunks[0].lines[0]), 60, false, null, false);

  assert.ok(!painted.includes(bg(theme.addWordBg)));
  assert.ok(!painted.includes(bg(theme.delWordBg)));
});

test("the cursor's word wins over a changed word underneath it", () => {
  // Both marks can land on the same characters, and the narrower one has to show:
  // it is the one that says what Enter would follow
  const added = firstFile(DIFF).hunks[0].lines[2];
  const span = added.spans[0];
  const painted = renderDiffBody(lineRow(added), 60, false, { start: span.start, end: span.end }, false);

  assert.ok(painted.includes(REVERSE), "the word cursor is gone");
});

test("marking words does not change how wide a row is", () => {
  const added = firstFile(DIFF).hunks[0].lines[2];
  const withSpans = renderDiffBody(lineRow(added), 60, false, null, false);
  const without = renderDiffBody(lineRow({ ...added, spans: undefined }), 60, false, null, false);

  assert.strictEqual(
    withSpans.replace(SGR_ALL, "").length,
    without.replace(SGR_ALL, "").length
  );
});

test("marking is done once, not on every frame", () => {
  // The pass is idempotent, which is what makes it safe to run at the end of parsing
  // rather than while drawing
  const file = firstFile(DIFF);
  const before = JSON.stringify(file);

  markWordSpans([file]);

  assert.strictEqual(JSON.stringify(file), before);
});
