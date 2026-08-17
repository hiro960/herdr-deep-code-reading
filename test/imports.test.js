"use strict";

// What a file reaches for.
//
// The patterns are tried in order and the first one that fits decides what the line
// imports. That has to hold whatever came before it: a line classified by its second
// or third pattern because its first one named something already listed would be
// attributed to whatever else on the line happens to look like a specifier.

const test = require("node:test");
const assert = require("node:assert");

const { buildImports } = require("../lib/outline");

function namesOf(lines) {
  return buildImports(lines, "x.js").map((entry) => entry.name);
}

test("lists each relative specifier once, in the order it appears", () => {
  // Arrange
  const lines = [
    'const a = require("./a");',
    'const b = require("./b");',
    'const againA = require("./a");',
  ];

  // Act
  const names = namesOf(lines);

  // Assert
  assert.deepStrictEqual(names, ["./a", "./b"]);
});

test("records a specifier at the line it first appears on", () => {
  // Arrange
  const lines = ['const b = require("./b");', 'const a = require("./a");'];

  // Act
  const found = buildImports(lines, "x.js");

  // Assert
  assert.deepStrictEqual(
    found.map((entry) => [entry.name, entry.line]),
    [
      ["./b", 1],
      ["./a", 2],
    ]
  );
});

test("does not read a comment as the import when the real one is already listed", () => {
  // Arrange: the line imports ./a, which line 1 already listed. The text after it is
  // a comment, and a comment is not something the file reaches for.
  const lines = [
    'const a = require("./a");',
    'const again = require("./a"); // import "./legacy" was here',
  ];

  // Act
  const names = namesOf(lines);

  // Assert
  assert.deepStrictEqual(names, ["./a"]);
});

test("classifies a line the same way whatever came before it", () => {
  // Arrange: the same line, once where its specifier is new and once where it is not
  const line = 'const again = require("./a"); // import "./legacy" was here';

  // Act
  const alone = namesOf([line]);
  const afterTheSameImport = namesOf(['const a = require("./a");', line]);

  // Assert: the line means ./a either way — it is only listed the first time
  assert.deepStrictEqual(alone, ["./a"]);
  assert.deepStrictEqual(afterTheSameImport, ["./a"]);
});

test("still reads the forms each pattern is for", () => {
  // Arrange
  const lines = [
    'const a = require("./a");',
    'import { b } from "./b";',
    'import "./c";',
    "use crate::d::thing;",
    "mod e;",
    'const bare = require("node:fs");',
  ];

  // Act
  const names = namesOf(lines);

  // Assert: a bare specifier names a package, which the browser has nothing to show
  assert.deepStrictEqual(names, ["./a", "./b", "./c", "d::thing", "e"]);
});

// --- what reaches for a file -------------------------------------------------

// Regression: the importers were a grep for the file's own name kept down to the
// lines that look like imports, and a grep for `review` finds `withPreview`. Three of
// the ten files said to import bin/review.js imported nothing of the sort.

const { namesModule } = require("../lib/outline");

test("a line whose specifier is the module names it", () => {
  assert.strictEqual(namesModule('const { applyKey } = require("../bin/review");', "review"), true);
});

test("an extension on the specifier does not hide the name", () => {
  assert.strictEqual(namesModule('require("../bin/review.js");', "review"), true);
});

test("the name inside a longer identifier is not the module", () => {
  // `withPreview` and `sheetPreview` both hold `review`, and neither is one
  assert.strictEqual(
    namesModule('const { openHit, withPreview } = require("./views");', "review"),
    false
  );
  assert.strictEqual(namesModule('const { sheetPreview } = require("./views/sheet");', "review"), false);
});

test("a longer module whose start is the name is not the name", () => {
  assert.strictEqual(namesModule('require("./logger");', "log"), false);
});

test("a name at the very start or end of the line still counts", () => {
  assert.strictEqual(namesModule("review", "review"), true);
  assert.strictEqual(namesModule("import review", "review"), true);
});
