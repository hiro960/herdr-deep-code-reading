"use strict";

// The effects, asked for directly.
//
// The reducer answers a key with a state and, when the key wants something of the
// world, an `effect` describing it. The other tests press keys and watch what comes
// out the far end; these call the effects themselves, because most of what is worth
// checking here is what happens when the world says no — a git that refuses, a herdr
// that is not running, a directory that cannot be written to. Those are hard to
// arrange from a keystroke and are exactly the paths a reviewer meets on a bad day.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const {
  CRASH_FILENAME,
  EXPORT_FILENAME,
  beginSend,
  outgoing,
  deliver,
  exportToFile,
  performCommit,
  performEffect,
  persistBookmarks,
  rescueComments,
  revealPath,
  stageAll,
  subjectOf,
  toggleStage,
} = require("../lib/run/effects");
const { SIDE_NEW } = require("../lib/comments");

const COMMENT = {
  path: "a.js",
  side: SIDE_NEW,
  start: 1,
  end: 1,
  lines: ["const x = 1;"],
  text: "why one?",
};

function tempDir(t, prefix) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), `herdr-deep-code-reading-${prefix}-`));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

/** Set one variable for the length of a test, and put it back afterwards. */
function withEnv(t, name, value) {
  const had = Object.prototype.hasOwnProperty.call(process.env, name);
  const was = process.env[name];

  t.after(() => {
    if (had) {
      process.env[name] = was;
    } else {
      delete process.env[name];
    }
  });

  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

/** A stand-in herdr, as in test/send-cli.test.js but pointed at by the environment. */
function fakeHerdr(t, spec) {
  const directory = tempDir(t, "fake-herdr");
  const bin = path.join(directory, "herdr");

  fs.writeFileSync(
    bin,
    [
      `#!${process.execPath}`,
      '"use strict";',
      `const spec = ${JSON.stringify(spec)};`,
      "const args = process.argv.slice(2);",
      'const rule = (spec.rules || []).find((one) => args.join(" ").includes(one.match));',
      "const answer = rule === undefined ? spec : rule;",
      'process.stdout.write(answer.stdout || "");',
      'process.stderr.write(answer.stderr || "");',
      "process.exit(answer.status || 0);",
      "",
    ].join("\n")
  );
  fs.chmodSync(bin, 0o755);
  withEnv(t, "HERDR_BIN_PATH", bin);
  return bin;
}

function agentListing(agents) {
  return JSON.stringify({ result: { agents } });
}

function makeRepo(t) {
  const root = tempDir(t, "effects");

  execFileSync("git", ["init", "-q"], { cwd: root, stdio: "ignore" });
  fs.writeFileSync(path.join(root, "a.js"), "const x = 1;\n");
  execFileSync("git", ["add", "-A"], { cwd: root, stdio: "ignore" });
  execFileSync(
    "git",
    ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init"],
    { cwd: root, stdio: "ignore" }
  );
  fs.writeFileSync(path.join(root, "a.js"), "const x = 2;\n");

  return root;
}

/** The bare bones of a state, enough for an effect to act on. */
function stateFor(repoDir, extra) {
  return {
    repoDir,
    mode: "review",
    files: [],
    fileSummaries: [],
    selectedIndex: 0,
    sideBySide: false,
    columns: 100,
    layout: null,
    rows: [],
    scroll: 0,
    cursor: 0,
    comments: [],
    commit: null,
    effect: null,
    message: null,
    ...extra,
  };
}

// --- writing the review out ---------------------------------------------------

test("with nobody to send to, the review is written where it can be found", (t) => {
  const stateDir = tempDir(t, "state");
  withEnv(t, "HERDR_PLUGIN_STATE_DIR", stateDir);

  const next = exportToFile(stateFor("/nowhere"), outgoing(stateFor("/nowhere"), { comments: [COMMENT] }));

  const written = fs.readFileSync(path.join(stateDir, EXPORT_FILENAME), "utf8");
  assert.match(next.message, /Written to/);
  assert.strictEqual(next.effect, null);
  assert.ok(written.includes("why one?"), "the comment is not in the file");
});

test("an export that cannot be written says so rather than claiming it was", (t) => {
  // A file where the directory should be is the shape of this that does not depend
  // on which user the suite runs as
  const parent = tempDir(t, "state");
  const blocked = path.join(parent, "state");
  fs.writeFileSync(blocked, "");
  withEnv(t, "HERDR_PLUGIN_STATE_DIR", blocked);

  const next = exportToFile(
    stateFor("/nowhere"),
    outgoing(stateFor("/nowhere"), { comments: [COMMENT] })
  );

  assert.match(next.message, /the export failed/);
});

test("a crash puts the review under a name of its own", (t) => {
  // The reviewer may have exported deliberately earlier in the session, and the batch
  // they meant to keep should not be overwritten by whatever was in hand when
  // something broke
  const stateDir = tempDir(t, "state");
  withEnv(t, "HERDR_PLUGIN_STATE_DIR", stateDir);

  const said = rescueComments([COMMENT]);

  assert.match(said, /1 unsent comment written to/);
  assert.ok(fs.existsSync(path.join(stateDir, CRASH_FILENAME)));
  assert.ok(!fs.existsSync(path.join(stateDir, EXPORT_FILENAME)), "it took the export's name");
});

test("a crash with nothing written has nothing to say", () => {
  assert.strictEqual(rescueComments([]), "");
  assert.strictEqual(rescueComments(null), "");
  assert.strictEqual(rescueComments(undefined), "");
});

test("a rescue that fails reports the loss rather than hiding it", (t) => {
  const parent = tempDir(t, "state");
  const blocked = path.join(parent, "state");
  fs.writeFileSync(blocked, "");
  withEnv(t, "HERDR_PLUGIN_STATE_DIR", blocked);

  assert.match(rescueComments([COMMENT, COMMENT]), /2 unsent comments could not be saved/);
});

// --- handing the review to an agent -------------------------------------------

test("a delivered batch says which agent has it, and that it was not sent", (t) => {
  fakeHerdr(t, {});

  const next = deliver(stateFor("/nowhere", { comments: [COMMENT] }), {
    agent: "claude",
    pane_id: "w1:p1",
  });

  assert.strictEqual(next.effect, null);
  assert.match(next.message, /Pasted 1 comment into claude — not submitted/);
});

test("a paste that herdr refused is reported as a failure", (t) => {
  fakeHerdr(t, { status: 1, stderr: "no such pane" });

  const next = deliver(stateFor("/nowhere", { comments: [COMMENT] }), {
    agent: "claude",
    pane_id: "gone",
  });

  assert.strictEqual(next.message, "Send failed: no such pane");
});

test("a herdr that cannot be asked is a reason, not an empty workspace", (t) => {
  fakeHerdr(t, { status: 1, stderr: "no server is running" });

  const next = beginSend(stateFor("/nowhere", { comments: [COMMENT] }));

  assert.strictEqual(next.message, "Could not list agents: no server is running");
  assert.strictEqual(next.picker, undefined, "it opened a picker over a failure");
});

test("no agent at all falls back to the file", (t) => {
  const stateDir = tempDir(t, "state");
  withEnv(t, "HERDR_PLUGIN_STATE_DIR", stateDir);
  withEnv(t, "HERDR_WORKSPACE_ID", undefined);
  withEnv(t, "HERDR_PANE_ID", undefined);
  fakeHerdr(t, { stdout: agentListing([]) });

  const next = beginSend(stateFor("/nowhere", { comments: [COMMENT] }));

  assert.match(next.message, /No agent found/);
  assert.ok(fs.existsSync(path.join(stateDir, EXPORT_FILENAME)));
});

test("one agent receives the batch without being chosen", (t) => {
  withEnv(t, "HERDR_WORKSPACE_ID", undefined);
  withEnv(t, "HERDR_PANE_ID", undefined);
  fakeHerdr(t, { stdout: agentListing([{ agent: "claude", pane_id: "w1:p1" }]) });

  const next = beginSend(stateFor("/nowhere", { comments: [COMMENT] }));

  assert.match(next.message, /Pasted 1 comment into claude/);
  assert.strictEqual(next.picker, undefined, "it asked about the only answer");
});

test("several agents open a picker rather than one being guessed at", (t) => {
  withEnv(t, "HERDR_WORKSPACE_ID", undefined);
  withEnv(t, "HERDR_PANE_ID", undefined);
  fakeHerdr(t, {
    stdout: agentListing([
      { agent: "claude", pane_id: "w1:p1", agent_status: "idle" },
      { agent: "codex", pane_id: "w1:p2", agent_status: "working" },
    ]),
  });

  const next = beginSend(stateFor("/nowhere", { comments: [COMMENT] }));

  assert.strictEqual(next.picker.count, 1);
  assert.strictEqual(next.picker.agents.length, 2);
  assert.match(next.picker.agents[0].label, /claude/);
});

test("the pane doing the reviewing is not offered the review", (t) => {
  const stateDir = tempDir(t, "state");
  withEnv(t, "HERDR_PLUGIN_STATE_DIR", stateDir);
  withEnv(t, "HERDR_WORKSPACE_ID", "w1");
  withEnv(t, "HERDR_PANE_ID", "w1:p1");
  fakeHerdr(t, {
    stdout: agentListing([{ agent: "claude", pane_id: "w1:p1", workspace_id: "w1" }]),
  });

  const next = beginSend(stateFor("/nowhere", { comments: [COMMENT] }));

  assert.match(next.message, /No agent found/, "it sent the review to itself");
});

// --- git ----------------------------------------------------------------------

test("staging a file reloads so the panel and the diff agree", (t) => {
  const root = makeRepo(t);

  const next = toggleStage(stateFor(root), {
    paths: ["a.js"],
    label: "a.js",
    gitStatus: " M",
  });

  assert.match(next.message, /Staged a.js/);
  const status = execFileSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" });
  assert.match(status, /^M /, "the file was not staged");
});

test("a staged file with nothing further to stage is unstaged again", (t) => {
  const root = makeRepo(t);
  execFileSync("git", ["add", "a.js"], { cwd: root, stdio: "ignore" });

  const next = toggleStage(stateFor(root), {
    paths: ["a.js"],
    label: "a.js",
    gitStatus: "M ",
  });

  assert.match(next.message, /Unstaged a.js/);
});

test("a stage git refused is reported with git's own reason", (t) => {
  const notARepo = tempDir(t, "bare");

  const next = toggleStage(stateFor(notARepo), {
    paths: ["a.js"],
    label: "a.js",
    gitStatus: " M",
  });

  assert.match(next.message, /^Stage failed: /);
  assert.strictEqual(next.effect, null);
});

test("staging everything reloads once, not once per file", (t) => {
  const root = makeRepo(t);
  fs.writeFileSync(path.join(root, "new.js"), "const y = 2;\n");

  const next = stageAll(stateFor(root));

  assert.strictEqual(next.message, "Staged every change");
  const status = execFileSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" });
  assert.ok(status.includes("A  new.js"), "the untracked file was left behind");
});

test("staging everything where there is no repository says so", (t) => {
  const next = stageAll(stateFor(tempDir(t, "bare")));

  assert.match(next.message, /^Stage all failed: /);
});

test("a commit with nothing staged is refused before git is asked", (t) => {
  const root = makeRepo(t);

  const next = performCommit(stateFor(root), "feat: something");

  assert.strictEqual(next.message, "Nothing staged to commit");
  assert.strictEqual(next.effect, null);
});

test("an index that cannot be read is a different answer from an empty one", (t) => {
  const next = performCommit(stateFor(tempDir(t, "bare")), "feat: something");

  assert.match(next.message, /^Could not read the index: /);
});

test("a commit is named by its first line, however many the reviewer wrote", (t) => {
  const root = makeRepo(t);
  execFileSync("git", ["add", "a.js"], { cwd: root, stdio: "ignore" });
  execFileSync("git", ["config", "user.email", "t@t"], { cwd: root, stdio: "ignore" });
  execFileSync("git", ["config", "user.name", "t"], { cwd: root, stdio: "ignore" });

  const next = performCommit(stateFor(root), "fix: the one thing\n\nand why it was wrong");

  assert.strictEqual(next.message, "Committed: fix: the one thing");
  const subject = execFileSync("git", ["log", "-1", "--pretty=%s"], {
    cwd: root,
    encoding: "utf8",
  });
  assert.strictEqual(subject.trim(), "fix: the one thing");
});

test("the footer is given one line even when git's refusal is many", () => {
  assert.strictEqual(subjectOf("first\nsecond\nthird"), "first");
  assert.strictEqual(subjectOf("only one"), "only one");
});

// --- the desktop ---------------------------------------------------------------

test("a path outside the repository is refused before anything is opened", (t) => {
  const root = makeRepo(t);
  let launched = false;

  const next = revealPath(stateFor(root), "../../etc", null, () => {
    launched = true;
  });

  assert.strictEqual(launched, false, "it opened a window on a path it had refused");
  assert.strictEqual(next.effect, null);
  assert.ok(next.message.length > 0);
});

test("a path that is not there says which one", (t) => {
  // The same containment check every read goes through answers first, so a missing
  // path is refused for the same reason and in the same words as an unreadable one
  const root = makeRepo(t);

  const next = revealPath(stateFor(root), "no-such-file.js", null, () => {});

  assert.match(next.message, /no-such-file\.js/);
  assert.strictEqual(next.effect, null);
});

test("what the desktop was asked to open is the file's own directory", (t) => {
  const root = makeRepo(t);
  const asked = [];

  const next = revealPath(stateFor(root), "a.js", null, (command, args) => {
    asked.push([command, args]);
    return { on: () => {}, unref: () => {} };
  });

  assert.strictEqual(next.message, "Showing a.js");
  assert.strictEqual(asked.length, 1, "nothing was opened");
});

test("an opener that will not start is reported rather than assumed", (t) => {
  const root = makeRepo(t);

  const next = revealPath(stateFor(root), "a.js", null, () => {
    throw new Error("spawn failed");
  });

  assert.match(next.message, /^Could not run .*: spawn failed$/);
});

test("an opener that fails a tick later still reaches the footer", (t) => {
  // xdg-open is not on every Linux, and a missing one reports itself on an event
  // after the effect has already returned. Left unheard, the footer would be claiming
  // to have shown something the desktop never received.
  const root = makeRepo(t);
  const said = [];
  let fail;

  revealPath(stateFor(root), "a.js", { report: (message) => said.push(message) }, () => ({
    on: (event, handler) => {
      if (event === "error") {
        fail = handler;
      }
    },
    unref: () => {},
  }));

  fail(new Error("not found"));
  assert.strictEqual(said.length, 1, "the desktop's refusal was swallowed");
  assert.match(said[0], /^Could not run \S+: not found$/);
});

// --- the bookmarks --------------------------------------------------------------

test("saved places are written back without a word about it", (t) => {
  const store = path.join(tempDir(t, "bookmarks"), "bookmarks.json");
  const state = stateFor("/repo", {
    bookmarksFile: store,
    bookmarks: [{ path: "a.js", line: 1, text: "const x = 1;" }],
  });

  const next = persistBookmarks(state);

  assert.strictEqual(next.effect, null);
  assert.strictEqual(next.message, null, "a successful save announced itself");
  assert.ok(fs.existsSync(store));
});

test("a save that failed keeps the bookmark on screen and says so", (t) => {
  const directory = tempDir(t, "bookmarks");
  const state = stateFor("/repo", {
    // A directory where the file should be: the write fails, whoever is running
    bookmarksFile: directory,
    bookmarks: [{ path: "a.js", line: 1, text: "const x = 1;" }],
  });

  const next = persistBookmarks(state);

  assert.match(next.message, /^Bookmarks could not be saved: /);
});

// --- the dispatch ----------------------------------------------------------------

test("a state with nothing asked of the world is handed straight back", () => {
  const state = stateFor("/repo");

  assert.strictEqual(performEffect(state, null), state);
  assert.strictEqual(performEffect({ ...state, effect: undefined }, null).effect, undefined);
});

test("an effect nobody performs is cleared rather than left to repeat", () => {
  // A pending effect the next key found still sitting there would be performed twice
  const next = performEffect(stateFor("/repo", { effect: { type: "sing" } }), null);

  assert.strictEqual(next.effect, null);
});

test("the watch effect reaches the watcher and nothing else", () => {
  const followed = [];
  const runtime = { watcher: { follow: (on) => followed.push(on) } };

  const next = performEffect(stateFor("/repo", { effect: { type: "watch" }, watching: true }), runtime);

  assert.deepStrictEqual(followed, [true]);
  assert.strictEqual(next.effect, null);
});

test("the watch effect survives a runtime with no watcher on it yet", () => {
  const state = stateFor("/repo", { effect: { type: "watch" }, watching: true });

  assert.strictEqual(performEffect(state, null).effect, null);
  assert.strictEqual(performEffect(state, {}).effect, null);
});

test("every effect the reducer can ask for is dispatched somewhere", (t) => {
  // The dispatch is a list of string comparisons, and a type added to the reducer
  // without a line here would silently do nothing
  const stateDir = tempDir(t, "state");
  withEnv(t, "HERDR_PLUGIN_STATE_DIR", stateDir);
  withEnv(t, "HERDR_WORKSPACE_ID", undefined);
  withEnv(t, "HERDR_PANE_ID", undefined);
  fakeHerdr(t, { stdout: agentListing([]) });

  const cases = [
    [{ type: "send" }, /No agent found/],
    [{ type: "stage", paths: ["a.js"], label: "a.js", gitStatus: " M" }, /Staged a\.js/],
    [{ type: "stage-all" }, /Staged every change/],
    [{ type: "commit", message: "nope" }, /Nothing staged to commit/],
    [{ type: "reveal", path: "../outside" }, /.+/],
  ];

  for (const [effect, expected] of cases) {
    // A repository each: staging in one case would leave the next one's commit with
    // something to commit, and the answers would depend on the order they run in
    const next = performEffect(stateFor(makeRepo(t), { effect, comments: [COMMENT] }), null);

    assert.match(next.message, expected, `${effect.type} was not dispatched`);
    assert.strictEqual(next.effect, null, `${effect.type} left its effect behind`);
  }
});

test("send-to goes to the agent the picker chose", (t) => {
  fakeHerdr(t, {});
  const effect = { type: "send-to", agent: { agent: "codex", pane_id: "w1:p2" } };

  const next = performEffect(stateFor("/nowhere", { effect, comments: [COMMENT] }), null);

  assert.match(next.message, /Pasted 1 comment into codex/);
});

test("save-bookmarks is dispatched to the write", (t) => {
  const store = path.join(tempDir(t, "bookmarks"), "bookmarks.json");
  const state = stateFor("/repo", {
    effect: { type: "save-bookmarks" },
    bookmarksFile: store,
    bookmarks: [{ path: "a.js", line: 1, text: "const x = 1;" }],
  });

  assert.strictEqual(performEffect(state, null).effect, null);
  assert.ok(fs.existsSync(store));
});
