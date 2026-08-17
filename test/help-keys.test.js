"use strict";

// The footer is the only place a key is advertised, so it has to match the view.
// A footer that names a dead key is worse than a short footer.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const { createState, reduce, toScreenModel } = require("../lib/app-state");

const VIEWPORT = 20;
const COLUMNS = 179;

// Footer token → the key press it advertises. Only these are checked; anything
// else in a footer is prose.
const ADVERTISED = {
  "j/k": ["j", "k"],
  "d/u": ["d", "u"],
  "g/G": ["g", "G"],
  "n/p": ["n", "p"],
  "n/N": ["n", "N"],
  "h/l": ["h", "l"],
  "w/b": ["w", "b"],
  "l/Enter": ["l", "enter"],
  "h/Esc": ["h", "escape"],
  "Esc/Ctrl+O": ["escape", "ctrl-o"],
  "h/Esc/Ctrl+O": ["h", "escape", "ctrl-o"],
  Enter: ["enter"],
  Esc: ["escape"],
  Tab: ["tab"],
  "Ctrl+O": ["ctrl-o"],
  space: [" "],
  A: ["A"],
  C: ["C"],
  // The two the log offers on its own: one asks the remote what it has, the other
  // takes it. `p` is also half of the diff view's "n/p", which is a different key.
  F: ["F"],
  p: ["p"],
  V: ["V"],
  W: ["W"],
  L: ["L"],
  // The way back to the working tree's diff, offered by every view but that diff itself
  D: ["D"],
  "#": ["#"],
  "?": ["?"],
  H: ["H"],
  J: ["J"],
  X: ["X"],
  R: ["R"],
  B: ["B"],
  E: ["E"],
  m: ["m"],
  a: ["a"],
  "'": ["'"],
  '"': ['"'],
  "&": ["&"],
  P: ["P"],
  O: ["O"],
  c: ["c"],
  x: ["x"],
  e: ["e"],
  S: ["S"],
  "@": ["@"],
  "|": ["|"],
  r: ["r"],
  t: ["t"],
  l: ["l"],
  h: ["h"],
  f: ["f"],
  v: ["v"],
  o: ["o"],
  i: ["i"],
  "/": ["/"],
  // How the diff was computed rather than how it is drawn — see lib/state/diff-view
  "+/-": ["+", "-"],
  "=": ["="],
};

// q always quits, which reduce reports through a flag rather than a new state
const ALWAYS_BOUND = new Set(["Q"]);

// Keys that do the same job as one the footer already names. A footer that listed
// every synonym would be twice as long and no more informative.
const SYNONYMS = new Set([
  "up",
  "down",
  "left",
  "right",
  "pageup",
  "pagedown",
  "home",
  "end",
  "ctrl-d",
  "ctrl-u",
  // Quits from anywhere, including where the footer has been replaced by a field
  "ctrl-c",
  // The same step Esc takes in the views that name it; elsewhere it does nothing,
  // because elsewhere there is nothing to step back to
  "ctrl-o",
]);

/** Every key a reader could plausibly try. */
function candidateKeys() {
  const letters = "abcdefghijklmnopqrstuvwxyz";
  return [
    ...letters,
    ...letters.toUpperCase(),
    ..."0123456789",
    " ",
    "/",
    "?",
    "'",
    '"',
    "-",
    "+",
    "=",
    "#",
    "|",
    "@",
    "&",
    "tab",
    "enter",
    "escape",
    "ctrl-o",
  ];
}

function makeRepo(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "herdr-deep-code-reading-help-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  execFileSync("git", ["init", "-q"], { cwd: root, stdio: "ignore" });
  fs.mkdirSync(path.join(root, "lib"), { recursive: true });
  for (let index = 0; index < 6; index += 1) {
    fs.writeFileSync(
      path.join(root, "lib", `f${index}.js`),
      Array.from({ length: 40 }, (_, line) => `const line${line} = ${line};`).join("\n") + "\n"
    );
  }
  execFileSync("git", ["add", "-A"], { cwd: root, stdio: "ignore" });
  execFileSync(
    "git",
    ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init"],
    { cwd: root, stdio: "ignore" }
  );

  // A second commit of two files, and a second branch, so that each of the log's four
  // panes has somewhere for its movement keys to go
  fs.writeFileSync(path.join(root, "notes.md"), "# notes\n");
  fs.writeFileSync(path.join(root, "todo.md"), "# todo\n");
  execFileSync("git", ["add", "-A"], { cwd: root, stdio: "ignore" });
  execFileSync(
    "git",
    ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "notes"],
    { cwd: root, stdio: "ignore" }
  );
  execFileSync("git", ["branch", "side"], { cwd: root, stdio: "ignore" });

  // Two changed files, so the panel has somewhere to move to. Several words per
  // line, so the column and word keys have somewhere to go as well.
  fs.writeFileSync(
    path.join(root, "lib", "f0.js"),
    "const changed = lines(here);\nconst second = more(words);\n"
  );
  fs.writeFileSync(path.join(root, "lib", "f1.js"), "const also = changed(now);\n");

  return root;
}

/**
 * The state as the loop leaves it, with any effect performed and cleared.
 *
 * A key that opens a file asks for the reading to be recorded, and lib/run/effects
 * clears the request as it carries it out. A test that only ever calls `reduce` would
 * be holding a state with a stale request on it, and then every key that clears one
 * would look like a key that did something.
 */
function settled(state) {
  return state.effect === null ? state : { ...state, effect: null };
}

function press(state, keys) {
  return keys.reduce((current, key) => settled(reduce(current, key, VIEWPORT)), state);
}

/** Match a footer token as a whole word, so "e" does not match "delete". */
function namesToken(help, token) {
  const escaped = token.replace(/[/+?]/g, (char) => "\\" + char);
  return new RegExp(`(^|\\s)${escaped}(\\s|$)`).test(help);
}

/** Every key the footer advertises for this state. */
function advertisedKeys(state) {
  const help = toScreenModel(state).help;
  const keys = [];

  for (const [token, bound] of Object.entries(ADVERTISED)) {
    if (namesToken(help, token)) {
      keys.push(...bound);
    }
  }

  return keys;
}

/**
 * Assert every advertised key is bound in this view.
 *
 * A key at the end of its range is legitimately inert — `k` on the first row does
 * nothing and should — so the question is whether the binding exists at all, which
 * is answered by trying it from a few positions rather than only the opening one.
 */
function assertFooterIsHonest(label, state) {
  const keys = advertisedKeys(state);
  assert.ok(keys.length > 0, `${label}: the footer advertised no keys at all`);

  // Enough positions that a key with somewhere to go has somewhere to go from:
  // the opening row, one row down, the last row, the second file, and — for the
  // column keys — a cursor that is not already at the start of its line
  const positions = [
    state,
    settled(reduce(state, "j", VIEWPORT)),
    settled(reduce(state, "G", VIEWPORT)),
    settled(reduce(state, "n", VIEWPORT)),
    press(state, ["j", "w", "l"]),
  ];

  for (const key of keys) {
    if (ALWAYS_BOUND.has(key)) {
      continue;
    }
    const bound = positions.some((from) => reduce(from, key, VIEWPORT) !== from);
    assert.ok(
      bound,
      `${label}: the footer offers ${JSON.stringify(key)} but nothing is bound to it`
    );
  }
}

/**
 * Assert the footer names every key this view binds.
 *
 * The other direction of the same promise: a reader opening the pane for the first
 * time learns what it can do from the footer and nowhere else, so a key that works
 * but is never named might as well not exist.
 */
/**
 * Whether a key changes anything but the footer's message.
 *
 * A key that only says where it does work — "Switch to the diff to comment" — has
 * not done anything, and naming it in the footer of the view that refuses it would
 * be the opposite of helpful.
 */
function actsBeyondAMessage(from, key) {
  const next = reduce(from, key, VIEWPORT);
  if (next === from) {
    return false;
  }
  return Object.keys({ ...from, ...next }).some(
    (field) => field !== "message" && field !== "pendingQuit" && next[field] !== from[field]
  );
}

function assertFooterIsComplete(label, state) {
  const advertised = new Set(advertisedKeys(state));
  const positions = [
    state,
    settled(reduce(state, "j", VIEWPORT)),
    settled(reduce(state, "G", VIEWPORT)),
    settled(reduce(state, "n", VIEWPORT)),
  ];

  for (const key of candidateKeys()) {
    if (advertised.has(key) || ALWAYS_BOUND.has(key) || SYNONYMS.has(key)) {
      continue;
    }
    const acts = positions.some((from) => actsBeyondAMessage(from, key));
    assert.ok(
      !acts,
      `${label}: ${JSON.stringify(key)} does something but the footer never names it`
    );
  }
}

test("the diff panel's footer only names keys that work", (t) => {
  const root = makeRepo(t);

  assertFooterIsHonest("diff/panel", createState(root, "review", COLUMNS));
});

test("the diff body's footer only names keys that work", (t) => {
  const root = makeRepo(t);
  const state = reduce(createState(root, "review", COLUMNS), "tab", VIEWPORT);

  assertFooterIsHonest("diff/body", state);
});

test("the browser's footer only names keys that work", (t) => {
  const root = makeRepo(t);

  assertFooterIsHonest("browse", createState(root, "files", COLUMNS));
});

test("the reading view's footer only names keys that work", (t) => {
  const root = makeRepo(t);
  const state = press(createState(root, "files", COLUMNS), ["l", "l"]);
  assert.strictEqual(state.view, "read");

  assertFooterIsHonest("read", state);
});

test("the search view's footer only names keys that work", (t) => {
  const root = makeRepo(t);
  const state = press(createState(root, "files", COLUMNS), ["/", "l", "i", "n", "e", "enter"]);
  assert.strictEqual(state.view, "search");

  assertFooterIsHonest("search", state);
});

test("the log's footer only names keys that work", (t) => {
  const root = makeRepo(t);
  const state = reduce(createState(root, "review", COLUMNS), "L", VIEWPORT);
  assert.strictEqual(state.view, "log");

  assertFooterIsHonest("log", state);
});

test("the log's footer is honest in each of its four panes", (t) => {
  const root = makeRepo(t);
  let state = reduce(createState(root, "review", COLUMNS), "L", VIEWPORT);

  for (const pane of ["graph", "panel", "diff", "branches"]) {
    assert.strictEqual(state.log.focus, pane);
    assertFooterIsHonest(`log/${pane}`, state);
    state = reduce(state, "tab", VIEWPORT);
  }
});

// --- the paging keys specifically ------------------------------------------

test("every list view pages with d and jumps with G", (t) => {
  const root = makeRepo(t);

  const browse = createState(root, "files", COLUMNS);
  assert.notStrictEqual(reduce(browse, "d", VIEWPORT), browse, "browse: d does nothing");
  assert.notStrictEqual(reduce(browse, "G", VIEWPORT), browse, "browse: G does nothing");

  const reading = press(browse, ["l", "l"]);
  assert.notStrictEqual(reduce(reading, "d", VIEWPORT), reading, "read: d does nothing");
  assert.notStrictEqual(reduce(reading, "G", VIEWPORT), reading, "read: G does nothing");

  const searched = press(browse, ["/", "l", "i", "n", "e", "enter"]);
  assert.notStrictEqual(reduce(searched, "d", VIEWPORT), searched, "search: d does nothing");
  assert.notStrictEqual(reduce(searched, "G", VIEWPORT), searched, "search: G does nothing");
});

test("G reaches the last entry of a long directory", (t) => {
  const root = makeRepo(t);
  const inLib = press(createState(root, "files", COLUMNS), ["l"]);
  assert.ok(inLib.browse.entries.length > 1);

  const jumped = reduce(inLib, "G", VIEWPORT);

  assert.strictEqual(jumped.browse.index, inLib.browse.entries.length - 1);
});

test("g returns to the first entry", (t) => {
  const root = makeRepo(t);
  const atEnd = press(createState(root, "files", COLUMNS), ["l", "G"]);

  assert.strictEqual(reduce(atEnd, "g", VIEWPORT).browse.index, 0);
});

// --- the footer names everything the view binds -----------------------------

test("every view's footer names every key it binds", (t) => {
  const root = makeRepo(t);

  const diffPanel = createState(root, "review", COLUMNS);
  assertFooterIsComplete("diff/panel", diffPanel);
  assertFooterIsComplete("diff/body", reduce(diffPanel, "tab", VIEWPORT));
  assertFooterIsComplete("diff/panel (staged)", createState(root, "staged", COLUMNS));

  const browse = createState(root, "files", COLUMNS);
  assertFooterIsComplete("browse", browse);
  assertFooterIsComplete("read", press(browse, ["l", "l"]));
  assertFooterIsComplete("search", press(browse, ["/", "l", "i", "n", "e", "enter"]));
  assertFooterIsComplete("log", reduce(diffPanel, "L", VIEWPORT));
});

// --- the panel's movement keys move the panel -------------------------------

test("every movement key moves the cursor, and none of them the file list", (t) => {
  // The whole of what the focus used to decide. j/k, d/u and g/G are one set now and
  // they all do the same thing to the same place; n/p are the other set.
  const root = makeRepo(t);
  const state = createState(root, "review", COLUMNS);
  assert.ok(state.files.length > 1, "the panel needs somewhere it could have moved to");

  for (const key of ["j", "d", "G"]) {
    const moved = reduce(state, key, VIEWPORT);
    assert.strictEqual(moved.selectedIndex, state.selectedIndex, `${key} moved the file list`);
    assert.notStrictEqual(moved.cursor, state.cursor, `${key} did not move the cursor`);
  }
});

test("G and g reach the last and first row of the diff", (t) => {
  const root = makeRepo(t);
  const state = createState(root, "review", COLUMNS);

  const last = reduce(state, "G", VIEWPORT);
  assert.strictEqual(last.cursor, state.rows.length - 1);

  assert.strictEqual(reduce(last, "g", VIEWPORT).cursor, 0);
});

test("d pages through the diff wherever the reader is", (t) => {
  const root = makeRepo(t);
  const state = createState(root, "review", COLUMNS);

  const paged = reduce(state, "d", VIEWPORT);

  assert.strictEqual(paged.selectedIndex, state.selectedIndex);
  assert.ok(paged.cursor > state.cursor);
});

test("Tab does nothing in the diff view, because there is nowhere for it to go", (t) => {
  // It used to move the focus between the panel and the diff. Both are live now, so
  // there is no second place to put it and the footer no longer offers the key.
  const root = makeRepo(t);
  const state = createState(root, "review", COLUMNS);

  assert.strictEqual(reduce(state, "tab", VIEWPORT), state);
  assert.doesNotMatch(toScreenModel(state).help, /Tab/);
});

// --- keys a footer withholds stay unbound -----------------------------------

test("the modes whose footer withholds the staging keys do not bind them", (t) => {
  // Staging follows `git status`, which only matches the review mode's file list.
  // A key the footer does not offer must not quietly change the repository.
  const root = makeRepo(t);

  for (const mode of ["staged", "branch"]) {
    const state = createState(root, mode, COLUMNS);
    assert.doesNotMatch(toScreenModel(state).help, /stage|commit/, `${mode}: footer offers staging`);

    for (const key of [" ", "A", "C"]) {
      assert.strictEqual(
        reduce(state, key, VIEWPORT),
        state,
        `${mode}: ${JSON.stringify(key)} is bound but the footer withholds it`
      );
    }
  }
});

test("reload stays available in every mode", (t) => {
  const root = makeRepo(t);

  for (const mode of ["review", "staged", "branch"]) {
    const state = createState(root, mode, COLUMNS);
    assert.match(toScreenModel(state).help, /reload/, `${mode}: footer omits reload`);
    assert.notStrictEqual(reduce(state, "r", VIEWPORT), state, `${mode}: r does nothing`);
  }
});
