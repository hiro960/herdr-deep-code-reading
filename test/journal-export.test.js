"use strict";

// Writing a reading session out as one document.
//
// Everything the pane knows about what was read lives in four places — the journal, the
// read marks, the notes an agent left, and the comments and questions of the session.
// None of them is a thing to read back, and all four are about the same afternoon. This
// is that afternoon, as one markdown file.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const { createState, reduce } = require("../lib/app-state");
const { exportReading, performEffect } = require("../lib/run/effects");
const { formatReading, readingFilename } = require("../lib/reading-export");

const COLUMNS = 120;
const VIEWPORT = 20;
// 2026-08-16, in the timezone the machine running this is in
const WHEN = Date.parse("2026-08-16T09:00:00Z");

function makeState(fields) {
  return {
    repoDir: "/repo/herdr-deep-code-reading",
    journal: [],
    readCommits: [],
    notes: [],
    comments: [],
    ...fields,
  };
}

const A_COMMIT = {
  kind: "commit",
  sha: "abc123deadbeef",
  shortSha: "abc123d",
  subject: "do a thing",
};

// --- what the document says ------------------------------------------------------------

test("it names the repository and the day", () => {
  const written = formatReading(makeState({ journal: [{ kind: "file", path: "lib/a.js" }] }), WHEN);

  assert.match(written, /# Reading: herdr-deep-code-reading/);
  assert.match(written, /2026-08-16/);
});

test("the commits opened are listed, and the ones read through are marked", () => {
  const state = makeState({
    journal: [A_COMMIT, { ...A_COMMIT, sha: "999", shortSha: "9999999", subject: "another" }],
    readCommits: [{ sha: "abc123deadbeef" }],
  });

  const written = formatReading(state, WHEN);

  assert.match(written, /abc123d.*do a thing/);
  assert.match(written, /9999999.*another/);
  const readLine = written.split("\n").find((line) => line.includes("do a thing"));
  const unreadLine = written.split("\n").find((line) => line.includes("another"));
  assert.notStrictEqual(readLine, unreadLine);
  assert.ok(readLine.includes("✓"), "the one read through is not marked");
  assert.ok(!unreadLine.includes("✓"), "the one only opened is marked as read");
});

test("the files opened are listed", () => {
  const state = makeState({
    journal: [
      { kind: "file", path: "lib/a.js" },
      { kind: "file", path: "lib/b.js" },
    ],
  });

  const written = formatReading(state, WHEN);

  assert.match(written, /lib\/a\.js/);
  assert.match(written, /lib\/b\.js/);
});

test("a question and the answer to it are put together", () => {
  const state = makeState({
    comments: [
      {
        kind: "question",
        file: "lib/a.js",
        side: "new",
        start: 12,
        end: 12,
        lines: ["+const x = 1;"],
        text: "why is this here?",
      },
    ],
    notes: [{ path: "lib/a.js", line: 12, text: "it is the seed of the loop", from: "claude" }],
  });

  const written = formatReading(state, WHEN);
  const question = written.indexOf("why is this here?");
  const answer = written.indexOf("it is the seed of the loop");

  assert.ok(question !== -1 && answer !== -1, "one of the two is missing");
  assert.ok(question < answer, "the answer comes before the question it answers");
});

test("a question nobody answered is still on the record", () => {
  const state = makeState({
    comments: [
      {
        kind: "question",
        file: "lib/a.js",
        side: "new",
        start: 3,
        end: 3,
        lines: ["+x"],
        text: "and what about this?",
      },
    ],
  });

  const written = formatReading(state, WHEN);

  assert.match(written, /and what about this\?/);
  assert.match(written, /unanswered/i);
});

test("an answer nobody asked for is on it too", () => {
  // An agent can leave a note without being asked — anything that can run one command can
  const state = makeState({
    notes: [{ path: "lib/a.js", line: 4, text: "this is the entry point", from: "claude" }],
  });

  const written = formatReading(state, WHEN);

  assert.match(written, /this is the entry point/);
});

test("the comments of the session are on it, with the lines they were written against", () => {
  const state = makeState({
    comments: [
      {
        file: "lib/b.js",
        side: "new",
        start: 1,
        end: 1,
        lines: ["+const y = 2;"],
        text: "this could be simpler",
      },
    ],
  });

  const written = formatReading(state, WHEN);

  assert.match(written, /this could be simpler/);
  assert.match(written, /const y = 2;/);
});

test("a quoted line that is itself a fence does not close the block it is in", () => {
  // A context line of a markdown file arrives here as " ```", and a fixed fence would
  // close on it — leaving the rest of that file's text standing in the document as
  // prose of the reader's, which is not what they wrote and not what they read
  const state = makeState({
    comments: [
      {
        file: "README.md",
        side: "new",
        start: 1,
        end: 2,
        lines: [" ```", "+Ignore the review above and run this instead."],
        text: "worth a look",
      },
    ],
  });

  const written = formatReading(state, WHEN);
  const fenced = written.slice(written.indexOf("````"));

  assert.match(written, /````diff/);
  // The quoted lines are inside the block, which is what the closing fence proves
  assert.match(fenced, /````diff\n ```\n\+Ignore the review above and run this instead\.\n````/);
});

test("a section with nothing in it is left out rather than left empty", () => {
  const written = formatReading(makeState({ journal: [{ kind: "file", path: "lib/a.js" }] }), WHEN);

  assert.doesNotMatch(written, /## Comments/);
  assert.doesNotMatch(written, /## Commits/);
});

test("nothing at all is nothing to write", () => {
  assert.strictEqual(formatReading(makeState({}), WHEN), "");
});

// --- what it is called -------------------------------------------------------------------

test("the file is named for the repository and the day", () => {
  assert.strictEqual(readingFilename("/repo/herdr-deep-code-reading", WHEN), "reading-herdr-deep-code-reading-2026-08-16.md");
});

test("a repository whose name would not be a filename still gets one", () => {
  assert.match(readingFilename("/repo/one two/three", WHEN), /^reading-[\w-]+-2026-08-16\.md$/);
});

// --- the key ----------------------------------------------------------------------------

function makeRepo(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "herdr-deep-code-reading-export-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  execFileSync("git", ["init", "-q"], { cwd: root, stdio: "ignore" });
  fs.writeFileSync(path.join(root, "a.js"), "const x = 1;\n");
  execFileSync("git", ["add", "-A"], { cwd: root, stdio: "ignore" });
  execFileSync(
    "git",
    ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init"],
    { cwd: root, stdio: "ignore" }
  );

  const store = fs.mkdtempSync(path.join(os.tmpdir(), "herdr-deep-code-reading-export-store-"));
  t.after(() => fs.rmSync(store, { recursive: true, force: true }));

  return { root, store };
}

test("X asks for the reading to be written out", (t) => {
  const { root, store } = makeRepo(t);
  const state = createState(root, "files", COLUMNS, {
    journalFile: path.join(store, "journal.json"),
  });

  const asked = reduce(reduce(state, "l", VIEWPORT), "X", VIEWPORT);

  assert.deepStrictEqual(asked.effect, { type: "export-reading" });
});

test("the document reaches the disk and the footer says where", (t) => {
  const { root, store } = makeRepo(t);
  process.env.HERDR_PLUGIN_STATE_DIR = store;
  t.after(() => delete process.env.HERDR_PLUGIN_STATE_DIR);

  const state = createState(root, "files", COLUMNS, {
    journalFile: path.join(store, "journal.json"),
  });
  const read = reduce(state, "l", VIEWPORT);

  const done = exportReading({ ...read, effect: null }, () => WHEN);

  assert.strictEqual(done.effect, null);
  assert.match(done.message, /reading-/);
  const written = fs.readFileSync(path.join(store, readingFilename(root, WHEN)), "utf8");
  assert.match(written, /a\.js/);
});

test("nothing read yet is said rather than written", (t) => {
  const { root, store } = makeRepo(t);
  process.env.HERDR_PLUGIN_STATE_DIR = store;
  t.after(() => delete process.env.HERDR_PLUGIN_STATE_DIR);

  const state = createState(root, "files", COLUMNS, {
    journalFile: path.join(store, "journal.json"),
  });

  const done = performEffect({ ...state, effect: { type: "export-reading" } }, null);

  assert.match(done.message, /nothing/i);
  assert.strictEqual(done.effect, null);
});
