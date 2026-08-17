"use strict";

// Narrowing the graph to what is being read.
//
// The log opened on the question "what shape is this repository in", and every commit
// is the right answer to that. Following somebody else's work asks a narrower one:
// what landed, in the order it landed. The trunk is that list.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const { createState, reduce, toScreenModel } = require("../lib/app-state");
const { graphLogArgs } = require("../lib/graph");
const {
  chooseInLog,
  cycleLogFocus,
  moveLog,
  openLog,
  reloadLog,
  toggleLogScope,
} = require("../lib/state/log");

const COLUMNS = 200;
const VIEWPORT = 40;
const GIT_IDENTITY = ["-c", "user.email=test@example.com", "-c", "user.name=herdr-deep-code-reading test"];
// Somebody else, so that "whose work is this" has two answers to choose between
const OTHER_IDENTITY = ["-c", "user.email=ada@example.com", "-c", "user.name=Ada Lovelace"];

function run(cwd, args) {
  execFileSync("git", args, { cwd, stdio: "ignore" });
}

/** A repository whose main branch has a merge in it, so the trunk is shorter than the log. */
function makeRepo(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "herdr-deep-code-reading-filters-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  run(root, ["init", "-q", "-b", "main"]);
  fs.writeFileSync(path.join(root, "a.txt"), "one\n");
  run(root, ["add", "-A"]);
  run(root, [...GIT_IDENTITY, "commit", "-qm", "root"]);

  run(root, ["checkout", "-q", "-b", "side"]);
  fs.writeFileSync(path.join(root, "b.txt"), "two\n");
  run(root, ["add", "-A"]);
  run(root, [...OTHER_IDENTITY, "commit", "-qm", "on the side"]);

  run(root, ["checkout", "-q", "main"]);
  fs.writeFileSync(path.join(root, "a.txt"), "one\ntwo\n");
  run(root, ["add", "-A"]);
  run(root, [...GIT_IDENTITY, "commit", "-qm", "on main"]);
  run(root, [...GIT_IDENTITY, "merge", "-q", "--no-ff", "side", "-m", "merge side"]);

  return root;
}

/** Every commit the graph is showing. */
function subjects(state) {
  return state.log.rows.filter((row) => row.commit !== null).map((row) => row.commit.subject);
}

/**
 * The log, narrowed to the branch HEAD is on.
 *
 * Which is where the trunk means anything: `--all` follows the first parent of every
 * ref, so a branch tip goes on being drawn from its own end. One branch at a time is
 * the reading this is for.
 */
function onMain(t) {
  return toggleLogScope(openLog(createState(makeRepo(t), "review", COLUMNS)));
}

// --- what git is asked for ---------------------------------------------------------

test("the graph follows every parent unless the trunk was asked for", () => {
  assert.ok(!graphLogArgs({}).includes("--first-parent"));
  assert.ok(!graphLogArgs({ ref: "main" }).includes("--first-parent"));

  assert.ok(graphLogArgs({ firstParent: true }).includes("--first-parent"));
  assert.ok(graphLogArgs({ ref: "main", firstParent: true }).includes("--first-parent"));
});

test("a narrowed graph still ends with the ref and the separator", () => {
  // The trailing `--` is what keeps a branch named like a file from being read as one,
  // and a new argument in front of it must not have moved it
  assert.deepStrictEqual(graphLogArgs({ ref: "main", firstParent: true }).slice(-2), ["main", "--"]);
});

// --- following the trunk -----------------------------------------------------------

test("the log opens following every parent", (t) => {
  assert.strictEqual(openLog(createState(makeRepo(t), "review", COLUMNS)).log.firstParent, false);
});

test("f leaves the merged branch's own commits out", (t) => {
  const state = onMain(t);
  assert.ok(subjects(state).includes("on the side"), "every commit, to begin with");

  const trunk = reduce(state, "f", VIEWPORT);

  assert.strictEqual(trunk.log.firstParent, true);
  assert.ok(subjects(trunk).includes("merge side"), "the merge is still a row");
  assert.ok(!subjects(trunk).includes("on the side"), "what came in through it is not");
});

test("pressing it again brings every commit back", (t) => {
  const back = reduce(reduce(onMain(t), "f", VIEWPORT), "f", VIEWPORT);

  assert.strictEqual(back.log.firstParent, false);
  assert.ok(subjects(back).includes("on the side"));
});

test("the toggle says what it did, and the header says so while it is on", (t) => {
  const state = onMain(t);
  const trunk = reduce(state, "f", VIEWPORT);

  assert.ok(trunk.message, "a setting that changes which commits exist announces itself");
  assert.match(toScreenModel(trunk).title, /first-parent/);
  assert.doesNotMatch(toScreenModel(state).title, /first-parent/);
});

test("the commit under the cursor is loaded underneath, as after any other scope", (t) => {
  const trunk = reduce(onMain(t), "f", VIEWPORT);

  assert.strictEqual(trunk.commit.subject, "merge side");
  assert.ok(trunk.files.length > 0);
});

// --- the choice survives everything else the log does -------------------------------

test("a reload keeps the trunk", (t) => {
  const trunk = reduce(onMain(t), "f", VIEWPORT);

  const refreshed = reloadLog(trunk, VIEWPORT);

  assert.strictEqual(refreshed.log.firstParent, true);
  assert.ok(!subjects(refreshed).includes("on the side"));
});

test("narrowing to a branch keeps it", (t) => {
  let state = cycleLogFocus(reduce(onMain(t), "f", VIEWPORT), -1);
  while (state.log.branchRows[state.log.branchCursor].branch.name !== "side") {
    state = moveLog(state, 1, VIEWPORT);
  }

  const narrowed = chooseInLog(state);

  assert.strictEqual(narrowed.log.ref, "side");
  assert.strictEqual(narrowed.log.firstParent, true);
});

test("swapping between every branch and this one keeps it", (t) => {
  const everywhere = toggleLogScope(reduce(onMain(t), "f", VIEWPORT));

  assert.strictEqual(everywhere.log.ref, null);
  assert.strictEqual(everywhere.log.firstParent, true);
});

// --- one author's work --------------------------------------------------------------

/** Type a name into the author field and accept it, as the reader does. */
function narrowToAuthor(state, name) {
  const asked = reduce(state, "A", VIEWPORT);
  // Whatever was prefilled is what a reader would type over
  const empty = { ...asked, input: { ...asked.input, text: "" } };
  const typed = Array.from(name).reduce((current, char) => reduce(current, char, VIEWPORT), empty);

  return reduce(typed, "enter", VIEWPORT);
}

test("the graph is read for everybody unless one author was named", () => {
  assert.ok(!graphLogArgs({}).some((arg) => arg.startsWith("--author")));
  assert.ok(graphLogArgs({ author: "Ada" }).includes("--author=Ada"));
});

test("A opens the field on the author of the commit under the cursor", (t) => {
  const asked = reduce(onMain(t), "A", VIEWPORT);

  assert.strictEqual(asked.input.kind, "author");
  assert.strictEqual(
    asked.input.text,
    "herdr-deep-code-reading test",
    "the reader is looking at somebody's commit, which is whose work they are asking after"
  );
});

test("naming an author leaves everybody else's commits out", (t) => {
  const state = onMain(t);
  assert.ok(subjects(state).includes("on main"), "everybody, to begin with");

  const hers = narrowToAuthor(state, "Ada");

  assert.strictEqual(hers.log.author, "Ada");
  assert.deepStrictEqual(subjects(hers), ["on the side"]);
});

test("an empty field widens the graph to everybody again", (t) => {
  const hers = narrowToAuthor(onMain(t), "Ada");

  const everybody = narrowToAuthor(hers, "");

  assert.strictEqual(everybody.log.author, null);
  assert.ok(subjects(everybody).includes("on main"));
});

test("the field opens on the name already chosen, so it can be typed over or cleared", (t) => {
  const hers = narrowToAuthor(onMain(t), "Ada");

  assert.strictEqual(reduce(hers, "A", VIEWPORT).input.text, "Ada");
});

test("the header names the author while one is chosen", (t) => {
  const hers = narrowToAuthor(onMain(t), "Ada");

  assert.match(toScreenModel(hers).title, /Ada/);
  assert.ok(hers.message, "and the footer says what just happened");
});

test("the author survives a reload, and rides alongside the trunk", (t) => {
  const both = reduce(narrowToAuthor(onMain(t), "Ada"), "f", VIEWPORT);

  assert.strictEqual(both.log.author, "Ada");
  assert.strictEqual(both.log.firstParent, true);

  const refreshed = reloadLog(both, VIEWPORT);

  assert.strictEqual(refreshed.log.author, "Ada");
  assert.strictEqual(refreshed.log.firstParent, true);
});

test("swapping to every branch keeps the author", (t) => {
  const everywhere = toggleLogScope(narrowToAuthor(onMain(t), "Ada"));

  assert.strictEqual(everywhere.log.ref, null);
  assert.strictEqual(everywhere.log.author, "Ada");
});

test("an author nobody matches is an empty graph rather than a failure", (t) => {
  const nobody = narrowToAuthor(onMain(t), "Nobody At All");

  assert.deepStrictEqual(subjects(nobody), []);
  assert.strictEqual(nobody.log.author, "Nobody At All");
});

// --- when git will not answer -------------------------------------------------------

test("a graph git cannot read leaves the setting unclaimed and says why", (t) => {
  const state = onMain(t);
  const broken = { ...state, log: { ...state.log, ref: "no-such-branch" } };

  const refused = reduce(broken, "f", VIEWPORT);

  assert.match(refused.message, /Could not read no-such-branch/);
  assert.strictEqual(refused.log.firstParent, false, "nothing changed but the message");
});
