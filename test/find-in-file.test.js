"use strict";

// Searching inside the file being read, and jumping between the matches.
//
// The reading view is where a file is read rather than compared, so `/` means the
// file in front of the reader here — not the repository, which is what the same key
// means in the browser and in a result list.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const { createState, reduce, toScreenModel } = require("../lib/app-state");
const { INPUT_FIND, VIEW_READ, VIEW_SEARCH } = require("../lib/view-names");
const {
  MESSAGE_FIND_WRAPPED_BOTTOM,
  MESSAGE_FIND_WRAPPED_TOP,
  MESSAGE_NOTHING_TO_FIND,
} = require("../lib/state/messages");

const VIEWPORT = 8;
const COLUMNS = 179;

// Line 1 and line 3 carry one "alpha" each, line 6 carries two. The numbers are
// what the assertions read, so the file is written out line by line.
const SAMPLE = [
  "const alpha = 1;",
  "function beta() {",
  "  return alpha;",
  "}",
  "const gamma = 2;",
  "// alpha, and alpha again",
  "",
].join("\n");

function makeRepo(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "herdr-deep-code-reading-find-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  execFileSync("git", ["init", "-q"], { cwd: root, stdio: "ignore" });
  fs.writeFileSync(path.join(root, "a-sample.js"), SAMPLE);
  fs.writeFileSync(path.join(root, "b-other.js"), "const alpha = 3;\n");
  execFileSync("git", ["add", "-A"], { cwd: root, stdio: "ignore" });
  execFileSync(
    "git",
    ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init"],
    { cwd: root, stdio: "ignore" }
  );

  return root;
}

function press(state, keys) {
  return keys.reduce((current, key) => reduce(current, key, VIEWPORT), state);
}

/** Open the first file of the repository for reading. */
function openSample(root) {
  const reading = press(createState(root, "files", COLUMNS), ["l"]);
  assert.strictEqual(reading.view, VIEW_READ);
  assert.strictEqual(reading.openPath, "a-sample.js");
  return reading;
}

/** The file line the cursor is on. */
function cursorLine(state) {
  const row = state.rows[state.cursor];
  return row !== undefined && row.kind === "line" ? row.cell.num : null;
}

function find(state, query) {
  return press(state, ["/", ...Array.from(query), "enter"]);
}

// --- the field ---------------------------------------------------------------

test("/ opens a field for finding text in the open file", (t) => {
  const state = reduce(openSample(makeRepo(t)), "/", VIEWPORT);

  assert.strictEqual(state.view, VIEW_READ, "/ left the file");
  assert.notStrictEqual(state.input, null, "/ opened no field");
  assert.strictEqual(state.input.kind, INPUT_FIND);
});

test("/ in a file does not search the whole repository", (t) => {
  // Regression: `/` means the repository in the browser and in a result list, and
  // reaching that branch from the reading view would drop the file being read.
  const state = find(openSample(makeRepo(t)), "alpha");

  assert.strictEqual(state.view, VIEW_READ);
  assert.notStrictEqual(state.view, VIEW_SEARCH);
});

test("the field says what it is for", (t) => {
  const state = reduce(openSample(makeRepo(t)), "/", VIEWPORT);

  assert.match(toScreenModel(state).help, /find in this file/);
});

// --- jumping -----------------------------------------------------------------

test("Enter jumps to the first match at or after the cursor", (t) => {
  const reading = openSample(makeRepo(t));
  assert.strictEqual(cursorLine(reading), 1);

  const found = find(reading, "beta");

  assert.strictEqual(cursorLine(found), 2);
  assert.strictEqual(found.input, null, "the field stayed open");
});

test("the cursor lands on the match, not on the start of the line", (t) => {
  const found = find(openSample(makeRepo(t)), "beta");

  assert.strictEqual(found.column, "function ".length);
});

test("n goes to the next match and N comes back", (t) => {
  const found = find(openSample(makeRepo(t)), "alpha");
  assert.strictEqual(cursorLine(found), 1);

  const next = reduce(found, "n", VIEWPORT);
  assert.strictEqual(cursorLine(next), 3);

  const back = reduce(next, "N", VIEWPORT);
  assert.strictEqual(cursorLine(back), 1);
  assert.strictEqual(back.column, found.column);
});

test("n visits both matches on one line", (t) => {
  const onSixth = press(find(openSample(makeRepo(t)), "alpha"), ["n", "n"]);
  assert.strictEqual(cursorLine(onSixth), 6);

  const again = reduce(onSixth, "n", VIEWPORT);

  assert.strictEqual(cursorLine(again), 6, "the second match on the line was skipped");
  assert.ok(again.column > onSixth.column);
});

test("n wraps to the top of the file and says so", (t) => {
  const last = press(find(openSample(makeRepo(t)), "alpha"), ["n", "n", "n"]);

  const wrapped = reduce(last, "n", VIEWPORT);

  assert.strictEqual(cursorLine(wrapped), 1);
  assert.strictEqual(wrapped.message, MESSAGE_FIND_WRAPPED_TOP);
});

test("N wraps to the bottom of the file and says so", (t) => {
  const first = find(openSample(makeRepo(t)), "alpha");

  const wrapped = reduce(first, "N", VIEWPORT);

  assert.strictEqual(cursorLine(wrapped), 6);
  assert.strictEqual(wrapped.message, MESSAGE_FIND_WRAPPED_BOTTOM);
});

test("scrolls the match into view", (t) => {
  const found = find(openSample(makeRepo(t)), "alpha");

  const wrapped = reduce(found, "N", VIEWPORT);

  assert.ok(wrapped.cursor >= wrapped.scroll, "the match is above the window");
  assert.ok(wrapped.cursor < wrapped.scroll + VIEWPORT, "the match is below the window");
});

// --- when there is nothing to find --------------------------------------------

test("says so when the text is nowhere in the file", (t) => {
  const state = find(openSample(makeRepo(t)), "omega");

  assert.match(state.message, /omega/);
  assert.strictEqual(cursorLine(state), 1, "the cursor moved anyway");
});

test("n before any search says what to do instead", (t) => {
  const state = reduce(openSample(makeRepo(t)), "n", VIEWPORT);

  assert.strictEqual(state.message, MESSAGE_NOTHING_TO_FIND);
  assert.strictEqual(cursorLine(state), 1);
});

test("Esc leaves the cursor where it was", (t) => {
  const reading = openSample(makeRepo(t));

  const cancelled = press(reading, ["/", "a", "l", "p", "h", "a", "escape"]);

  assert.strictEqual(cancelled.input, null);
  assert.strictEqual(cancelled.cursor, reading.cursor);
});

test("an empty query repeats the last one", (t) => {
  const found = find(openSample(makeRepo(t)), "alpha");

  const repeated = press(found, ["/", "enter"]);

  assert.strictEqual(cursorLine(repeated), 3);
});

// --- what the query outlives ---------------------------------------------------

test("the query carries over to the next file opened", (t) => {
  const found = find(openSample(makeRepo(t)), "alpha");

  // Back to the browser, down to the second file, and into it
  const other = press(found, ["escape", "j", "l"]);
  assert.strictEqual(other.openPath, "b-other.js");

  const repeated = reduce(other, "n", VIEWPORT);

  assert.strictEqual(cursorLine(repeated), 1);
  assert.strictEqual(repeated.column, "const ".length);
});

test("finds in a file's own diff as well as its contents", (t) => {
  const root = makeRepo(t);
  fs.writeFileSync(path.join(root, "a-sample.js"), SAMPLE.replace("beta", "delta"));

  const asDiff = reduce(openSample(root), "tab", VIEWPORT);

  const found = find(asDiff, "delta");
  const row = found.rows[found.cursor];
  const cell = row.kind === "pair" ? row.right : row.cell;

  assert.strictEqual(found.view, VIEW_READ);
  assert.match(cell.text, /delta/, "the cursor is not on the changed line");
});

// --- the footer ----------------------------------------------------------------

test("the reading view's footer names the find keys", (t) => {
  const help = toScreenModel(openSample(makeRepo(t))).help;

  assert.match(help, /(^|\s)\/\s/);
  assert.match(help, /(^|\s)n\/N\s/);
});
