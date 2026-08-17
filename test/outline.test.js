"use strict";

// The definitions a file declares, and the files it reaches for. Heuristics, like
// the highlighter: what matters is that the reader is offered somewhere to jump.

const test = require("node:test");
const assert = require("node:assert");

const {
  MAX_DEFINITION_LINE,
  buildImports,
  buildOutline,
  definesName,
  definitionOn,
  looksLikeImport,
} = require("../lib/outline");

/** Names only, which is what the outline is read for. */
function namesOf(lines, language) {
  return buildOutline(lines, language, "f").map((entry) => entry.name);
}

// --- JavaScript -------------------------------------------------------------

test("finds function, class, and const declarations", () => {
  const lines = [
    "function plain() {",
    "async function waiting() {",
    "export function exported() {",
    "class Shape {",
    "const value = 1;",
    "let mutable = 2;",
  ];

  assert.deepStrictEqual(namesOf(lines, "javascript"), [
    "plain",
    "waiting",
    "exported",
    "Shape",
    "value",
    "mutable",
  ]);
});

test("finds a method of a class body", () => {
  const lines = ["class Shape {", "  area() {", "  static of(x) {", "}"];

  assert.deepStrictEqual(namesOf(lines, "javascript"), ["Shape", "area", "of"]);
});

test("leaves a nested closure out of the outline", () => {
  // An outline that lists every closure is a second copy of the file
  const lines = ["function outer() {", "      const inner = () => 1;", "}"];

  assert.deepStrictEqual(namesOf(lines, "javascript"), ["outer"]);
});

test("reports the line each definition is on", () => {
  const outline = buildOutline(["", "function two() {", "}"], "javascript", "lib/a.js");

  assert.deepStrictEqual(outline, [
    { path: "lib/a.js", line: 2, text: "function two() {", name: "two" },
  ]);
});

// --- the other languages ----------------------------------------------------

test("finds Python definitions", () => {
  const lines = ["class Thing:", "    def method(self):", "def free():"];

  assert.deepStrictEqual(namesOf(lines, "python"), ["Thing", "method", "free"]);
});

test("finds Rust definitions", () => {
  const lines = ["pub fn open() {", "struct Handle {", "impl Handle {", "    fn close(&self) {"];

  assert.deepStrictEqual(namesOf(lines, "rust"), ["open", "Handle", "Handle", "close"]);
});

test("finds Go definitions, methods included", () => {
  const lines = ["func Open() {", "func (h *Handle) Close() {", "type Handle struct {"];

  assert.deepStrictEqual(namesOf(lines, "go"), ["Open", "Close", "Handle"]);
});

test("finds shell functions", () => {
  assert.deepStrictEqual(namesOf(["run() {", "function main() {"], "shell"), ["run", "main"]);
});

test("finds TOML tables and Markdown headings", () => {
  assert.deepStrictEqual(namesOf(["[server]", "[[actions]]"], "toml"), ["server", "actions"]);
  assert.deepStrictEqual(namesOf(["# Title", "## Part"], "markdown"), ["Title", "Part"]);
});

// --- TypeScript --------------------------------------------------------------

test("finds the declarations TypeScript adds to JavaScript", () => {
  // A TypeScript file read as JavaScript has an outline made of whatever functions
  // it happens to declare, and none of the types the file exists to define
  const lines = [
    "export interface User {",
    'type UserRole = "admin" | "member";',
    "export enum Status {",
    "declare module Legacy {",
    "namespace Inner {",
  ];

  assert.deepStrictEqual(namesOf(lines, "typescript"), [
    "User",
    "UserRole",
    "Status",
    "Legacy",
    "Inner",
  ]);
});

test("still finds everything JavaScript declares in a TypeScript file", () => {
  const lines = [
    "export function formatUser(user: User): string {",
    "export default class Service {",
    "const value: number = 1;",
    "  private send(message: string): void {",
  ];

  assert.deepStrictEqual(namesOf(lines, "typescript"), [
    "formatUser",
    "Service",
    "value",
    "send",
  ]);
});

// --- Dart ---------------------------------------------------------------------

test("finds the types and top-level bindings a Dart file declares", () => {
  // The highlighter has known Dart since it was added; the outline did not, so a
  // Dart file listed nothing at all
  const lines = [
    "class Shape {",
    "abstract class Drawable {",
    "mixin Logging {",
    "extension Padding on Widget {",
    "enum Status { open, closed }",
    "typedef Handler = void Function(String);",
    "final defaultTheme = ThemeData();",
    "const maxRows = 40;",
  ];

  assert.deepStrictEqual(namesOf(lines, "dart"), [
    "Shape",
    "Drawable",
    "Logging",
    "Padding",
    "Status",
    "Handler",
    "defaultTheme",
    "maxRows",
  ]);
});

test("finds Dart functions and the methods of a class body", () => {
  const lines = [
    "void main() {",
    "Future<void> load(String path) async {",
    "  Widget build(BuildContext context) {",
    "  @override",
    "  void dispose() {",
    "  static Shape of(BuildContext context) =>",
    "String get title => _title;",
  ];

  assert.deepStrictEqual(namesOf(lines, "dart"), [
    "main",
    "load",
    "build",
    "dispose",
    "of",
    "title",
  ]);
});

test("does not read a Dart call or a widget tree as a declaration", () => {
  // A build method is mostly nested constructor calls, and an outline made of
  // them is a second copy of the file
  const lines = [
    "    return Column(",
    "      children: [",
    "        Text('hello'),",
    "      ],",
    "    );",
    "if (ready) {",
  ];

  assert.deepStrictEqual(namesOf(lines, "dart"), []);
});

test("leaves a Dart import out of the outline", () => {
  const lines = ["import 'package:flutter/material.dart';", "part 'a.g.dart';"];

  assert.deepStrictEqual(namesOf(lines, "dart"), []);
});

// --- the C family ------------------------------------------------------------

test("finds C functions, aggregates, typedefs, and macros", () => {
  const lines = [
    "struct point {",
    "typedef struct point Point;",
    "enum colour {",
    "static int add(int a, int b) {",
    "void render(void) {",
    "#define MAX_ROWS 10",
  ];

  assert.deepStrictEqual(namesOf(lines, "c"), [
    "point",
    "Point",
    "colour",
    "add",
    "render",
    "MAX_ROWS",
  ]);
});

test("does not read a C control statement as a function", () => {
  // `if (ready) {` has the shape of a definition and is not one. A return type is
  // what separates them, so one is required.
  const lines = ["if (ready) {", "while (going) {", "switch (key) {", "} else if (x) {"];

  assert.deepStrictEqual(namesOf(lines, "c"), []);
});

test("finds what C++ adds, in a header as well as a source file", () => {
  // A .h holding `class` is C++ whatever the extension suggests, and a C file will
  // never contain the line — so both languages are offered the pattern
  const lines = ["class Shape {", "namespace geometry {", "struct Point {"];

  assert.deepStrictEqual(namesOf(lines, "cpp"), ["Shape", "geometry", "Point"]);
  assert.deepStrictEqual(namesOf(lines, "c"), ["Shape", "geometry", "Point"]);
});

// --- Java --------------------------------------------------------------------

test("finds Java types and the methods of their bodies", () => {
  const lines = [
    "public final class Service {",
    "    public static void main(String[] args) {",
    "  private int count() {",
    "public interface Repository {",
    "public enum Status {",
    "public record Point(int x, int y) {",
  ];

  assert.deepStrictEqual(namesOf(lines, "java"), [
    "Service",
    "main",
    "count",
    "Repository",
    "Status",
    "Point",
  ]);
});

// --- Ruby --------------------------------------------------------------------

test("finds Ruby classes, modules, and methods", () => {
  const lines = [
    "module Billing",
    "  class Invoice < Base",
    "    def total",
    "    def self.build(rows)",
    "def free_standing",
  ];

  assert.deepStrictEqual(namesOf(lines, "ruby"), [
    "Billing",
    "Invoice",
    "total",
    "build",
    "free_standing",
  ]);
});

test("keeps the punctuation a Ruby method name ends with", () => {
  // `valid?` and `save!` are different names from `valid` and `save`
  assert.deepStrictEqual(namesOf(["  def valid?", "  def save!"], "ruby"), ["valid?", "save!"]);
});

// --- markdown ----------------------------------------------------------------

test("outlines a document by its headings, at every level", () => {
  const lines = ["# One", "prose", "#### Four", "###### Six", "####### seven"];

  assert.deepStrictEqual(namesOf(lines, "markdown"), ["One", "Four", "Six"]);
});

test("keeps a code block's contents out of a document's outline", () => {
  // The `#` opening a shell or TOML block is a comment, and a heading shown inside
  // an example is part of the example
  const lines = ["# Usage", "```toml", "# ~/.config/herdr/config.toml", "```", "## Keys"];

  assert.deepStrictEqual(namesOf(lines, "markdown"), ["Usage", "Keys"]);
});

test("a heading that reads like an include is still a heading", () => {
  // The import filter answers for code, where `# include` reaches for a file
  assert.deepStrictEqual(namesOf(["# include the header"], "markdown"), ["include the header"]);
});

test("reports a heading's own line, hashes and all", () => {
  const outline = buildOutline(["", "## How it compares"], "markdown", "README.md");

  assert.deepStrictEqual(outline, [
    { path: "README.md", line: 2, text: "## How it compares", name: "How it compares" },
  ]);
});

test("a heading of one word is still what defines that word", () => {
  // `Enter` on a name looks for the line that declares it; in a document that is
  // the heading the section is called
  assert.strictEqual(definesName("## Install", "Install", "markdown"), true);
  assert.strictEqual(definesName("## Install it", "Install", "markdown"), false);
  assert.strictEqual(definesName("Install is mentioned here", "Install", "markdown"), false);
});

test("returns nothing for a language it has no patterns for", () => {
  assert.deepStrictEqual(buildOutline(["anything"], "plain", "f"), []);
});

test("returns nothing for an empty file", () => {
  assert.deepStrictEqual(buildOutline([], "javascript", "f"), []);
});

// --- imports ----------------------------------------------------------------

test("finds relative requires and imports", () => {
  const lines = [
    'const a = require("./browse-state");',
    'import b from "../lib/git";',
    'import "./side-effect";',
  ];

  assert.deepStrictEqual(
    buildImports(lines, "f").map((entry) => entry.name),
    ["./browse-state", "../lib/git", "./side-effect"]
  );
});

test("leaves a package import out", () => {
  // A bare specifier names a package, which the browser has nothing to show for
  const lines = ['const fs = require("node:fs");', 'import react from "react";'];

  assert.deepStrictEqual(buildImports(lines, "f"), []);
});

test("reports each specifier once", () => {
  const lines = ['require("./git");', 'require("./git");'];

  assert.strictEqual(buildImports(lines, "f").length, 1);
});

test("finds a Rust module path", () => {
  assert.deepStrictEqual(
    buildImports(["use crate::browse::state;"], "f").map((entry) => entry.name),
    ["browse::state"]
  );
});

// --- narrowing a grep to the lines that import -------------------------------

test("tells an import line from a mention of the same name", () => {
  for (const line of [
    'const x = require("./git");',
    'import { a } from "./git";',
    'export { a } from "./git";',
    "from .git import status",
    "use crate::git;",
    "pub mod git;",
    '#include "git.h"',
    ". ./lib/git.sh",
  ]) {
    assert.strictEqual(looksLikeImport(line), true, line);
  }
});

test("does not read prose about a file as importing it", () => {
  // Every keyword an import uses is also an ordinary word: a comment that happens
  // to say "source" or "use" is not a dependency
  for (const line of [
    "// git is the source of truth here",
    "const gitStatus = null;",
    "  // we use git for this, and import nothing",
    "Reading the diff comes from git itself.",
  ]) {
    assert.strictEqual(looksLikeImport(line), false, line);
  }
});

// --- lines too long to be a declaration --------------------------------------

test("a line far too long to be a declaration is not read as one", () => {
  // A file may hold a minified bundle, a data blob, or a generated table on one line.
  // Several of the patterns above can only decide a failure by trying every split of
  // the line, which is quadratic in its length, and the file that reaches them may be
  // two megabytes of it — see MAX_DEFINITION_LINE in lib/outline.
  const enormous = "function " + "a".repeat(MAX_DEFINITION_LINE) + "() {";

  assert.deepStrictEqual(namesOf([enormous], "javascript"), []);
  assert.strictEqual(definesName(enormous, "a".repeat(MAX_DEFINITION_LINE), "javascript"), false);
  assert.strictEqual(definitionOn(enormous, "javascript"), null);
});

test("a declaration of an ordinary length is still read", () => {
  const ordinary = "function " + "a".repeat(MAX_DEFINITION_LINE - 20) + "() {";

  assert.deepStrictEqual(namesOf([ordinary], "javascript"), ["a".repeat(MAX_DEFINITION_LINE - 20)]);
});

test("a line built to make the patterns backtrack is answered at once", () => {
  // The C and Dart function patterns are the ones that blow up: a run of stars and a
  // bracket that never closes leaves them trying every split. Timed rather than only
  // asserted on, because the answer was always the empty list — it just took minutes
  // to give. The bound is loose enough to survive a busy machine and far under what
  // an unguarded match costs.
  const pathological = "a" + "*".repeat(200000) + "b(" + "x".repeat(200000);

  const startedAt = process.hrtime.bigint();
  assert.deepStrictEqual(namesOf([pathological], "c"), []);
  assert.deepStrictEqual(namesOf([pathological], "dart"), []);
  const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1e6;

  assert.ok(elapsedMs < 2000, `matching took ${elapsedMs.toFixed(0)}ms`);
});

// --- a language with no patterns ---------------------------------------------

// Regression: a file in a language nothing here has patterns for answered `o` with
// "No definitions found", which reads as a fact about the file. A 400-line module with
// thirty functions in it says otherwise, and a reader who believes the message stops
// asking rather than reaching for a grep.

const { hasOutline } = require("../lib/outline");

test("says which languages it can outline", () => {
  assert.strictEqual(hasOutline("javascript"), true);
  assert.strictEqual(hasOutline("markdown"), true);
});

test("a language with no patterns is one it cannot outline", () => {
  assert.strictEqual(hasOutline("scala"), false);
  assert.strictEqual(hasOutline(undefined), false);
});
