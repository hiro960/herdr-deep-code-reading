"use strict";

// The outline and the imports list, driven through the keys that open them.
// Both ride the view a search already uses, so they inherit its movement and jump.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const { createState, reduce, toScreenModel } = require("../lib/app-state");

const VIEWPORT = 20;
const COLUMNS = 179;
const GIT_IDENTITY = ["-c", "user.email=test@example.com", "-c", "user.name=herdr-deep-code-reading test"];

function run(cwd, args) {
  execFileSync("git", args, { cwd, stdio: "ignore" });
}

/** A repository whose lib/ files import one another. */
function makeRepo(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "herdr-deep-code-reading-read-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  run(root, ["init", "-q"]);
  fs.mkdirSync(path.join(root, "lib"), { recursive: true });

  fs.writeFileSync(
    path.join(root, "lib", "alpha.js"),
    [
      '"use strict";',
      'const { helper } = require("./bravo");',
      'const fs = require("node:fs");',
      "",
      "function first() {",
      "  return helper();",
      "}",
      "",
      "const second = 2;",
      "",
      "class Third {",
      "  method() {",
      "    return 3;",
      "  }",
      "}",
      "",
      "module.exports = { first, second, Third };",
      "",
    ].join("\n")
  );
  fs.writeFileSync(
    path.join(root, "lib", "bravo.js"),
    ['"use strict";', "function helper() {", "  return 1;", "}", "module.exports = { helper };", ""].join("\n")
  );
  // Mentions alpha in prose only, so it must not be listed as an importer
  fs.writeFileSync(
    path.join(root, "lib", "charlie.js"),
    ['"use strict";', "// alpha is the entry point; we use it from the outside", ""].join("\n")
  );
  fs.writeFileSync(
    path.join(root, "lib", "delta.js"),
    ['"use strict";', 'const alpha = require("./alpha");', "module.exports = alpha;", ""].join("\n")
  );

  run(root, ["add", "-A"]);
  run(root, [...GIT_IDENTITY, "commit", "-qm", "init"]);

  return root;
}

function press(state, keys) {
  return keys.reduce((current, key) => reduce(current, key, VIEWPORT), state);
}

/** Open lib/alpha.js in the reader. */
function openAlpha(root) {
  const state = press(createState(root, "files", COLUMNS), ["l", "l"]);
  assert.strictEqual(state.view, "read");
  assert.strictEqual(state.openPath, "lib/alpha.js");
  return state;
}

function hitsOf(state) {
  return state.rows.filter((row) => row.kind === "hit").map((row) => row.hit);
}

// --- the outline ------------------------------------------------------------

test("o lists what the open file defines", (t) => {
  const root = makeRepo(t);

  const outline = reduce(openAlpha(root), "o", VIEWPORT);

  assert.strictEqual(outline.view, "search");
  assert.deepStrictEqual(
    hitsOf(outline).map((hit) => hit.name),
    ["first", "second", "Third", "method"]
  );
});

test("the header names the file the outline is of", (t) => {
  const root = makeRepo(t);

  const heading = toScreenModel(reduce(openAlpha(root), "o", VIEWPORT)).title;

  assert.match(heading, /outline: lib\/alpha\.js/);
});

test("the cursor opens on the first definition", (t) => {
  const root = makeRepo(t);
  const outline = reduce(openAlpha(root), "o", VIEWPORT);

  assert.strictEqual(outline.rows[outline.cursor].kind, "hit");
});

test("l jumps to the definition's line in the file", (t) => {
  const root = makeRepo(t);
  const outline = reduce(openAlpha(root), "o", VIEWPORT);
  const target = outline.rows[outline.cursor].hit;

  const jumped = reduce(outline, "l", VIEWPORT);

  assert.strictEqual(jumped.view, "read");
  assert.strictEqual(jumped.openPath, "lib/alpha.js");
  assert.strictEqual(jumped.rows[jumped.cursor].cell.num, target.line);
  assert.match(jumped.rows[jumped.cursor].cell.text, /function first/);
});

test("h from the outline gives the file back", (t) => {
  const root = makeRepo(t);
  const opened = openAlpha(root);

  const back = press(opened, ["o", "h"]);

  assert.strictEqual(back.view, "read");
  assert.strictEqual(back.openPath, "lib/alpha.js");
});

test("says so when a language has no patterns here", (t) => {
  // Not "no definitions found": that is a fact about the file, and it is not true of a
  // file in a language nothing here knows how to read. The two are said apart so that a
  // reader knows whether to stop looking or to reach for `/`.
  const root = makeRepo(t);
  fs.writeFileSync(path.join(root, "lib", "empty.txt"), "just prose\n");
  const reading = press(createState(root, "files", COLUMNS), ["l", "G", "l"]);
  assert.strictEqual(reading.openPath, "lib/empty.txt");

  const attempted = reduce(reading, "o", VIEWPORT);

  assert.strictEqual(attempted.view, "read");
  assert.match(attempted.message, /No outline for lib\/empty\.txt/);
});

test("says so when a file it can read declares nothing", (t) => {
  const root = makeRepo(t);
  fs.writeFileSync(path.join(root, "lib", "quiet.js"), "// nothing but a comment\n");
  const reading = press(createState(root, "files", COLUMNS), ["l", "G", "l"]);
  assert.strictEqual(reading.openPath, "lib/quiet.js");

  const attempted = reduce(reading, "o", VIEWPORT);

  assert.strictEqual(attempted.view, "read");
  assert.match(attempted.message, /No definitions/);
});

// --- the imports list -------------------------------------------------------

test("i lists what the file imports and what imports it", (t) => {
  const root = makeRepo(t);

  const deps = reduce(openAlpha(root), "i", VIEWPORT);
  const hits = hitsOf(deps);

  assert.ok(
    hits.some((hit) => hit.name === "./bravo"),
    "the relative require is missing"
  );
  assert.ok(
    hits.some((hit) => hit.path === "lib/delta.js"),
    "the importer is missing"
  );
});

test("leaves package imports and prose out", (t) => {
  const root = makeRepo(t);

  const hits = hitsOf(reduce(openAlpha(root), "i", VIEWPORT));

  assert.ok(!hits.some((hit) => hit.name === "node:fs"), "a package was listed");
  assert.ok(!hits.some((hit) => hit.path === "lib/charlie.js"), "prose was read as an import");
});

test("groups the two directions under headings", (t) => {
  const root = makeRepo(t);

  const notes = reduce(openAlpha(root), "i", VIEWPORT)
    .rows.filter((row) => row.kind === "note")
    .map((row) => row.text);

  assert.deepStrictEqual(notes, ["imports (1)", "imported by (1)"]);
});

test("l opens the file that imports this one", (t) => {
  const root = makeRepo(t);
  const deps = reduce(openAlpha(root), "i", VIEWPORT);
  const importerRow = deps.rows.findIndex(
    (row) => row.kind === "hit" && row.hit.path === "lib/delta.js"
  );

  const jumped = reduce({ ...deps, cursor: importerRow }, "l", VIEWPORT);

  assert.strictEqual(jumped.view, "read");
  assert.strictEqual(jumped.openPath, "lib/delta.js");
});

test("coming back from an outline restores the search that led there", (t) => {
  // Regression: the outline and a search share one view, and the header's name for
  // the list was not part of what going back restored — so a search's hits came
  // back under the outline's title.
  const root = makeRepo(t);
  const searched = press(createState(root, "files", COLUMNS), [
    "/", "h", "e", "l", "p", "e", "r", "enter",
  ]);
  assert.strictEqual(searched.view, "search");
  const searchHeading = toScreenModel(searched).title;

  // search → open a hit → its outline → back → back
  const wandered = press(searched, ["l", "o"]);
  assert.match(toScreenModel(wandered).title, /outline:/);

  const returned = press(wandered, ["h", "h"]);

  assert.strictEqual(returned.view, "search");
  assert.strictEqual(toScreenModel(returned).title, searchHeading);
  assert.deepStrictEqual(returned.hits, searched.hits);
});

test("coming back from a search restores the outline that led there", (t) => {
  const root = makeRepo(t);
  const outline = press(openAlpha(root), ["o"]);
  const outlineHeading = toScreenModel(outline).title;

  const searched = press(outline, ["/", "h", "e", "l", "p", "e", "r", "enter"]);
  assert.doesNotMatch(toScreenModel(searched).title, /outline:/);

  assert.strictEqual(toScreenModel(reduce(searched, "h", VIEWPORT)).title, outlineHeading);
});

// --- the column cursor and the jump it makes possible ------------------------

/** Put the cursor on the line whose text matches, at the start of the given word. */
function onWord(state, linePattern, word) {
  const row = state.rows.findIndex(
    (entry) => entry.kind === "line" && linePattern.test(entry.cell.text)
  );
  assert.notStrictEqual(row, -1, `no line matching ${linePattern}`);
  const column = state.rows[row].cell.text.indexOf(word);
  assert.notStrictEqual(column, -1, `${word} is not on that line`);

  return { ...state, cursor: row, column };
}

test("w and b step between the names on a line", (t) => {
  const root = makeRepo(t);
  const reading = onWord(openAlpha(root), /return helper/, "return");

  const forward = reduce(reading, "w", VIEWPORT);
  assert.strictEqual(toScreenModel(forward).word.text, "helper");

  assert.strictEqual(toScreenModel(reduce(forward, "b", VIEWPORT)).word.text, "return");
});

test("the screen model names the word the cursor is on", (t) => {
  const root = makeRepo(t);
  const reading = onWord(openAlpha(root), /function first/, "first");

  assert.strictEqual(toScreenModel(reading).word.text, "first");
});

test("a cursor on whitespace is on no word", (t) => {
  const root = makeRepo(t);
  const reading = onWord(openAlpha(root), /return helper/, "return");

  // Column 0 of "  return helper();" is a space
  assert.strictEqual(toScreenModel({ ...reading, column: 0 }).word, null);
});

test("h leaves the file only once the column is back at the start", (t) => {
  const root = makeRepo(t);
  const reading = onWord(openAlpha(root), /function first/, "first");
  assert.ok(reading.column > 0);

  const stepped = reduce(reading, "h", VIEWPORT);
  assert.strictEqual(stepped.view, "read", "h left the file with the column mid-line");
  assert.strictEqual(stepped.column, reading.column - 1);

  const atStart = { ...reading, column: 0 };
  assert.strictEqual(reduce(atStart, "h", VIEWPORT).view, "browse");
});

test("Enter follows a name to where it is defined", (t) => {
  const root = makeRepo(t);
  const reading = onWord(openAlpha(root), /return helper/, "helper");

  const jumped = reduce(reading, "enter", VIEWPORT);

  assert.strictEqual(jumped.view, "read");
  assert.strictEqual(jumped.openPath, "lib/bravo.js");
  assert.match(jumped.rows[jumped.cursor].cell.text, /function helper/);
});

test("the jump lands with the name under the cursor", (t) => {
  const root = makeRepo(t);
  const jumped = reduce(onWord(openAlpha(root), /return helper/, "helper"), "enter", VIEWPORT);

  assert.strictEqual(toScreenModel(jumped).word.text, "helper");
});

test("Ctrl+O comes back from a definition jump", (t) => {
  const root = makeRepo(t);
  const reading = onWord(openAlpha(root), /return helper/, "helper");

  const back = reduce(reduce(reading, "enter", VIEWPORT), "ctrl-o", VIEWPORT);

  assert.strictEqual(back.openPath, "lib/alpha.js");
  assert.strictEqual(back.cursor, reading.cursor);
});

test("a name nothing defines falls back to everywhere it appears", (t) => {
  // Being told where a name is used beats being told the search failed
  const root = makeRepo(t);
  const reading = onWord(openAlpha(root), /module\.exports/, "module");

  const listed = reduce(reading, "enter", VIEWPORT);

  assert.strictEqual(listed.view, "search");
  assert.match(toScreenModel(listed).title, /references: module/);
});

test("says so when the cursor is on no name", (t) => {
  const root = makeRepo(t);
  const reading = { ...onWord(openAlpha(root), /return helper/, "return"), column: 0 };

  const attempted = reduce(reading, "enter", VIEWPORT);

  assert.strictEqual(attempted.view, "read");
  assert.match(attempted.message, /on a name first/);
});

test("a name defined in several places opens a list", (t) => {
  const root = makeRepo(t);
  fs.writeFileSync(
    path.join(root, "lib", "echo.js"),
    ['"use strict";', "function helper() {", "  return 2;", "}", ""].join("\n")
  );
  run(root, ["add", "-A"]);
  const reading = onWord(openAlpha(root), /return helper/, "helper");

  const listed = reduce(reading, "enter", VIEWPORT);

  assert.strictEqual(listed.view, "search");
  assert.match(toScreenModel(listed).title, /definition: helper/);
  assert.strictEqual(listed.rows.filter((row) => row.kind === "hit").length, 2);
});

test("a file nothing imports still lists what it imports", (t) => {
  const root = makeRepo(t);
  const reading = press(createState(root, "files", COLUMNS), ["l", "j", "l"]);
  assert.strictEqual(reading.openPath, "lib/bravo.js");

  const deps = reduce(reading, "i", VIEWPORT);

  assert.strictEqual(deps.view, "search");
  assert.match(
    deps.rows.find((row) => row.kind === "note" && row.text.startsWith("imports")).text,
    /imports \(0\)/
  );
});
