"use strict";

// Scoring reads two strings at once: the name lowered, to compare against, and the
// name itself, to ask what starts a word. That only works while a position means the
// same thing in both — which two kinds of character break.
//
// A character whose lowercase is longer than itself (U+0130 is the common one) pushes
// everything after it along in the lowered copy, so the boundary check reads the
// wrong character from then on. A character outside the basic plane is two units
// wide, so stepping one unit past a match lands inside it.

const test = require("node:test");
const assert = require("node:assert");

const { filterByName, matchScore } = require("../lib/fuzzy");

test("a character that lowers to two does not move the boundaries after it", () => {
  // Arrange: the same shape, once with a plain capital and once with U+0130
  const plain = matchScore("I/notes.md", "n");
  const longerWhenLowered = matchScore("İ/notes.md", "n");

  // Assert: `n` follows a slash in both, so both should collect the boundary bonus
  assert.strictEqual(longerWhenLowered, plain);
});

test("a character that lowers to two does not shift the leading penalty", () => {
  // Arrange
  const plain = matchScore("Istanbul/notes.md", "notes");
  const longerWhenLowered = matchScore("İstanbul/notes.md", "notes");

  // Assert
  assert.strictEqual(longerWhenLowered, plain);
});

test("still finds a name whose own case is unusual", () => {
  // Assert: U+0130 lowered is "i" followed by a combining dot; asking for it by the
  // character that is actually in the name has to find it
  assert.notStrictEqual(matchScore("İstanbul.md", "İst"), null);
});

test("scores a wide character exactly as it scores a narrow one", () => {
  // Arrange: the same shape either side — one character, then the match, then one
  const wide = matchScore("a\u{1F3AF}b", "\u{1F3AF}");
  const narrow = matchScore("axb", "x");

  // Assert: how many units a character takes is not something the reader chose
  assert.notStrictEqual(wide, null);
  assert.strictEqual(wide, narrow);
});

test("does not read a shared leading unit as the start of the match", () => {
  // Arrange: two different characters that begin with the same unit. Asking the
  // string where the query's first *unit* appears answered with the other one, so the
  // match looked like it began at the start of the name and paid no leading penalty.
  const target = "\u{1F3AF}";
  const controller = "\u{1F3AE}";

  // Act: the same match, once behind that character and once behind two narrow ones
  const afterTheOther = matchScore(controller + target, target);
  const afterTwoOthers = matchScore("xy" + target, target);

  // Assert: the penalty counts what is in front of the match, whatever it is
  assert.strictEqual(afterTheOther, afterTwoOthers);
});

test("counts a run through a wide character as consecutive", () => {
  // Arrange: the same two characters, adjacent in one name and apart in the other
  const adjacent = matchScore("\u{1F3AF}ab", "\u{1F3AF}a");
  const apart = matchScore("\u{1F3AF}xa", "\u{1F3AF}a");

  // Assert
  assert.ok(
    adjacent > apart,
    `adjacent scored ${adjacent} and separated scored ${apart}`
  );
});

test("does not step into the middle of a wide character", () => {
  // Arrange: the second half of the pair must never be treated as a place to match
  const score = matchScore("\u{1F3AF}\u{1F3AF}", "\u{1F3AF}\u{1F3AF}");

  // Assert
  assert.notStrictEqual(score, null);
});

test("still ranks an abbreviation of the directories first", () => {
  // Arrange: the example lib/quick-open.js documents
  const paths = ["lib/state/views.js", "lib/list/save.js", "docs/lists/verbose.js"].map(
    (path) => ({ name: path, path })
  );

  // Act
  const [best] = filterByName(paths, "lisv");

  // Assert
  assert.strictEqual(best.path, "lib/state/views.js");
});

test("still prefers the name over a match buried in a directory", () => {
  // Arrange
  const paths = ["lib/render/panel.js", "panel/lib/render/other.js"].map((path) => ({
    name: path,
    path,
  }));

  // Act
  const [best] = filterByName(paths, "panel");

  // Assert
  assert.strictEqual(best.path, "panel/lib/render/other.js");
});
