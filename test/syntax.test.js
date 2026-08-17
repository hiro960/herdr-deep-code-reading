"use strict";

const test = require("node:test");
const assert = require("node:assert");

const { detectLanguage, tokenizeLines } = require("../lib/syntax");

/** Flatten tokens back to text, to prove nothing is lost or duplicated. */
function textOf(tokens) {
  return tokens.map((token) => token.text).join("");
}

/** Token types in order, collapsing runs of the same type. */
function typesOf(tokens) {
  return tokens.map((token) => token.type).filter((type, i, all) => type !== all[i - 1]);
}

function tokenizeOne(line, language) {
  return tokenizeLines([line], language)[0];
}

// --- language detection --------------------------------------------------

test("detects a language from the file extension", () => {
  assert.strictEqual(detectLanguage("lib/app-state.js"), "javascript");
  assert.strictEqual(detectLanguage("main.py"), "python");
  assert.strictEqual(detectLanguage("main.rs"), "rust");
  assert.strictEqual(detectLanguage("lib/providers/advertisement_provider.dart"), "dart");
});

test("detects the languages a wider reading needs", () => {
  assert.strictEqual(detectLanguage("src/app.ts"), "typescript");
  assert.strictEqual(detectLanguage("src/App.tsx"), "typescript");
  assert.strictEqual(detectLanguage("src/main.c"), "c");
  // A header is read as C: `new` and `class` are ordinary identifiers there, and
  // mislabelling them costs more than the few C++ keywords a header goes without
  assert.strictEqual(detectLanguage("src/main.h"), "c");
  assert.strictEqual(detectLanguage("src/main.cpp"), "cpp");
  assert.strictEqual(detectLanguage("src/shape.hpp"), "cpp");
  assert.strictEqual(detectLanguage("src/Main.java"), "java");
  assert.strictEqual(detectLanguage("app/models/user.rb"), "ruby");
});

test("reads each new language's own comment marker", () => {
  for (const language of ["typescript", "c", "cpp", "java"]) {
    assert.deepStrictEqual(typesOf(tokenizeOne("count = 1; // note", language)), [
      "plain",
      "number",
      "plain",
      "comment",
    ], language);
  }
  // Ruby comments with `#`, so the JavaScript marker would leave the line plain
  assert.deepStrictEqual(typesOf(tokenizeOne("x = 1 # note", "ruby")), [
    "plain",
    "number",
    "plain",
    "comment",
  ]);
});

test("knows the keywords each new language is written in", () => {
  assert.deepStrictEqual(typesOf(tokenizeOne("interface User {", "typescript")), ["keyword", "plain"]);
  assert.deepStrictEqual(typesOf(tokenizeOne("struct point {", "c")), ["keyword", "plain"]);
  assert.deepStrictEqual(typesOf(tokenizeOne("namespace geometry {", "cpp")), ["keyword", "plain"]);
  assert.deepStrictEqual(typesOf(tokenizeOne("class Service {", "java")), ["keyword", "plain"]);
  assert.deepStrictEqual(typesOf(tokenizeOne("def total", "ruby")), ["keyword", "plain"]);
});

test("loses nothing from a line of any new language", () => {
  for (const [line, language] of [
    ['const greeting: string = "hi"; // note', "typescript"],
    ['printf("%d\\n", count); /* note */', "c"],
    ["std::vector<int> rows; // note", "cpp"],
    ['System.out.println("hi"); // note', "java"],
    ['puts "hi" # note', "ruby"],
  ]) {
    assert.strictEqual(textOf(tokenizeOne(line, language)), line, language);
  }
});

test("reads a file with no extension as prose", () => {
  assert.strictEqual(detectLanguage("Makefile"), "plain");
  assert.strictEqual(detectLanguage("LICENSE"), "plain");
});

test("reads the extensions that name prose as prose", () => {
  // A quotation mark in a sentence is not a string
  assert.strictEqual(detectLanguage("notes.txt"), "plain");
  assert.strictEqual(detectLanguage("build.log"), "plain");
});

test("reads an extension nobody here knows as code all the same", () => {
  // Regression: a Dart file was one colour from top to bottom, because an unknown
  // extension meant no highlighting at all rather than the comments, strings and
  // numbers that nearly every language writes the same way
  for (const name of ["a.scala", "a.ex", "a.zig", "a.hs", "notes.xyz"]) {
    assert.strictEqual(detectLanguage(name), "generic", name);
  }
});

test("an unknown language still gets its comments, strings and numbers", () => {
  const line = 'val x = "hello" + 42; // a note';

  assert.deepStrictEqual(tokenizeLines([line], detectLanguage("a.scala"))[0], [
    { text: "val x = ", type: "plain" },
    { text: '"hello"', type: "string" },
    { text: " + ", type: "plain" },
    { text: "42", type: "number" },
    { text: "; ", type: "plain" },
    { text: "// a note", type: "comment" },
  ]);
});

test("an unknown language claims no keywords it cannot know", () => {
  const [tokens] = tokenizeLines(["def greet() = println()"], detectLanguage("a.scala"));

  assert.ok(!tokens.some((token) => token.type === "keyword"));
});

// --- Dart ----------------------------------------------------------------

test("marks Dart's keywords", () => {
  const line = "final ads = await datasource.getAdvertisements();";

  const kinds = tokenizeLines([line], "dart")[0]
    .filter((token) => token.type === "keyword")
    .map((token) => token.text);

  assert.deepStrictEqual(kinds, ["final", "await"]);
});

test("knows the keywords Dart added later", () => {
  const line = "late final String? name; sealed class A {}";

  const kinds = tokenizeLines([line], "dart")[0]
    .filter((token) => token.type === "keyword")
    .map((token) => token.text);

  assert.deepStrictEqual(kinds, ["late", "final", "sealed", "class"]);
});

test("marks a Dart doc comment", () => {
  const [tokens] = tokenizeLines(["/// 広告一覧を取得する"], "dart");

  assert.deepStrictEqual(tokens, [{ text: "/// 広告一覧を取得する", type: "comment" }]);
});

test("marks a single-quoted Dart string, which is the usual one", () => {
  const [tokens] = tokenizeLines(["import 'dart:math';"], "dart");

  assert.deepStrictEqual(tokens, [
    { text: "import", type: "keyword" },
    { text: " ", type: "plain" },
    { text: "'dart:math'", type: "string" },
    { text: ";", type: "plain" },
  ]);
});

// --- lossless tokenizing -------------------------------------------------

test("reproduces the original line exactly", () => {
  const line = 'const x = "hi"; // note';

  assert.strictEqual(textOf(tokenizeOne(line, "javascript")), line);
});

test("reproduces a line of plain text exactly", () => {
  const line = "  just some words  ";

  assert.strictEqual(textOf(tokenizeOne(line, "plain")), line);
});

test("reproduces a line containing full-width characters", () => {
  const line = 'const 名前 = "日本語"; // コメント';

  assert.strictEqual(textOf(tokenizeOne(line, "javascript")), line);
});

test("returns one plain token for an empty line", () => {
  assert.deepStrictEqual(tokenizeOne("", "javascript"), []);
});

// --- token kinds ---------------------------------------------------------

test("marks a line comment", () => {
  const tokens = tokenizeOne("x = 1; // why", "javascript");

  assert.ok(tokens.some((token) => token.type === "comment" && token.text.includes("// why")));
});

test("marks a double-quoted string", () => {
  const tokens = tokenizeOne('const a = "text";', "javascript");

  assert.ok(tokens.some((token) => token.type === "string" && token.text === '"text"'));
});

test("keeps an escaped quote inside the string", () => {
  const tokens = tokenizeOne('const a = "a\\"b";', "javascript");
  const string = tokens.find((token) => token.type === "string");

  assert.strictEqual(string.text, '"a\\"b"');
});

test("marks a number", () => {
  const tokens = tokenizeOne("const a = 42;", "javascript");

  assert.ok(tokens.some((token) => token.type === "number" && token.text === "42"));
});

test("marks a keyword but not an identifier that contains one", () => {
  const tokens = tokenizeOne("const constant = 1;", "javascript");
  const keywords = tokens.filter((token) => token.type === "keyword").map((t) => t.text);

  assert.deepStrictEqual(keywords, ["const"]);
});

test("uses the language's own comment marker", () => {
  const tokens = tokenizeOne("x = 1  # why", "python");

  assert.ok(tokens.some((token) => token.type === "comment" && token.text.includes("# why")));
});

test("does not treat a hash as a comment in javascript", () => {
  const tokens = tokenizeOne("const a = 1; # not a comment", "javascript");

  assert.ok(!tokens.some((token) => token.type === "comment"));
});

test("marks nothing in plain text", () => {
  const tokens = tokenizeOne('const a = "x"; // y', "plain");

  assert.deepStrictEqual(typesOf(tokens), ["plain"]);
});

// --- state carried across lines ------------------------------------------

test("carries a block comment across lines", () => {
  const lines = ["/* start", "still inside", "end */ const a = 1;"];

  const rows = tokenizeLines(lines, "javascript");

  assert.strictEqual(rows[0][0].type, "comment");
  assert.strictEqual(rows[1][0].type, "comment");
  assert.ok(rows[2].some((token) => token.type === "keyword" && token.text === "const"));
});

test("closes a block comment on the same line", () => {
  const rows = tokenizeLines(["/* short */ const a = 1;"], "javascript");

  assert.ok(rows[0].some((token) => token.type === "keyword"));
});

test("does not start a block comment inside a string", () => {
  const rows = tokenizeLines(['const a = "/*";', "const b = 2;"], "javascript");

  assert.ok(rows[1].some((token) => token.type === "keyword" && token.text === "const"));
});

test("reproduces every line of a multi-line file exactly", () => {
  const lines = ["/* a", "b */", 'const c = "d"; // e'];

  const rows = tokenizeLines(lines, "javascript");

  assert.deepStrictEqual(rows.map(textOf), lines);
});
