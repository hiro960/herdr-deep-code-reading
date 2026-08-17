"use strict";

const test = require("node:test");
const assert = require("node:assert");

const { filterByName, matchScore } = require("../lib/fuzzy");

const ENTRIES = [
  { name: "app-state.js" },
  { name: "ansi.js" },
  { name: "comments.js" },
  { name: "diff-parser.js" },
  { name: "side-by-side.js" },
];

// --- matching ------------------------------------------------------------

test("matches a contiguous substring", () => {
  assert.notStrictEqual(matchScore("app-state.js", "state"), null);
});

test("matches characters spread through the name", () => {
  // "ass" appears as a subsequence of "app-state.js"
  assert.notStrictEqual(matchScore("app-state.js", "ass"), null);
});

test("rejects characters that are out of order", () => {
  assert.strictEqual(matchScore("app-state.js", "etats"), null);
});

test("rejects a character the name does not contain", () => {
  assert.strictEqual(matchScore("ansi.js", "z"), null);
});

test("matches regardless of case", () => {
  assert.notStrictEqual(matchScore("AppState.js", "appstate"), null);
});

test("matches everything with an empty query", () => {
  assert.notStrictEqual(matchScore("anything", ""), null);
});

test("scores a contiguous run above a scattered one", () => {
  const contiguous = matchScore("app-state.js", "state");
  const scattered = matchScore("app-state.js", "sae");

  assert.ok(contiguous > scattered, `${contiguous} should beat ${scattered}`);
});

test("scores a match at a word boundary above one inside a word", () => {
  const boundary = matchScore("side-by-side.js", "by");
  const inside = matchScore("maybe.js", "by");

  assert.ok(boundary > inside, `${boundary} should beat ${inside}`);
});

test("scores a prefix match highest", () => {
  const prefix = matchScore("ansi.js", "ans");
  const later = matchScore("transient.js", "ans");

  assert.ok(prefix > later, `${prefix} should beat ${later}`);
});

// --- filtering -----------------------------------------------------------

test("returns every entry for an empty query", () => {
  assert.strictEqual(filterByName(ENTRIES, "").length, ENTRIES.length);
});

test("keeps the original order for an empty query", () => {
  assert.deepStrictEqual(
    filterByName(ENTRIES, "").map((entry) => entry.name),
    ENTRIES.map((entry) => entry.name)
  );
});

test("keeps only the entries that match", () => {
  const names = filterByName(ENTRIES, "js").map((entry) => entry.name);

  assert.strictEqual(names.length, ENTRIES.length);
});

test("narrows to a single entry", () => {
  const names = filterByName(ENTRIES, "comme").map((entry) => entry.name);

  assert.deepStrictEqual(names, ["comments.js"]);
});

test("orders the best match first", () => {
  const names = filterByName(ENTRIES, "side").map((entry) => entry.name);

  assert.strictEqual(names[0], "side-by-side.js");
});

test("returns nothing when no entry matches", () => {
  assert.deepStrictEqual(filterByName(ENTRIES, "zzz"), []);
});

test("does not mutate the list it was given", () => {
  const original = [...ENTRIES];

  filterByName(ENTRIES, "s");

  assert.deepStrictEqual(ENTRIES, original);
});
