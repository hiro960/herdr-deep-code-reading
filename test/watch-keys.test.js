"use strict";

// The watch as the pane runs it: the key that arms it, and what a tick does.
//
// lib/watch answers what counts as a change; this is the part that acts on one.
// The tick is driven directly rather than waited for — a test that sleeps past an
// interval is a test that fails on a loaded machine, and the interval itself is one
// setInterval call with nothing in it to get wrong.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const { createState, reduce, toScreenModel } = require("../lib/app-state");
const { applyKey, createWatcher } = require("../bin/review.js");

const VIEWPORT = 20;
const COLUMNS = 179;
const GIT_IDENTITY = ["-c", "user.email=test@example.com", "-c", "user.name=herdr-deep-code-reading test"];

function run(cwd, args) {
  execFileSync("git", args, { cwd, stdio: "ignore" });
}

function makeRepo(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "herdr-deep-code-reading-poll-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  run(root, ["init", "-q"]);
  fs.mkdirSync(path.join(root, "lib"), { recursive: true });
  fs.writeFileSync(path.join(root, "lib", "a.js"), "one\ntwo\nthree\n");
  run(root, ["add", "-A"]);
  run(root, [...GIT_IDENTITY, "commit", "-qm", "init"]);

  return root;
}

/** A session and a watcher over it, with a runtime that only counts its draws. */
function watching(t, root, mode) {
  const session = { state: createState(root, mode || "review", COLUMNS) };
  const drawn = { count: 0 };
  const runtime = { draw: () => (drawn.count += 1) };
  const watcher = createWatcher(session, runtime);
  t.after(() => watcher.stop());

  watcher.follow(true);
  return { session, watcher, drawn };
}

// --- the key -----------------------------------------------------------------

test("W turns the watch on and asks for the timer", (t) => {
  const root = makeRepo(t);
  const state = createState(root, "review", COLUMNS);
  assert.strictEqual(state.watching, false);

  const armed = reduce(state, "W", VIEWPORT);

  assert.strictEqual(armed.watching, true);
  assert.deepStrictEqual(armed.effect, { type: "watch" });
  assert.match(armed.message, /Watching/);
});

test("W again turns it off", (t) => {
  const root = makeRepo(t);
  const off = reduce(reduce(createState(root, "review", COLUMNS), "W", VIEWPORT), "W", VIEWPORT);

  assert.strictEqual(off.watching, false);
  assert.match(off.message, /Watch off/);
});

test("it can be turned on from any view", (t) => {
  const root = makeRepo(t);

  for (const mode of ["review", "files"]) {
    const state = createState(root, mode, COLUMNS);
    assert.strictEqual(reduce(state, "W", VIEWPORT).watching, true, mode);
  }
});

test("every footer names it, and the header says when it is on", (t) => {
  const root = makeRepo(t);
  const state = createState(root, "review", COLUMNS);

  assert.match(toScreenModel(state).help, /W watch/);
  // The repository name is in the subtitle too, so the fixture is named to stay
  // out of the way of the word being looked for
  assert.doesNotMatch(toScreenModel(state).subtitle, /watching/);
  assert.match(toScreenModel(reduce(state, "W", VIEWPORT)).subtitle, /watching/);
});

test("the effect is harmless with no watcher to perform it", (t) => {
  // Which is how every test that presses keys through applyKey runs
  const root = makeRepo(t);

  const armed = applyKey(createState(root, "review", COLUMNS), "W", null, VIEWPORT);

  assert.strictEqual(armed.watching, true);
  assert.strictEqual(armed.effect, null);
});

// --- what a tick does ----------------------------------------------------------

test("a tick over an unchanged repository does nothing", (t) => {
  const root = makeRepo(t);
  const { session, watcher, drawn } = watching(t, root);
  const before = session.state;

  watcher.tick();

  assert.strictEqual(session.state, before);
  assert.strictEqual(drawn.count, 0);
});

test("a tick after someone else edited a file reloads and redraws", (t) => {
  const root = makeRepo(t);
  const { session, watcher, drawn } = watching(t, root);
  assert.strictEqual(session.state.files.length, 0);

  fs.writeFileSync(path.join(root, "lib", "a.js"), "one\nedited by an agent\nthree\n");
  watcher.tick();

  assert.strictEqual(session.state.files.length, 1);
  assert.strictEqual(drawn.count, 1);
  assert.match(session.state.message, /the repository changed/);
});

test("the same change is not reported twice", (t) => {
  const root = makeRepo(t);
  const { watcher, drawn } = watching(t, root);
  fs.writeFileSync(path.join(root, "lib", "a.js"), "changed\n");
  watcher.tick();

  watcher.tick();

  assert.strictEqual(drawn.count, 1);
});

test("a commit made in another pane is picked up", (t) => {
  const root = makeRepo(t);
  const { session, watcher } = watching(t, root, "branch");
  fs.writeFileSync(path.join(root, "lib", "a.js"), "changed\n");
  run(root, ["add", "-A"]);
  run(root, [...GIT_IDENTITY, "commit", "-qm", "from another pane"]);

  watcher.tick();

  assert.match(session.state.message, /the repository changed/);
});

test("a reader in a file stays in it", (t) => {
  const root = makeRepo(t);
  const { session, watcher } = watching(t, root, "files");
  session.state = ["l", "l", "j"].reduce(
    (state, key) => reduce(state, key, VIEWPORT),
    session.state
  );
  assert.strictEqual(session.state.view, "read");

  fs.writeFileSync(path.join(root, "lib", "a.js"), "one\nedited\nthree\n");
  watcher.tick();

  assert.strictEqual(session.state.view, "read");
  assert.strictEqual(session.state.openPath, "lib/a.js");
  assert.strictEqual(session.state.rows[1].cell.text, "edited");
});

test("a half-written comment is not reloaded out from under the reader", (t) => {
  const root = makeRepo(t);
  const { session, watcher, drawn } = watching(t, root, "files");
  session.state = ["l", "l", "c", "h", "i"].reduce(
    (state, key) => reduce(state, key, VIEWPORT),
    session.state
  );
  assert.strictEqual(session.state.input.text, "hi");

  fs.writeFileSync(path.join(root, "lib", "a.js"), "changed\n");
  watcher.tick();

  assert.strictEqual(drawn.count, 0);
  assert.strictEqual(session.state.input.text, "hi");
});

test("the change waits, and arrives once the field is closed", (t) => {
  // Skipping a tick must not lose the change: the fingerprint is deliberately
  // not recorded while a field is open
  const root = makeRepo(t);
  const { session, watcher, drawn } = watching(t, root, "files");
  session.state = ["l", "l", "c"].reduce((state, key) => reduce(state, key, VIEWPORT), session.state);
  fs.writeFileSync(path.join(root, "lib", "a.js"), "changed\n");
  watcher.tick();

  session.state = reduce(session.state, "escape", VIEWPORT);
  watcher.tick();

  assert.strictEqual(drawn.count, 1);
});

test("a reload the pane did itself is not announced again", (t) => {
  const root = makeRepo(t);
  const { session, watcher, drawn } = watching(t, root);

  fs.writeFileSync(path.join(root, "lib", "a.js"), "changed\n");
  // What `r` does, through the same path a key press takes
  session.state = applyKey(session.state, "r", { watcher }, VIEWPORT);
  watcher.tick();

  assert.strictEqual(drawn.count, 0, "the watcher reported a reload the pane had just done");
});

test("moving in the log does not swallow a commit the watch was waiting for", (t) => {
  // Every step down the graph loads that commit's diff, so `files` changes on every
  // j — and telling the watcher "the pane just reloaded" on the strength of that
  // would record a repository the reader has not been shown as one they have.
  const root = makeRepo(t);
  fs.writeFileSync(path.join(root, "lib", "b.js"), "two\n");
  run(root, ["add", "-A"]);
  run(root, [...GIT_IDENTITY, "commit", "-qm", "second"]);

  const { session, watcher, drawn } = watching(t, root, "log");
  assert.strictEqual(session.state.view, "log");

  // An agent commits in another pane
  fs.writeFileSync(path.join(root, "lib", "c.js"), "three\n");
  run(root, ["add", "-A"]);
  run(root, [...GIT_IDENTITY, "commit", "-qm", "landed while reading"]);

  // And the reader moves before the next tick comes round
  session.state = applyKey(session.state, "j", { watcher }, VIEWPORT);
  watcher.tick();

  assert.strictEqual(drawn.count, 1, "the commit that landed was never announced");
  assert.strictEqual(
    session.state.log.rows.filter((row) => row.commit !== null)[0].commit.subject,
    "landed while reading"
  );
});

test("stopping ends it", (t) => {
  const root = makeRepo(t);
  const { session, watcher, drawn } = watching(t, root);

  watcher.stop();
  fs.writeFileSync(path.join(root, "lib", "a.js"), "changed\n");
  watcher.follow(false);

  assert.strictEqual(drawn.count, 0);
  assert.strictEqual(session.state.files.length, 0);
});

// --- catching up on the way in -----------------------------------------------

test("turning the watch on brings in what an agent wrote while it was off", (t) => {
  // Regression: the watch armed itself with a fingerprint of the world as it already
  // was, so an answer written before the key was pressed stayed invisible until
  // something else changed — and in the reading view there is no `r` to ask again with
  const root = makeRepo(t);
  const notesFile = path.join(root, "notes.json");
  const state = createState(root, "files", COLUMNS, { notesFile });
  assert.deepStrictEqual(state.notes, []);

  fs.writeFileSync(
    notesFile,
    JSON.stringify({ [root]: [{ path: "lib/a.js", line: 2, text: "because", from: "claude" }] })
  );
  const armed = reduce(state, "W", VIEWPORT);

  assert.strictEqual(armed.watching, true);
  assert.strictEqual(armed.notes.length, 1);
  assert.strictEqual(armed.notes[0].text, "because");
});

test("turning the watch on says so rather than announcing a reload", (t) => {
  const root = makeRepo(t);

  assert.match(reduce(createState(root, "review", COLUMNS), "W", VIEWPORT).message, /^Watching/);
});

test("turning the watch off reads nothing and says so", (t) => {
  const root = makeRepo(t);
  const armed = reduce(createState(root, "review", COLUMNS), "W", VIEWPORT);

  const off = reduce(armed, "W", VIEWPORT);

  assert.strictEqual(off.watching, false);
  assert.strictEqual(off.message, "Watch off");
});
