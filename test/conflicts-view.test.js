"use strict";

// The screen a stopped merge puts the reader on, and the keys that get them off it.
//
// Everything here starts where a reader would: a pull that conflicted. The repository
// is a clone of a directory on disk, so the whole path — the pull, the conflict, the
// list, the resolution and the commit — is the one that runs in a real pane.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const { createState, reduce, reloadedInPlace, toScreenModel } = require("../lib/app-state");
const { performEffect } = require("../lib/run/effects");
const {
  CONFLICT_MIDDLE,
  CONFLICT_OURS,
  CONFLICT_START,
  CONFLICT_THEIRS,
} = require("../lib/conflict");
const { isMerging } = require("../lib/merge");
const { MESSAGE_NO_CONFLICT, conflictTitle } = require("../lib/state/views/conflicts");
const { VIEW_CONFLICTS, VIEW_READ } = require("../lib/view-names");

const COLUMNS = 200;
const VIEWPORT = 40;
const GIT_IDENTITY = ["-c", "user.email=test@example.com", "-c", "user.name=herdr-deep-code-reading test"];

/**
 * Run git, and give a repository it has just made an identity of its own.
 *
 * The plugin runs `git pull`, `git merge` and `git commit` as child processes of its
 * own, with whatever config the repository and the machine carry. A developer's machine
 * has a global identity and a clean CI runner has none, so a fixture that leans on one
 * passes here and fails there — with git's own `unable to auto-detect email address`,
 * which the pane reports faithfully and which has nothing to do with what is being
 * tested. The repository under test carries its own, the way a reader's does.
 */
function run(cwd, args) {
  execFileSync("git", args, { cwd, stdio: "ignore" });

  const made = args[0] === "init" ? cwd : args[0] === "clone" ? args[args.length - 1] : null;
  if (made === null || args.includes("--bare")) {
    return; // Not a repository with a working tree, so nothing will be committed in it
  }
  for (const [key, value] of [["user.email", "test@example.com"], ["user.name", "herdr-deep-code-reading test"]]) {
    execFileSync("git", ["config", key, value], { cwd: made, stdio: "ignore" });
  }
}

/**
 * A clone whose next pull cannot help conflicting.
 *
 * The same line of a.txt written differently at each end, and b.txt edited here while
 * the other end deleted it — two kinds of conflict, because they are settled by two
 * different git commands.
 */
function makeConflictingClone(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "herdr-deep-code-reading-conflicts-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const origin = path.join(root, "origin");
  fs.mkdirSync(origin);
  run(origin, ["init", "-q", "-b", "main"]);
  fs.writeFileSync(path.join(origin, "a.txt"), "one\ntwo\nthree\n");
  fs.writeFileSync(path.join(origin, "b.txt"), "keep\n");
  run(origin, ["add", "-A"]);
  run(origin, [...GIT_IDENTITY, "commit", "-qm", "base"]);

  const work = path.join(root, "work");
  run(root, ["clone", "-q", origin, work]);

  fs.writeFileSync(path.join(origin, "a.txt"), "one\ntheirs\nthree\n");
  run(origin, ["rm", "-q", path.join(origin, "b.txt")]);
  run(origin, [...GIT_IDENTITY, "commit", "-qam", "theirs"]);

  fs.writeFileSync(path.join(work, "a.txt"), "one\nours\nthree\n");
  fs.appendFileSync(path.join(work, "b.txt"), "mine\n");
  run(work, [...GIT_IDENTITY, "commit", "-qam", "ours"]);

  return { origin, work };
}

/** Press a key and carry out whatever it asked the world for, as the loop does. */
function press(state, key) {
  return performEffect(reduce(state, key, VIEWPORT), null);
}

function pressAll(state, keys) {
  return keys.reduce((current, key) => press(current, key), state);
}

/** A pane opened on the log, pulled, and left in front of what would not merge. */
function stopped(t) {
  const { work } = makeConflictingClone(t);
  const state = pressAll(reduce(createState(work, "review", COLUMNS), "L", VIEWPORT), ["p", "p"]);

  assert.strictEqual(state.view, VIEW_CONFLICTS, "the pull did not stop at the conflicts");
  return { work, state };
}

/** What the list is showing: each file and what is wrong with it. */
function listed(state) {
  return state.rows.map((row) => `${row.hit.label} ${row.hit.text}`);
}

function contentsOf(work, name) {
  return fs.readFileSync(path.join(work, name), "utf8");
}

// --- where a conflicted pull leaves the reader ------------------------------------------

test("a pull that cannot merge everything lands in the list of what it could not", (t) => {
  // Arrange & Act
  const { work, state } = stopped(t);

  // Assert
  assert.strictEqual(state.message, "Pulled — 2 files to resolve");
  assert.deepStrictEqual(listed(state), ["a.txt both modified", "b.txt deleted by them"]);
  assert.strictEqual(isMerging(work), true);
});

test("every screen says a merge is stopped, and how much of it is left", (t) => {
  // Arrange
  const { state } = stopped(t);

  // Act
  const heading = toScreenModel(state).title;

  // Assert
  assert.match(heading, /merging — 2 left/);
  assert.match(heading, /conflicts {2}\(0\/2 resolved\)/);
});

test("the way into the list is offered from every other screen while there is one", (t) => {
  // Arrange
  const { state } = stopped(t);
  const elsewhere = press(state, "L");
  assert.strictEqual(elsewhere.view, "log");

  // Act
  const back = press(elsewhere, "M");

  // Assert
  assert.match(toScreenModel(elsewhere).help, /M merge/);
  assert.strictEqual(back.view, VIEW_CONFLICTS);
  // And the list itself does not offer a key that opens the list
  assert.doesNotMatch(toScreenModel(back).help, /M merge/);
});

test("a repository with no merge in it says so rather than opening an empty list", (t) => {
  // Arrange
  const { work } = makeConflictingClone(t);
  const state = createState(work, "review", COLUMNS);

  // Act
  const asked = reduce(state, "M", VIEWPORT);

  // Assert
  assert.strictEqual(asked.message, "No merge in progress");
  assert.strictEqual(asked.view, state.view);
  assert.doesNotMatch(toScreenModel(state).title, /merging/);
});

// --- reading the file itself --------------------------------------------------------------

test("opening a conflicted file lands on the conflict, with the two sides told apart", (t) => {
  // Arrange
  const { state } = stopped(t);

  // Act
  const opened = press(state, "enter");

  // Assert
  assert.strictEqual(opened.view, VIEW_READ);
  assert.strictEqual(opened.openPath, "a.txt");
  assert.deepStrictEqual(
    opened.rows.map((row) => row.cell.conflict),
    [undefined, CONFLICT_START, CONFLICT_OURS, CONFLICT_MIDDLE, CONFLICT_THEIRS, "end", undefined]
  );
  // The cursor opens on the conflict rather than at the top of the file
  assert.strictEqual(opened.rows[opened.cursor].cell.conflict, CONFLICT_START);
});

test("the reading view offers the stepping keys only for a file that has conflicts", (t) => {
  // Arrange
  const { state } = stopped(t);
  const opened = press(state, "enter");

  // Act & Assert
  assert.match(toScreenModel(opened).help, /\] \[ conflict/);

  // A file of the same repository that merged cleanly says nothing about stepping
  const settled = pressAll(opened, ["escape", "j", "enter"]);
  assert.strictEqual(settled.openPath, "b.txt");
  assert.doesNotMatch(toScreenModel(settled).help, /\] \[ conflict/);
});

test("the stepping keys go from one conflict to the next, and say when there is none", (t) => {
  // Arrange: a file with two conflicts in it, opened
  const { work, state } = stopped(t);
  fs.writeFileSync(
    path.join(work, "a.txt"),
    [
      "<<<<<<< HEAD",
      "ours",
      "=======",
      "theirs",
      ">>>>>>> origin/main",
      "middle",
      "<<<<<<< HEAD",
      "ours again",
      "=======",
      "theirs again",
      ">>>>>>> origin/main",
    ].join("\n") + "\n"
  );
  const opened = press(press(state, "r"), "enter");
  assert.strictEqual(opened.cursor, 0, "the first conflict opens the file");

  // Act
  const second = press(opened, "]");
  const first = press(second, "[");

  // Assert
  assert.strictEqual(second.cursor, 6);
  assert.strictEqual(first.cursor, 0);
  assert.match(press(second, "]").message, /No conflict below/);
  assert.match(press(first, "[").message, /No conflict above/);
});

// --- settling it -----------------------------------------------------------------------

test("taking our side keeps our version and marks the row done", (t) => {
  // Arrange
  const { work, state } = stopped(t);

  // Act
  const took = press(state, "o");

  // Assert
  assert.strictEqual(took.message, "Took ours: a.txt");
  assert.strictEqual(contentsOf(work, "a.txt"), "one\nours\nthree\n");
  assert.deepStrictEqual(listed(took), ["a.txt ✓ both modified", "b.txt deleted by them"]);
  assert.match(toScreenModel(took).title, /1\/2 resolved/);
});

test("taking their side of a file they deleted deletes it", (t) => {
  // Arrange: the cursor on b.txt, which was edited here and deleted there
  const { work, state } = stopped(t);
  const onSecond = reduce(state, "j", VIEWPORT);

  // Act
  const took = press(onSecond, "t");

  // Assert
  assert.strictEqual(took.message, "Took theirs: b.txt");
  assert.strictEqual(fs.existsSync(path.join(work, "b.txt")), false);
  assert.deepStrictEqual(listed(took), ["a.txt both modified", "b.txt ✓ deleted by them"]);
});

test("a row already settled is left alone rather than settled twice", (t) => {
  // Arrange
  const { state } = stopped(t);
  const took = press(state, "o");

  // Act
  const again = reduce(took, "t", VIEWPORT);

  // Assert
  assert.strictEqual(again.message, "a.txt is already resolved");
  assert.strictEqual(again.effect, null);
});

test("a file edited by hand is settled by saying so", (t) => {
  // Arrange: the reader's own resolution, as their editor would leave it
  const { work, state } = stopped(t);
  fs.writeFileSync(path.join(work, "a.txt"), "one\nboth\nthree\n");

  // Act
  const resolved = press(state, " ");

  // Assert
  assert.strictEqual(resolved.message, "Resolved: a.txt");
  assert.deepStrictEqual(listed(resolved), ["a.txt ✓ both modified", "b.txt deleted by them"]);
});

test("a file settled with the markers still in it is settled, and said so", (t) => {
  // Arrange: nothing has been edited, so both sides are still in the file
  const { state } = stopped(t);

  // Act
  const resolved = press(state, " ");

  // Assert
  assert.match(resolved.message, /still has conflict markers/);
  assert.deepStrictEqual(listed(resolved), ["a.txt ✓ both modified", "b.txt deleted by them"]);
});

test("E hands the conflicted file to the reader's own editor, at the conflict", (t) => {
  // Arrange
  const { state } = stopped(t);

  // Act
  const asked = reduce(state, "E", VIEWPORT);

  // Assert
  assert.deepStrictEqual(asked.effect, { type: "edit", path: "a.txt", line: 2 });
});

// --- finishing ---------------------------------------------------------------------------

test("the merge is committed once everything is settled, and the list is over", (t) => {
  // Arrange
  const { work, state } = stopped(t);
  const settled = pressAll(state, ["o", "j", "o"]);
  assert.match(toScreenModel(settled).title, /2 resolved — C commits/);

  // Act
  const committed = press(settled, "C");

  // Assert
  assert.match(committed.message, /^Merged: /);
  assert.strictEqual(isMerging(work), false);
  assert.notStrictEqual(committed.view, VIEW_CONFLICTS, "left standing on a finished job");

  // And the screen it left them on is a whole screen rather than the list's leftovers:
  // the header names what is showing now, and the rows belong to it
  const heading = toScreenModel(committed).title;
  assert.doesNotMatch(heading, /merging/);
  assert.doesNotMatch(heading, /conflicts {2}\(/);
  assert.ok(
    committed.rows.every((row) => row.hit === undefined),
    "the conflict list's own rows were left on screen"
  );
  // The way in is gone with the merge, from the footer and from the key both
  assert.doesNotMatch(toScreenModel(committed).help, /M merge/);
  assert.strictEqual(reduce(committed, "M", VIEWPORT).message, "No merge in progress");
});

test("a merge with something left unsettled is not committed", (t) => {
  // Arrange
  const { work, state } = stopped(t);

  // Act
  const refused = reduce(state, "C", VIEWPORT);

  // Assert
  assert.strictEqual(refused.message, "2 files are still unresolved");
  assert.strictEqual(refused.effect, null);
  assert.strictEqual(isMerging(work), true);
});

test("a file settled with the markers still in it asks once before it is committed", (t) => {
  // Arrange: both files marked resolved, one of them still holding both sides
  const { work, state } = stopped(t);
  const settled = pressAll(state, [" ", "j", "o"]);

  // Act
  const asked = reduce(settled, "C", VIEWPORT);

  // Assert
  assert.match(asked.message, /a\.txt still has conflict markers — press C again/);
  assert.strictEqual(asked.effect, null);
  assert.strictEqual(isMerging(work), true);

  // Act: the reader means it
  const committed = press(asked, "C");

  // Assert
  assert.match(committed.message, /^Merged: /);
  assert.strictEqual(isMerging(work), false);
});

test("any other key takes the marker question back off", (t) => {
  // Arrange
  const { state } = stopped(t);
  const asked = reduce(pressAll(state, [" ", "j", "o"]), "C", VIEWPORT);
  assert.strictEqual(asked.pendingCommit, true);

  // Act
  const moved = reduce(asked, "k", VIEWPORT);

  // Assert
  assert.strictEqual(moved.pendingCommit, false);
  assert.match(reduce(moved, "C", VIEWPORT).message, /press C again/);
});

test("undoing the merge asks first, and puts back what was there", (t) => {
  // Arrange
  const { work, state } = stopped(t);
  const took = press(state, "t");
  assert.strictEqual(contentsOf(work, "a.txt"), "one\ntheirs\nthree\n");

  // Act
  const asked = reduce(took, "!", VIEWPORT);

  // Assert
  assert.match(asked.message, /Undo the merge and everything resolved in 2 files/);
  assert.strictEqual(asked.effect, null);
  assert.strictEqual(isMerging(work), true);

  // Act: the second press
  const undone = press(asked, "!");

  // Assert
  assert.strictEqual(undone.message, "The merge is undone");
  assert.strictEqual(isMerging(work), false);
  assert.strictEqual(contentsOf(work, "a.txt"), "one\nours\nthree\n");
  assert.notStrictEqual(undone.view, VIEW_CONFLICTS);
});

test("any other key takes the undo question back off", (t) => {
  // Arrange
  const { work, state } = stopped(t);
  const asked = reduce(state, "!", VIEWPORT);

  // Act
  const moved = reduce(asked, "j", VIEWPORT);
  const pressedAgain = press(moved, "!");

  // Assert
  assert.strictEqual(moved.pendingAbort, false);
  assert.match(pressedAgain.message, /press ! again/);
  assert.strictEqual(isMerging(work), true);
});

// --- while it is open --------------------------------------------------------------------

test("a reload under the reader keeps the list and what is left of it", (t) => {
  // Arrange: one file settled, and then the repository moves under the pane
  const { state } = stopped(t);
  const settled = press(state, "o");

  // Act: what the watch does
  const reloaded = reloadedInPlace(settled, "Reloaded — the repository changed", VIEWPORT);

  // Assert
  assert.strictEqual(reloaded.view, VIEW_CONFLICTS);
  assert.deepStrictEqual(listed(reloaded), ["a.txt ✓ both modified", "b.txt deleted by them"]);
  assert.strictEqual(reloaded.message, "Reloaded — the repository changed");
});

test("a merge finished in another pane takes the list with it", (t) => {
  // Arrange
  const { work, state } = stopped(t);
  run(work, ["checkout", "--ours", "--", "a.txt"]);
  run(work, ["add", "-A"]);
  run(work, [...GIT_IDENTITY, "commit", "-qm", "merged elsewhere"]);

  // Act
  const reloaded = reloadedInPlace(state, "Reloaded — the repository changed", VIEWPORT);

  // Assert
  assert.notStrictEqual(reloaded.view, VIEW_CONFLICTS);
  assert.strictEqual(reloaded.merge.merging, false);
});

test("the working tree's own diff still reads while a merge is stopped", (t) => {
  // Arrange: the review mode diffs against HEAD, which mid-merge holds both sides of
  // an unsettled file between markers — the first screen a watch tick would draw after
  // a conflicted pull, and a diff nobody had taught the parser to expect
  const { work } = stopped(t);
  // Narrow enough for one column, so a row is a line rather than a pair of them
  const state = createState(work, "review", 100);

  // Act: the file both sides changed, whatever order the panel put it in
  const at = state.files.findIndex((file) => (file.newPath || file.oldPath) === "a.txt");
  const shown = reduce(state, at > state.selectedIndex ? "n" : "p", VIEWPORT);
  const text = shown.rows.map((row) => (row.cell === undefined ? "" : row.cell.text));

  // Assert
  assert.ok(at !== -1, "the conflicted file is not in the diff at all");
  assert.strictEqual(shown.selectedIndex, at);
  assert.ok(
    text.some((line) => line.startsWith("<<<<<<<")),
    "the conflict markers are not in the diff"
  );
  // And git's letters for it are what the panel shows beside the name
  assert.strictEqual(state.files[at].gitStatus, "UU");
});

// --- the whole way round ------------------------------------------------------------------

/**
 * A clone that has diverged from a remote it can also push to.
 *
 * Bare at the far end, because a repository with a working tree refuses to have the
 * branch it has checked out written to — and the other end of this one is written to
 * twice: once by somebody else, and once by the reader at the end of it.
 */
function makePushableConflict(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "herdr-deep-code-reading-arc-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const origin = path.join(root, "origin.git");
  run(root, ["init", "-q", "--bare", "-b", "main", origin]);

  const work = path.join(root, "work");
  run(root, ["clone", "-q", origin, work]);
  fs.writeFileSync(path.join(work, "a.txt"), "one\ntwo\nthree\n");
  run(work, ["add", "-A"]);
  run(work, [...GIT_IDENTITY, "commit", "-qm", "base"]);
  run(work, ["push", "-q", "--set-upstream", "origin", "main"]);

  // Somebody else's afternoon, already on the remote
  const other = path.join(root, "other");
  run(root, ["clone", "-q", origin, other]);
  fs.writeFileSync(path.join(other, "a.txt"), "one\ntheirs\nthree\n");
  run(other, [...GIT_IDENTITY, "commit", "-qam", "theirs"]);
  run(other, ["push", "-q", "origin", "main"]);

  // And the reader's, which touches the same line
  fs.writeFileSync(path.join(work, "a.txt"), "one\nours\nthree\n");
  run(work, [...GIT_IDENTITY, "commit", "-qam", "ours"]);

  return { origin, work };
}

/** The subjects the remote is holding. */
function subjectsOn(origin) {
  return execFileSync("git", ["--git-dir", origin, "log", "--format=%s", "--all"], {
    encoding: "utf8",
  })
    .split("\n")
    .filter((line) => line !== "");
}

test("pull, settle, commit, push — the way round the whole thing", (t) => {
  // Arrange: a branch with work at both ends, and a remote that will take it back
  const { origin, work } = makePushableConflict(t);
  const state = reduce(createState(work, "review", COLUMNS), "L", VIEWPORT);

  // Act: pull it, and land in what would not merge
  const halfway = pressAll(state, ["p", "p"]);
  assert.strictEqual(halfway.view, VIEW_CONFLICTS);

  // Act: settle it, finish the merge, and send it out
  const merged = pressAll(halfway, ["o", "C"]);
  assert.notStrictEqual(merged.view, VIEW_CONFLICTS, "the merge is not finished");
  const pushed = pressAll(merged, ["P", "P"]);

  // Assert: the remote has the merge, and this branch has nothing left of its own
  assert.match(pushed.message, /^Pushed/);
  assert.ok(
    subjectsOn(origin).some((subject) => subject.startsWith("Merge branch")),
    "the merge never left"
  );
  assert.strictEqual(isMerging(work), false);
  assert.strictEqual(fs.readFileSync(path.join(work, "a.txt"), "utf8"), "one\nours\nthree\n");
});

// --- a row that is not a conflict ----------------------------------------------------------

test("a key pressed where there is no conflicted file says so rather than acting", (t) => {
  // Arrange: the list, with the cursor past the end of it — which is what a row that
  // is not a conflict looks like to the keys that settle one
  const { state } = stopped(t);
  const nowhere = { ...state, hits: [], rows: [], cursor: 0 };

  // Act & Assert
  for (const key of ["o", "t", " ", "E"]) {
    const pressed = reduce(nowhere, key, VIEWPORT);
    assert.strictEqual(pressed.message, MESSAGE_NO_CONFLICT, `${key} did something else`);
    assert.strictEqual(pressed.effect, null);
  }
});

test("a list with nothing left in it says so in its header", () => {
  assert.strictEqual(conflictTitle({ merging: true, conflicts: [] }), "conflicts  (none)");
});

// --- the footer --------------------------------------------------------------------------

const ADVERTISED = {
  "j/k": ["j", "k"],
  "d/u": ["d", "u"],
  "g/G": ["g", "G"],
  "l/Enter": ["l", "enter"],
  "h/Esc/Ctrl+O": ["h", "escape", "ctrl-o"],
  space: [" "],
  o: ["o"],
  t: ["t"],
  E: ["E"],
  C: ["C"],
  "!": ["!"],
  r: ["r"],
  L: ["L"],
  D: ["D"],
  P: ["P"],
  "'": ["'"],
  '"': ['"'],
  "#": ["#"],
  O: ["O"],
  W: ["W"],
  "@": ["@"],
  "|": ["|"],
  "?": ["?"],
  K: ["K"],
  "&": ["&"],
  J: ["J"],
  X: ["X"],
};

// q always quits, which reduce reports through a flag rather than a new state
const ALWAYS_BOUND = new Set(["Q"]);
const SYNONYMS = new Set(["up", "down", "left", "right", "pageup", "pagedown", "home", "end", "ctrl-d", "ctrl-u", "ctrl-c", "ctrl-o"]);

function namesToken(help, token) {
  const escaped = token.replace(/[/+?|]/g, (char) => "\\" + char);
  return new RegExp(`(^|\\s)${escaped}(\\s|$)`).test(help);
}

function advertisedKeys(help) {
  return Object.entries(ADVERTISED)
    .filter(([token]) => namesToken(help, token))
    .flatMap(([, keys]) => keys);
}

test("the conflict list's footer only names keys that work", (t) => {
  // Arrange
  const { state } = stopped(t);
  const keys = advertisedKeys(toScreenModel(state).help);
  assert.ok(keys.length > 0, "the footer advertised no keys at all");

  // Act & Assert: a key at the end of its range is legitimately inert, so each is
  // tried from a few places rather than only from the first row
  const positions = [state, reduce(state, "j", VIEWPORT), reduce(state, "G", VIEWPORT)];

  for (const key of keys) {
    if (ALWAYS_BOUND.has(key)) {
      continue;
    }
    assert.ok(
      positions.some((from) => reduce(from, key, VIEWPORT) !== from),
      `the footer offers ${JSON.stringify(key)} but nothing is bound to it`
    );
  }
});

test("the conflict list's footer names every key it binds", (t) => {
  // Arrange
  const { state } = stopped(t);
  const advertised = new Set(advertisedKeys(toScreenModel(state).help));
  const letters = "abcdefghijklmnopqrstuvwxyz";
  const candidates = [
    ...letters,
    ...letters.toUpperCase(),
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
    "!",
    "tab",
    "enter",
    "escape",
    "ctrl-o",
  ];

  // Act & Assert: a key that only says where it does work has not done anything
  for (const key of candidates) {
    if (advertised.has(key) || ALWAYS_BOUND.has(key) || SYNONYMS.has(key)) {
      continue;
    }
    const next = reduce(state, key, VIEWPORT);
    const changed = Object.keys({ ...state, ...next }).some(
      (field) =>
        field !== "message" &&
        !field.startsWith("pending") &&
        next[field] !== state[field]
    );
    assert.ok(!changed, `${JSON.stringify(key)} does something but the footer never names it`);
  }
});
