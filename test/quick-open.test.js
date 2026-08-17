"use strict";

// Finding a file, or a definition, by typing part of its name.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const {
  isSymbolQuery,
  isSymbolQueryReady,
  matchPaths,
  matchSymbols,
  quickOpenTitle,
  symbolQuery,
} = require("../lib/quick-open");
const { createState, reduce, toScreenModel } = require("../lib/app-state");

const VIEWPORT = 20;
const COLUMNS = 179;

// --- matching a path --------------------------------------------------------

const PATHS = [
  "README.md",
  "bin/open.js",
  "lib/app-state.js",
  "lib/state/views.js",
  "lib/state/rows.js",
  "test/render.test.js",
];

test("matches a path by an abbreviation of its directories", () => {
  const { hits } = matchPaths(PATHS, "lisv");

  assert.deepStrictEqual(hits.map((hit) => hit.path), ["lib/state/views.js"]);
});

test("matches the file name alone", () => {
  const { hits } = matchPaths(PATHS, "appstate");

  assert.strictEqual(hits[0].path, "lib/app-state.js");
});

test("lists everything for an empty query", () => {
  const { hits, total } = matchPaths(PATHS, "");

  assert.strictEqual(hits.length, PATHS.length);
  assert.strictEqual(total, PATHS.length);
});

test("marks a path row as naming a file rather than a line in one", () => {
  // An empty text is what tells the renderer to show the path without a line
  const [hit] = matchPaths(PATHS, "readme").hits;

  assert.strictEqual(hit.text, "");
  assert.strictEqual(hit.line, 1);
});

test("finds nothing when nothing matches", () => {
  assert.deepStrictEqual(matchPaths(PATHS, "zzzzz").hits, []);
});

test("reports what a cap left out", () => {
  const many = Array.from({ length: 900 }, (_, index) => `lib/file${index}.js`);

  const { hits, total } = matchPaths(many, "lib");

  assert.strictEqual(hits.length, 500);
  assert.strictEqual(total, 900);
  assert.match(quickOpenTitle("lib", total, hits.length), /500 of 900/);
});

// --- telling the two queries apart ------------------------------------------

test("an @ prefix asks for a symbol", () => {
  assert.strictEqual(isSymbolQuery("@wrap"), true);
  assert.strictEqual(isSymbolQuery("wrap"), false);
  assert.strictEqual(symbolQuery("@wrap"), "wrap");
});

test("a symbol query waits until it is worth a grep", () => {
  assert.strictEqual(isSymbolQueryReady("@"), false);
  assert.strictEqual(isSymbolQueryReady("@w"), false);
  assert.strictEqual(isSymbolQueryReady("@wr"), true);
});

// --- matching a symbol out of grep hits -------------------------------------

const GREP_HITS = [
  { path: "lib/wrap.js", line: 28, text: "function wrapSegments(text, width) {" },
  { path: "lib/render.js", line: 91, text: "  const segments = wrapSegments(prepared, width);" },
  { path: "lib/wrap.js", line: 70, text: "function needsWrapping(text, width) {" },
  { path: "notes.md", line: 3, text: "wrapSegments is the one that does the work" },
];

test("keeps the line that declares the name, not the ones that call it", () => {
  const { hits } = matchSymbols(GREP_HITS, "wrapSegments");

  assert.deepStrictEqual(
    hits.map((hit) => [hit.path, hit.line]),
    [["lib/wrap.js", 28]]
  );
});

test("matches part of a name, ignoring case", () => {
  const { hits } = matchSymbols(GREP_HITS, "wrap");

  assert.deepStrictEqual(hits.map((hit) => hit.name), ["wrapSegments", "needsWrapping"]);
});

test("carries the name it found, so the jump can land on it", () => {
  const [hit] = matchSymbols(GREP_HITS, "wrapseg").hits;

  assert.strictEqual(hit.name, "wrapSegments");
});

// --- driving it through the pane --------------------------------------------

function run(cwd, args) {
  execFileSync("git", args, { cwd, stdio: "ignore" });
}

function makeRepo(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "herdr-deep-code-reading-open-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  run(root, ["init", "-q"]);
  fs.mkdirSync(path.join(root, "lib", "state"), { recursive: true });
  fs.writeFileSync(path.join(root, "lib", "state", "views.js"), "function openBrowser() {}\n");
  fs.writeFileSync(path.join(root, "lib", "wrap.js"), "function wrapSegments() {}\nconst x = 1;\n");
  fs.writeFileSync(path.join(root, "README.md"), "# read me\n\nwrapSegments is mentioned here\n");
  run(root, ["add", "-A"]);
  run(root, ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init"]);

  return root;
}

function press(state, keys) {
  return keys.reduce((current, key) => reduce(current, key, VIEWPORT), state);
}

function pathsOn(state) {
  return state.rows.filter((row) => row.kind === "hit").map((row) => row.hit.path);
}

test("P lists every file in the repository", (t) => {
  const root = makeRepo(t);

  const finding = reduce(createState(root, "review", COLUMNS), "P", VIEWPORT);

  assert.strictEqual(finding.input.kind, "open");
  assert.deepStrictEqual(pathsOn(finding).sort(), [
    "README.md",
    "lib/state/views.js",
    "lib/wrap.js",
  ]);
});

test("typing narrows the list as it goes", (t) => {
  const root = makeRepo(t);

  const typed = press(createState(root, "review", COLUMNS), ["P", "l", "i", "s", "v"]);

  assert.deepStrictEqual(pathsOn(typed), ["lib/state/views.js"]);
  assert.strictEqual(typed.input.text, "lisv");
});

test("Enter opens the file the cursor is on", (t) => {
  const root = makeRepo(t);

  const opened = press(createState(root, "review", COLUMNS), ["P", "w", "r", "a", "p", "enter"]);

  assert.strictEqual(opened.view, "read");
  assert.strictEqual(opened.openPath, "lib/wrap.js");
  assert.strictEqual(opened.input, null);
});

test("the arrows choose without typing into the query", (t) => {
  const root = makeRepo(t);
  const finding = reduce(createState(root, "review", COLUMNS), "P", VIEWPORT);

  const moved = press(finding, ["down"]);

  assert.strictEqual(moved.cursor, finding.cursor + 1);
  assert.strictEqual(moved.input.text, "", "the arrow was typed into the query");
});

test("Esc puts back the view it was opened over", (t) => {
  const root = makeRepo(t);
  const diff = createState(root, "review", COLUMNS);

  const cancelled = press(diff, ["P", "l", "i", "b", "escape"]);

  assert.strictEqual(cancelled.view, "diff");
  assert.strictEqual(cancelled.input, null);
});

test("typing does not fill the history with half-written queries", (t) => {
  // One place to come back to, however many keys the query took
  const root = makeRepo(t);
  const before = createState(root, "review", COLUMNS).history.length;

  const typed = press(createState(root, "review", COLUMNS), ["P", "l", "i", "b", "s", "t"]);

  assert.strictEqual(typed.history.length, before + 1);
});

test("@ finds a definition anywhere in the repository", (t) => {
  const root = makeRepo(t);

  const found = press(createState(root, "review", COLUMNS), ["P", "@", "w", "r", "a", "p"]);
  const hits = found.rows.filter((row) => row.kind === "hit").map((row) => row.hit);

  assert.deepStrictEqual(hits.map((hit) => hit.path), ["lib/wrap.js"]);
  assert.strictEqual(hits[0].line, 1);
});

test("@ leaves out the lines that only mention the name", (t) => {
  const root = makeRepo(t);

  const found = press(createState(root, "review", COLUMNS), [
    "P", "@", "w", "r", "a", "p", "S", "e", "g",
  ]);

  assert.ok(!pathsOn(found).includes("README.md"), "prose was read as a definition");
});

test("@ matches a camelCase name typed in lower case", (t) => {
  const root = makeRepo(t);

  const found = press(createState(root, "review", COLUMNS), [
    "P", "@", "w", "r", "a", "p", "s", "e", "g",
  ]);

  assert.deepStrictEqual(pathsOn(found), ["lib/wrap.js"]);
});

test("@ says so before it is long enough to search", (t) => {
  const root = makeRepo(t);

  const short = press(createState(root, "review", COLUMNS), ["P", "@", "w"]);

  assert.strictEqual(short.rows[0].kind, "note");
  assert.match(short.rows[0].text, /at least 2 characters/);
});

test("Enter on a symbol lands on its line", (t) => {
  const root = makeRepo(t);

  const jumped = press(createState(root, "review", COLUMNS), [
    "P", "@", "w", "r", "a", "p", "s", "e", "g", "enter",
  ]);

  assert.strictEqual(jumped.openPath, "lib/wrap.js");
  assert.strictEqual(jumped.rows[jumped.cursor].cell.num, 1);
  assert.match(jumped.rows[jumped.cursor].cell.text, /wrapSegments/);
});

test("the header says what is being looked for, and how much was found", (t) => {
  const root = makeRepo(t);

  const all = reduce(createState(root, "review", COLUMNS), "P", VIEWPORT);
  assert.match(toScreenModel(all).title, /every file {2}\(3\)/);

  const narrowed = press(all, ["w", "r", "a", "p"]);
  assert.match(toScreenModel(narrowed).title, /file: wrap {2}\(1\)/);
});

test("P works from the browser and the reader too", (t) => {
  const root = makeRepo(t);

  for (const keys of [["e"], ["e", "l"], ["e", "l", "l"]]) {
    const state = press(createState(root, "review", COLUMNS), keys);
    const finding = reduce(state, "P", VIEWPORT);

    assert.strictEqual(finding.input.kind, "open", `P did nothing from ${state.view}`);
  }
});
