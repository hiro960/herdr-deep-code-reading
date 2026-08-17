"use strict";

// Moving between the views, and the keys that have to work from all of them.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const { createState, reduce } = require("../lib/app-state");

const VIEWPORT = 20;
const COLUMNS = 179;
const GIT_IDENTITY = ["-c", "user.email=test@example.com", "-c", "user.name=herdr-deep-code-reading test"];

function run(cwd, args) {
  execFileSync("git", args, { cwd, stdio: "ignore" });
}

function makeRepo(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "herdr-deep-code-reading-nav-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  run(root, ["init", "-q"]);
  fs.mkdirSync(path.join(root, "lib"), { recursive: true });
  fs.writeFileSync(path.join(root, "lib", "a.js"), "one\ntwo\n");
  // Left untouched, so its lines are both searchable and the same on disk as in HEAD
  fs.writeFileSync(
    path.join(root, "lib", "b.js"),
    Array.from({ length: 30 }, (_, line) => `const needle${line} = ${line};`).join("\n") + "\n"
  );
  run(root, ["add", "-A"]);
  run(root, [...GIT_IDENTITY, "commit", "-qm", "init"]);

  fs.writeFileSync(path.join(root, "lib", "a.js"), "one\nchanged\n");

  return root;
}

function press(state, keys) {
  return keys.reduce((current, key) => reduce(current, key, VIEWPORT), state);
}

// --- leaving a directory ----------------------------------------------------

test("Escape steps out of a directory, like h", (t) => {
  // The README offers h and Esc as the same command; only h was bound.
  const root = makeRepo(t);
  const inLib = press(createState(root, "files", COLUMNS), ["l"]);
  assert.strictEqual(inLib.browse.dir, "lib");

  assert.strictEqual(reduce(inLib, "escape", VIEWPORT).browse.dir, "");
});

test("Escape at the repository root stays there", (t) => {
  const root = makeRepo(t);
  const atRoot = createState(root, "files", COLUMNS);

  assert.strictEqual(reduce(atRoot, "escape", VIEWPORT).browse.dir, "");
});

// --- opening a search hit ---------------------------------------------------

test("opens a search hit on the file's contents, whatever the toggle was", (t) => {
  // Regression: a hit's line number counts lines of the file. Opening into the
  // diff view landed that number in a list of diff rows, on an unrelated line.
  const root = makeRepo(t);
  const searched = press(createState(root, "files", COLUMNS), [
    "tab", // flip the reader to the diff side
    "/", "n", "e", "e", "d", "l", "e", "1", "0", "enter",
  ]);
  assert.strictEqual(searched.view, "search");
  const hit = searched.rows.find((row) => row.kind === "hit");
  assert.notStrictEqual(hit, undefined);

  const opened = reduce(searched, "enter", VIEWPORT);

  assert.strictEqual(opened.view, "read");
  assert.strictEqual(opened.openPath, hit.hit.path);
  assert.strictEqual(opened.rows[opened.cursor].cell.num, hit.hit.line);
  assert.match(opened.rows[opened.cursor].cell.text, /needle10/);
});

// --- going back -------------------------------------------------------------

/** Search for a word that only the untouched file carries, and open the first hit. */
function openFirstHit(root) {
  const searched = press(createState(root, "files", COLUMNS), [
    "/", "n", "e", "e", "d", "l", "e", "1", "0", "enter",
  ]);
  assert.strictEqual(searched.view, "search");
  return { searched, opened: reduce(searched, "enter", VIEWPORT) };
}

test("leaving an opened hit gives the result list back", (t) => {
  // Regression: the reader always dropped into the file browser, so following a
  // hit threw away the list that produced it and the query had to be retyped.
  const root = makeRepo(t);
  const { searched, opened } = openFirstHit(root);
  assert.strictEqual(opened.view, "read");

  const back = reduce(opened, "h", VIEWPORT);

  assert.strictEqual(back.view, "search");
  assert.strictEqual(back.searchQuery, searched.searchQuery);
  assert.deepStrictEqual(back.hits, searched.hits);
  assert.strictEqual(back.cursor, searched.cursor);
});

test("Ctrl+O goes back the same way", (t) => {
  const root = makeRepo(t);
  const { opened } = openFirstHit(root);

  assert.strictEqual(reduce(opened, "ctrl-o", VIEWPORT).view, "search");
});

test("leaving a file opened from the browser gives that directory back", (t) => {
  const root = makeRepo(t);
  const inLib = press(createState(root, "files", COLUMNS), ["l", "j"]);
  const chosen = inLib.browse.index;

  const opened = reduce(inLib, "l", VIEWPORT);
  assert.strictEqual(opened.view, "read");
  const back = reduce(opened, "h", VIEWPORT);

  assert.strictEqual(back.view, "browse");
  assert.strictEqual(back.browse.dir, "lib");
  assert.strictEqual(back.browse.index, chosen, "the selection moved while away");
});

test("going back from the browser with nothing to undo stays in the browser", (t) => {
  const root = makeRepo(t);
  const atRoot = createState(root, "files", COLUMNS);

  assert.strictEqual(reduce(atRoot, "ctrl-o", VIEWPORT).view, "browse");
});

// --- quitting ---------------------------------------------------------------

test("Ctrl+C quits while a comment is being written", (t) => {
  // Raw mode means no SIGINT arrives, so the key has to be handled before the
  // open text field swallows it.
  const root = makeRepo(t);
  const writing = press(createState(root, "review", COLUMNS), ["tab", "c", "h", "i"]);
  assert.notStrictEqual(writing.input, null);

  assert.strictEqual(reduce(writing, "ctrl-c", VIEWPORT).quit, true);
});

test("Ctrl+C quits while the agent picker is open", (t) => {
  const root = makeRepo(t);
  const state = createState(root, "review", COLUMNS);
  const picking = { ...state, picker: { count: 1, agents: [{ pane_id: "w1:p3" }] } };

  assert.strictEqual(reduce(picking, "ctrl-c", VIEWPORT).quit, true);
});

test("Q still types into a comment rather than quitting", (t) => {
  const root = makeRepo(t);
  const writing = press(createState(root, "review", COLUMNS), ["tab", "c", "Q"]);

  assert.strictEqual(writing.quit, false);
  assert.strictEqual(writing.input.text, "Q");
});

test("q does nothing at all", (t) => {
  // It was the quit key, and it is the easiest key on the board to press by accident:
  // one tap, no question asked, and a pane of reading gone. Shifted, it takes a
  // deliberate hand. The old key is left doing nothing rather than given a new job,
  // because a key that quit yesterday must not do something else today.
  const root = makeRepo(t);
  const state = createState(root, "review", COLUMNS);

  const pressed = reduce(state, "q", VIEWPORT);

  assert.strictEqual(pressed.quit, false);
  assert.strictEqual(pressed.message, state.message === undefined ? undefined : state.message);
});

test("q does nothing in the reader or the browser either", (t) => {
  const root = makeRepo(t);
  const browsing = createState(root, "files", COLUMNS);
  const reading = press(browsing, ["l"]);

  assert.strictEqual(reduce(browsing, "q", VIEWPORT).quit, false);
  assert.strictEqual(reduce(reading, "q", VIEWPORT).quit, false);
});

test("q does not cancel the agent picker", (t) => {
  // Esc is what the picker's footer offers, and it is the whole of what it offers
  const root = makeRepo(t);
  const state = createState(root, "review", COLUMNS);
  const picking = { ...state, picker: { count: 1, agents: [{ pane_id: "w1:p3" }] } };

  assert.notStrictEqual(reduce(picking, "q", VIEWPORT).picker, null);
  assert.strictEqual(reduce(picking, "escape", VIEWPORT).picker, null);
});

/** A state carrying one saved comment. */
function withOneComment(root) {
  const state = press(createState(root, "review", COLUMNS), ["tab", "c", "h", "i", "enter"]);
  assert.strictEqual(state.comments.length, 1);
  return state;
}

test("Q asks before discarding unsent comments", (t) => {
  // Comments live for the session, so this is the only chance to keep them
  const root = makeRepo(t);
  const asked = reduce(withOneComment(root), "Q", VIEWPORT);

  assert.strictEqual(asked.quit, false);
  assert.match(asked.message, /unsent/i);
  assert.match(asked.message, /1 comment/);
});

test("Q again discards them", (t) => {
  const root = makeRepo(t);
  const asked = reduce(withOneComment(root), "Q", VIEWPORT);

  assert.strictEqual(reduce(asked, "Q", VIEWPORT).quit, true);
});

test("Ctrl+C asks the same question", (t) => {
  const root = makeRepo(t);
  const asked = reduce(withOneComment(root), "ctrl-c", VIEWPORT);

  assert.strictEqual(asked.quit, false);
  assert.strictEqual(reduce(asked, "ctrl-c", VIEWPORT).quit, true);
});

test("any other key takes the question back", (t) => {
  const root = makeRepo(t);
  const asked = reduce(withOneComment(root), "Q", VIEWPORT);

  const moved = reduce(asked, "j", VIEWPORT);
  assert.strictEqual(moved.pendingQuit, false);
  assert.strictEqual(reduce(moved, "Q", VIEWPORT).quit, false, "Q quit without asking again");
});

test("quits at once when there is nothing to lose", (t) => {
  const root = makeRepo(t);

  assert.strictEqual(reduce(createState(root, "review", COLUMNS), "Q", VIEWPORT).quit, true);
});

// --- searching with a pattern -----------------------------------------------

/** Type a query into the search field the browser opens with `/`. */
function typeSearch(root, query) {
  return press(createState(root, "files", COLUMNS), ["/", ...query]);
}

test("the search field starts literal", (t) => {
  const root = makeRepo(t);

  assert.strictEqual(typeSearch(root, "needle").input.regex, false);
});

test("Ctrl+R turns the open search field into a pattern", (t) => {
  const root = makeRepo(t);
  const typing = typeSearch(root, "needle");

  const asPattern = reduce(typing, "ctrl-r", VIEWPORT);

  assert.strictEqual(asPattern.input.regex, true);
  assert.strictEqual(asPattern.input.text, "needle", "toggling must not disturb the query");
});

test("Ctrl+R again puts it back", (t) => {
  const root = makeRepo(t);
  const twice = press(typeSearch(root, "needle"), ["ctrl-r", "ctrl-r"]);

  assert.strictEqual(twice.input.regex, false);
});

test("a pattern search reads the query as a pattern", (t) => {
  // The fixture declares needle0 through needle29, so a character class picks out
  // a run of them that no literal search could
  const root = makeRepo(t);
  const searched = press(typeSearch(root, "needle1[0-9] ="), ["ctrl-r", "enter"]);

  assert.strictEqual(searched.view, "search");
  assert.strictEqual(searched.hits.length, 10);
  assert.ok(searched.hits.every((hit) => /needle1[0-9] =/.test(hit.text)));
});

test("the same query literally finds nothing", (t) => {
  const root = makeRepo(t);
  const searched = press(typeSearch(root, "needle1[0-9] ="), ["enter"]);

  assert.deepStrictEqual(searched.hits, []);
});

test("the choice outlives the search that made it", (t) => {
  // A reader who has switched to patterns is usually not done after one search
  const root = makeRepo(t);
  const searched = press(typeSearch(root, "needle1"), ["ctrl-r", "enter"]);

  assert.strictEqual(searched.searchRegex, true);
  assert.strictEqual(reduce(searched, "/", VIEWPORT).input.regex, true);
});

test("a malformed pattern says so and leaves the reader where they were", (t) => {
  const root = makeRepo(t);
  const typing = typeSearch(root, "needle[");

  const searched = press(typing, ["ctrl-r", "enter"]);

  assert.strictEqual(searched.view, "browse", "a failed search must not open an empty list");
  assert.match(searched.message, /Search failed/);
});

test("Ctrl+R is inert in the fields a pattern means nothing to", (t) => {
  const root = makeRepo(t);
  const filtering = press(createState(root, "files", COLUMNS), ["f", "a"]);

  assert.strictEqual(reduce(filtering, "ctrl-r", VIEWPORT), filtering);
});
