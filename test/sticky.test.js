"use strict";

// The thing the cursor is inside, kept on screen.

const test = require("node:test");
const assert = require("node:assert");

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const { createState, reduce, toScreenModel } = require("../lib/app-state");
const { viewportHeight } = require("../lib/run/terminal");
const { chromeRows, renderScreen } = require("../lib/render");
const { SEARCH_LIMIT, stickyText } = require("../lib/sticky");

const JS = "javascript";
const COLUMNS = 120;
const ROWS = 30;
const VIEWPORT = 20;

/** Rows the way the reading view builds them: one line of a file each. */
function fileRows(source) {
  return source.split("\n").map((text, index) => ({
    kind: "line",
    cell: { num: index + 1, text, type: "context" },
  }));
}

const SOURCE = [
  '"use strict";',            // 0
  "",                         // 1
  "function greet(name) {",   // 2
  "  const opening = 1;",     // 3
  "",                         // 4
  "  if (name) {",            // 5
  "    return opening;",      // 6
  "  }",                      // 7
  "}",                        // 8
  "",                         // 9
  "function other() {",       // 10
  "  return 2;",              // 11
  "}",                        // 12
].join("\n");

// --- a file being read ------------------------------------------------------------

test("a line inside a function is pinned to that function", () => {
  assert.strictEqual(stickyText(fileRows(SOURCE), 3, JS), "function greet(name) {");
});

test("the function's own line pins nothing, because it is already on screen", () => {
  assert.strictEqual(stickyText(fileRows(SOURCE), 2, JS), null);
});

test("a line at the top level is inside nothing", () => {
  assert.strictEqual(stickyText(fileRows(SOURCE), 0, JS), null);
  assert.strictEqual(stickyText(fileRows(SOURCE), 10, JS), null);
});

test("a blank line inside a function is still inside it", () => {
  // Taking a blank line's own indentation at face value would say the reader had
  // stepped back out to the top level
  assert.strictEqual(stickyText(fileRows(SOURCE), 4, JS), "function greet(name) {");
});

test("a deeper line still names the function rather than the branch", () => {
  // `if` is not a definition, so the walk goes past it to the thing that is
  assert.strictEqual(stickyText(fileRows(SOURCE), 6, JS), "function greet(name) {");
});

test("the function above the one being read is a sibling, not a parent", () => {
  // Line 11 is inside `other`, and `greet` is above it and closed. Answering with
  // greet would be worse than answering with nothing.
  assert.strictEqual(stickyText(fileRows(SOURCE), 11, JS), "function other() {");
});

test("the pinned line comes without its indentation", () => {
  const nested = fileRows(
    ["class Greeter {", "  greet(name) {", "    return name;", "  }", "}"].join("\n")
  );

  assert.strictEqual(stickyText(nested, 2, JS), "greet(name) {");
});

test("a language with no definition patterns pins nothing", () => {
  assert.strictEqual(stickyText(fileRows(SOURCE), 3, undefined), null);
  assert.strictEqual(stickyText(fileRows(SOURCE), 3, "brainfuck"), null);
});

// --- a diff -------------------------------------------------------------------------

test("a diff pins the hunk heading, which git has already worked out", () => {
  const rows = [
    { kind: "hunk", text: "@@ -1,5 +1,5 @@ function greet(name)" },
    { kind: "line", cell: { num: 1, text: "  const x = 1;", type: "context" } },
    { kind: "line", cell: { num: 2, text: "  const y = 2;", type: "add" } },
  ];

  assert.strictEqual(stickyText(rows, 2), "@@ -1,5 +1,5 @@ function greet(name)");
});

test("the nearer of two hunks is the one that answers", () => {
  const rows = [
    { kind: "hunk", text: "@@ first @@" },
    { kind: "line", cell: { num: 1, text: "a", type: "context" } },
    { kind: "hunk", text: "@@ second @@" },
    { kind: "line", cell: { num: 9, text: "b", type: "context" } },
  ];

  assert.strictEqual(stickyText(rows, 3), "@@ second @@");
});

test("a paired row is read for its line like any other", () => {
  const rows = [
    { kind: "hunk", text: "@@ pair @@" },
    { kind: "pair", left: null, right: { num: 1, text: "x", type: "add" } },
  ];

  assert.strictEqual(stickyText(rows, 1), "@@ pair @@");
});

// --- the edges -------------------------------------------------------------------------

test("nothing to walk through is nothing to pin", () => {
  assert.strictEqual(stickyText([], 0, JS), null);
  assert.strictEqual(stickyText(fileRows(SOURCE), -1, JS), null);
  assert.strictEqual(stickyText(fileRows(SOURCE), 999, JS), null);
  assert.strictEqual(stickyText(null, 3, JS), null);
});

test("a scope further away than the limit is not the answer to anything", () => {
  // And, more to the point, a ten-thousand-row diff must not cost a walk of itself on
  // every keystroke
  const body = Array.from({ length: SEARCH_LIMIT + 50 }, () => "  keep();").join("\n");
  const rows = fileRows("function far() {\n" + body);

  assert.strictEqual(stickyText(rows, rows.length - 1, JS), null);
  assert.strictEqual(stickyText(rows, 5, JS), "function far() {");
});

test("a control statement is not a definition, however much it looks like one", () => {
  // `  if (ready) {` has exactly the shape of a method of a class body, and the
  // pattern that finds methods used to take it — which put `if (name) {` on the
  // outline of every file and would have pinned it here
  const rows = fileRows(
    ["class C {", "  run() {", "    return 1;", "  }", "}"].join("\n")
  );

  assert.strictEqual(stickyText(rows, 2, JS), "run() {");

  for (const word of ["if", "for", "while", "switch", "catch"]) {
    const control = fileRows(["function f() {", `  ${word} (x) {`, "    inside();"].join("\n"));
    assert.strictEqual(stickyText(control, 2, JS), "function f() {", `${word} was pinned`);
  }
});

test("a note or a search hit above the cursor is walked past, not pinned", () => {
  const rows = [
    { kind: "note", text: "imports (3)" },
    { kind: "hit", hit: { path: "a.js", line: 1, text: "x" } },
    { kind: "line", cell: { num: 1, text: "  inside();", type: "context" } },
  ];

  assert.strictEqual(stickyText(rows, 2, JS), null);
});

// --- on the screen ----------------------------------------------------------------

const SGR = /\[[0-9;]*m/g;
const CURSOR = /\[\d+;\d+H/g;
const ERASE = /\[0K/g;
const HOME = /\[H/g;

function frameLines(state) {
  return renderScreen(toScreenModel(state), { columns: COLUMNS, rows: ROWS })
    .replace(HOME, "")
    .replace(ERASE, "")
    .replace(CURSOR, "\n")
    .replace(SGR, "")
    .split("\n")
    .filter((line) => line !== "");
}

function makeRepo(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "herdr-deep-code-reading-sticky-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  execFileSync("git", ["init", "-q"], { cwd: root, stdio: "ignore" });
  fs.writeFileSync(path.join(root, "greet.js"), SOURCE + "\n");
  execFileSync("git", ["add", "-A"], { cwd: root, stdio: "ignore" });
  execFileSync(
    "git",
    ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init"],
    { cwd: root, stdio: "ignore" }
  );
  fs.writeFileSync(path.join(root, "greet.js"), SOURCE.replace("const opening = 1;", "const opening = 2;") + "\n");

  return root;
}

/** Open greet.js in the reading view and put the cursor inside the first function. */
function reading(t) {
  const state = createState(makeRepo(t), "files", COLUMNS);
  const opened = reduce(reduce(state, "l", VIEWPORT), "j", VIEWPORT);
  return reduce(reduce(opened, "j", VIEWPORT), "j", VIEWPORT);
}

test("the pinned line is drawn directly under the header", (t) => {
  const state = reading(t);
  assert.strictEqual(toScreenModel(state).sticky, "function greet(name) {");

  const [, second] = frameLines(state);
  assert.match(second, /function greet\(name\) \{/);
});

test("pinning a line costs the body the row it takes", (t) => {
  // The scroll model sizes itself from chromeRows, and a frame one row taller than
  // the model thought would draw a line the reader could not scroll to
  const state = reading(t);
  const without = { ...state, rows: state.rows, cursor: 0 };

  assert.strictEqual(toScreenModel(without).sticky, null);
  assert.strictEqual(
    chromeRows(toScreenModel(state), COLUMNS) - chromeRows(toScreenModel(without), COLUMNS),
    1
  );
});

test("the scroll model counts the pinned row the frame draws", (t) => {
  // Regression. lib/run/terminal measures the body by handing chromeRows a model it
  // builds by hand, rather than the one the frame is drawn from — that is deliberate,
  // because building a whole screen model per keystroke would be waste — and the
  // pinned row was added to one and not the other. The body came out a row shorter
  // than the reducer thought, so the cursor could sit on a row nobody could see.
  // Every pure test passes its own viewport, which is why none of them noticed.
  const state = reading(t);
  assert.notStrictEqual(toScreenModel(state).sticky, null, "the fixture pins nothing");

  const columns = process.stdout.columns;
  const rows = process.stdout.rows;
  t.after(() => {
    process.stdout.columns = columns;
    process.stdout.rows = rows;
  });
  process.stdout.columns = COLUMNS;
  process.stdout.rows = ROWS;

  // What the reducer scrolls by, against what the frame actually leaves for the body
  const drawn = ROWS - chromeRows(toScreenModel(state), COLUMNS);

  assert.strictEqual(viewportHeight(state), drawn);
});

test("a frame with nothing to pin is the frame it always was", (t) => {
  const state = { ...reading(t), cursor: 0 };

  assert.strictEqual(toScreenModel(state).sticky, null);
  assert.doesNotMatch(frameLines(state)[1], /function greet/);
});

test("a diff pins the hunk heading once it has scrolled away", (t) => {
  const state = createState(makeRepo(t), "review", COLUMNS);
  const inside = reduce(reduce(state, "j", VIEWPORT), "j", VIEWPORT);

  assert.match(toScreenModel(inside).sticky, /^@@ /);
});
