"use strict";

// Markdown is structure rather than syntax: what helps a reader is seeing where a
// heading, a code block, or a link is, not which words are keywords.

const test = require("node:test");
const assert = require("node:assert");

const { detectLanguage, tokenizeLines } = require("../lib/syntax");
const { headingAt, markdownHeadings } = require("../lib/markdown");

/** Flatten tokens back to text, to prove nothing is lost or duplicated. */
function textOf(tokens) {
  return tokens.map((token) => token.text).join("");
}

/** Token types in order, collapsing runs of the same type. */
function typesOf(tokens) {
  return tokens.map((token) => token.type).filter((type, i, all) => type !== all[i - 1]);
}

function tokenizeOne(line) {
  return tokenizeLines([line], "markdown")[0];
}

/** The token covering a piece of text, or undefined. */
function tokenFor(tokens, text) {
  return tokens.find((token) => token.text === text);
}

// --- headings ----------------------------------------------------------------

test("marks a heading, hashes and all", () => {
  const tokens = tokenizeOne("## Terminal width");

  assert.deepStrictEqual(tokens, [{ text: "## Terminal width", type: "heading" }]);
});

test("marks a heading at every level it has", () => {
  for (const hashes of ["#", "###", "######"]) {
    const line = `${hashes} Title`;
    assert.strictEqual(tokenizeOne(line)[0].type, "heading", line);
  }
});

test("a hash without a space is not a heading", () => {
  const tokens = tokenizeOne("#hashtag, not a heading");

  assert.ok(!tokens.some((token) => token.type === "heading"));
});

test("seven hashes are not a heading either", () => {
  assert.ok(!tokenizeOne("####### too many").some((token) => token.type === "heading"));
});

// --- fenced code -------------------------------------------------------------

const FENCED = [
  "Before.",
  "```bash",
  "herdr plugin action invoke review",
  "",
  "```",
  "After.",
];

test("marks a fenced block, its fences, and nothing after it", () => {
  const rows = tokenizeLines(FENCED, "markdown");

  assert.deepStrictEqual(typesOf(rows[0]), ["plain"], "the line before");
  assert.deepStrictEqual(typesOf(rows[1]), ["comment"], "the opening fence");
  assert.deepStrictEqual(typesOf(rows[2]), ["string"], "the code");
  assert.deepStrictEqual(typesOf(rows[4]), ["comment"], "the closing fence");
  assert.deepStrictEqual(typesOf(rows[5]), ["plain"], "the line after");
});

test("an empty line inside a fence carries no tokens", () => {
  const rows = tokenizeLines(FENCED, "markdown");

  assert.deepStrictEqual(rows[3], []);
});

test("a heading inside a fence is code, not a heading", () => {
  const rows = tokenizeLines(["```", "# not a heading", "```"], "markdown");

  assert.deepStrictEqual(typesOf(rows[1]), ["string"]);
});

test("a fence is closed only by the marker that opened it", () => {
  const rows = tokenizeLines(["```", "~~~", "```", "out"], "markdown");

  assert.deepStrictEqual(typesOf(rows[1]), ["string"], "a different marker closed the fence");
  assert.deepStrictEqual(typesOf(rows[3]), ["plain"], "the fence never closed");
});

test("an unclosed fence runs to the end of the file", () => {
  const rows = tokenizeLines(["```", "still code", "and still"], "markdown");

  assert.deepStrictEqual(typesOf(rows[2]), ["string"]);
});

// --- inline ------------------------------------------------------------------

test("marks an inline code span", () => {
  const tokens = tokenizeOne("Press `Tab` to switch");

  assert.deepStrictEqual(tokens, [
    { text: "Press ", type: "plain" },
    { text: "`Tab`", type: "string" },
    { text: " to switch", type: "plain" },
  ]);
});

test("a lone backtick stays plain", () => {
  const tokens = tokenizeOne("a ` b");

  assert.deepStrictEqual(typesOf(tokens), ["plain"]);
});

test("dims a link's brackets and its target, keeping the words", () => {
  const tokens = tokenizeOne("See [Herdr](https://herdr.dev) for more");

  assert.strictEqual(tokenFor(tokens, "Herdr").type, "plain");
  assert.strictEqual(tokenFor(tokens, "](https://herdr.dev)").type, "comment");
});

test("marks an image the same way as a link", () => {
  const tokens = tokenizeOne("![a diagram](docs/diagram.png)");

  assert.strictEqual(tokenFor(tokens, "a diagram").type, "plain");
  assert.ok(tokens.some((token) => token.type === "comment"));
});

test("dims the markers around emphasis, keeping the words", () => {
  const tokens = tokenizeOne("**The footer** names every key");

  assert.deepStrictEqual(tokens, [
    { text: "**", type: "comment" },
    { text: "The footer", type: "plain" },
    { text: "**", type: "comment" },
    { text: " names every key", type: "plain" },
  ]);
});

test("an unmatched star stays plain", () => {
  const tokens = tokenizeOne("run it over *.js files");

  assert.deepStrictEqual(typesOf(tokens), ["plain"]);
});

// --- line structure ----------------------------------------------------------

test("marks a bullet, and the text after it stays plain", () => {
  const tokens = tokenizeOne("- one thing");

  assert.deepStrictEqual(tokens, [
    { text: "-", type: "number" },
    { text: " one thing", type: "plain" },
  ]);
});

test("marks an indented bullet and a numbered one", () => {
  assert.strictEqual(tokenizeOne("  * nested")[1].type, "number");
  assert.strictEqual(tokenizeOne("1. first")[0].type, "number");
});

test("a minus in prose is not a bullet", () => {
  assert.deepStrictEqual(typesOf(tokenizeOne("-1 is a number")), ["plain"]);
});

test("dims a block quote's marker", () => {
  const tokens = tokenizeOne("> quoted text");

  assert.strictEqual(tokens[0].type, "comment");
  assert.strictEqual(tokenFor(tokens, "quoted text").type, "plain");
});

test("dims the pipes of a table row", () => {
  const tokens = tokenizeOne("| `q` | Quit the pane |");

  assert.strictEqual(tokens[0].type, "comment");
  assert.strictEqual(tokenFor(tokens, "`q`").type, "string");
});

test("a pipe in prose is left alone", () => {
  assert.deepStrictEqual(typesOf(tokenizeOne("a | b, in a sentence")), ["plain"]);
});

test("dims a horizontal rule", () => {
  assert.deepStrictEqual(typesOf(tokenizeOne("---")), ["comment"]);
  assert.deepStrictEqual(typesOf(tokenizeOne("***")), ["comment"]);
});

// --- what markdown is not ------------------------------------------------------

test("prose is not read as code", () => {
  // The code lexer would find a comment, a string, and a keyword in this sentence
  const tokens = tokenizeOne("The const in // that string is prose here");

  assert.deepStrictEqual(typesOf(tokens), ["plain"]);
});

test("a markdown file is detected as one", () => {
  assert.strictEqual(detectLanguage("README.md"), "markdown");
  assert.strictEqual(detectLanguage("docs/GUIDE.markdown"), "markdown");
});

// --- the invariant everything else rests on ------------------------------------

test("reproduces every line exactly", () => {
  // The renderer wraps a line by slicing its tokens with the same offsets it slices
  // the text with, so a token list that does not tile its line drops characters.
  const lines = [
    "# herdr-deep-code-reading",
    "",
    "Side-by-side review inside [Herdr](https://herdr.dev), **without** leaving it.",
    "",
    "| Key | Action |",
    "|---|---|",
    "| `q` | Quit |",
    "",
    "- a bullet with `code` and *emphasis*",
    "  1. a nested number",
    "",
    "> a quote with a [link](x.md)",
    "",
    "```js",
    'const a = "b"; // c',
    "```",
    "",
    "---",
    "",
    "日本語の行も **強調** を含む",
    "trailing text with an unmatched ` and a lone *",
  ];

  const rows = tokenizeLines(lines, "markdown");

  assert.deepStrictEqual(rows.map(textOf), lines);
});

// --- the headings, as a way through the document -------------------------------

test("reads a heading's level and its words", () => {
  assert.deepStrictEqual(headingAt("### Three ways to find something"), {
    level: 3,
    title: "Three ways to find something",
  });
});

test("reads every level a heading has", () => {
  assert.strictEqual(headingAt("# a").level, 1);
  assert.strictEqual(headingAt("###### f").level, 6);
  assert.strictEqual(headingAt("####### g"), null, "seven hashes are not a heading");
});

test("is not fooled by a hash that starts something else", () => {
  assert.strictEqual(headingAt("#hashtag"), null);
  assert.strictEqual(headingAt("  not # a heading"), null);
});

test("drops the hashes some documents close a heading with", () => {
  assert.strictEqual(headingAt("## Install ##").title, "Install");
});

test("lists every heading with the line it is on", () => {
  const found = markdownHeadings(["# One", "text", "## Two", "", "### Three"]);

  assert.deepStrictEqual(found, [
    { line: 1, level: 1, title: "One", text: "# One" },
    { line: 3, level: 2, title: "Two", text: "## Two" },
    { line: 5, level: 3, title: "Three", text: "### Three" },
  ]);
});

test("leaves out what only looks like a heading inside a code block", () => {
  // Regression: this repository's own README lists a TOML file's comment and a
  // heading from an example batch, because the outline read every line on its own
  const found = markdownHeadings([
    "# Real",
    "```toml",
    "# ~/.config/herdr/config.toml",
    "[[keybindings]]",
    "```",
    "## Also real",
  ]);

  assert.deepStrictEqual(
    found.map((heading) => heading.title),
    ["Real", "Also real"]
  );
});

test("keeps reading headings after a fence that opened with four backticks", () => {
  const found = markdownHeadings([
    "````markdown",
    "### inside the example",
    "```diff",
    "-  old",
    "```",
    "````",
    "## after it",
  ]);

  assert.deepStrictEqual(
    found.map((heading) => heading.title),
    ["after it"]
  );
});

test("finds nothing in a document with no headings", () => {
  assert.deepStrictEqual(markdownHeadings(["just", "prose"]), []);
});

test("gives every token a type", () => {
  const rows = tokenizeLines(["# a", "- b `c` [d](e) **f**", "| g |"], "markdown");

  for (const tokens of rows) {
    for (const token of tokens) {
      assert.ok(token.type, `a token of ${JSON.stringify(token.text)} has no type`);
      assert.notStrictEqual(token.text, "", "an empty token was emitted");
    }
  }
});
