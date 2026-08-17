"use strict";

// A message takes rows away from the key list. On a wide terminal the whole list is
// one row, so "Staged every change" leaves a footer with no keys on it — and it used
// to stay that way until the next keystroke, which is the one thing the reader can
// no longer see the name of.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync, spawnSync } = require("node:child_process");

const { MESSAGE_TIMEOUT_MS, expireMessage } = require("../bin/review");
const { createState, reduce, toScreenModel } = require("../lib/app-state");
const { footerLines } = require("../lib/render/chrome");
const { OVERFLOW } = require("../lib/help-layout");

const VIEWPORT = 20;

/**
 * A width the whole key list fits on one row of.
 *
 * This file is about the message taking that row and giving it back, so a footer that
 * wrapped would be testing something else. The width is measured rather than written
 * down: the list grows every time a key is added, and a number here would have to be
 * chased each time — which it was, twice, before this.
 */
function widthForOneRow(state) {
  return toScreenModel(state).help.length + 2;
}

function run(cwd, args) {
  execFileSync("git", args, { cwd, stdio: "ignore" });
}

function makeRepo(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "herdr-deep-code-reading-msg-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  run(root, ["init", "-q"]);
  fs.writeFileSync(path.join(root, "a.js"), "const a = 1;\n");
  fs.writeFileSync(path.join(root, "b.js"), "const b = 2;\n");
  run(root, ["add", "-A"]);
  run(root, ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init"]);
  // Two changed files, so a movement key has somewhere to go and really does act
  fs.writeFileSync(path.join(root, "a.js"), "const a = 99;\n");
  fs.writeFileSync(path.join(root, "b.js"), "const b = 99;\n");

  return root;
}

/**
 * What the footer would actually show for a state, at a width it fits on.
 * The renderer's own, rather than a copy of it here: a copy is a second opinion about
 * where a message goes, and this file is about exactly that.
 */
function footerOf(state, columns) {
  return footerLines(toScreenModel(state), columns || widthForOneRow(state));
}

// --- what expiring a message leaves behind ----------------------------------

test("clears the message so the key list has its row back", () => {
  const state = { message: "Staged every change", pendingQuit: false, cursor: 0 };

  assert.strictEqual(expireMessage(state).message, null);
});

test("takes the quit prompt down with the message that armed it", () => {
  // A prompt nobody can see must not still be counting the next q as the second
  const asked = { message: "1 unsent comment — press again to discard", pendingQuit: true };

  assert.strictEqual(expireMessage(asked).pendingQuit, false);
});

test("leaves a state with nothing to say exactly as it was", () => {
  const quiet = { message: null, pendingQuit: false };

  assert.strictEqual(expireMessage(quiet), quiet);
});

test("changes nothing else about the state", () => {
  const state = { message: "Reloaded (3 files)", pendingQuit: false, cursor: 7, view: "diff" };

  const expired = expireMessage(state);

  assert.strictEqual(expired.cursor, 7);
  assert.strictEqual(expired.view, "diff");
});

test("waits a few seconds, not a moment and not a minute", () => {
  assert.ok(MESSAGE_TIMEOUT_MS >= 2000, "too short to read");
  assert.ok(MESSAGE_TIMEOUT_MS <= 10000, "too long to wait for the keys");
});

// --- the footer either side of it -------------------------------------------

test("a message hides the keys, and expiring gives them back", (t) => {
  const root = makeRepo(t);
  const state = createState(root, "review", 179);

  const staged = { ...state, message: "Staged every change" };
  const footer = footerOf(staged);
  assert.strictEqual(footer.length, 1, "the width was measured wrong");
  assert.doesNotMatch(footer[0], /j\/k/, "the message did not take the row");

  assert.match(footerOf(expireMessage(staged)).join(" "), /j\/k/);
});

test("a message takes a row from the keys without taking the keys on it", (t) => {
  // Arrange: a width the list needs several rows for, which is every real terminal
  const root = makeRepo(t);
  const state = createState(root, "review", 100);
  const quiet = toScreenModel(state);
  const rows = footerOf(state, 100);

  // Act
  const said = { ...state, message: "Staged every change" };
  const withMessage = footerOf(said, 100);

  // Assert: the footer is the same height, and says so on its first row
  assert.ok(rows.length > 1, "the width was chosen wrong: the list fits on one row");
  assert.strictEqual(withMessage.length, rows.length);
  assert.strictEqual(withMessage[0], "Staged every change");

  // And the keys that were on the row it took are still named somewhere
  const shown = withMessage.slice(1).join("  ");
  const first = rows[0].split("  ")[0];
  assert.ok(
    shown.includes(first),
    `${JSON.stringify(first)} was dropped with the row the message took`
  );

  // What no longer fits says so, rather than going quietly
  const kept = shown.split("  ");
  const missing = quiet.help.split("  ").filter((item) => !kept.includes(item));
  assert.ok(
    missing.length === 0 || shown.includes(OVERFLOW),
    "keys went missing and the footer never said so"
  );
});

test("a footer of one row has nowhere to put the keys, and says the message alone", (t) => {
  // Arrange: the width the whole list fits on, which is what widthForOneRow measures
  const root = makeRepo(t);
  const state = { ...createState(root, "review", 179), message: "Staged every change" };

  // Act
  const footer = footerOf(state);

  // Assert
  assert.deepStrictEqual(footer, ["Staged every change"]);
});

test("a keystroke still clears a message, as it always did", (t) => {
  const root = makeRepo(t);
  const state = { ...createState(root, "review", 179), message: "Staged every change" };

  assert.strictEqual(reduce(state, "j", VIEWPORT).message, null);
});

// --- the pane really does put them back on its own --------------------------

test("the pane restores the key list without a keystroke", (t) => {
  // Everything above is pure; this is the part that only shows up in a process.
  // The pane is driven with a real stdin, sent A, then left alone.
  const root = makeRepo(t);
  const driver = path.join(root, "drive.js");

  fs.writeFileSync(
    driver,
    [
      "const { spawn } = require('node:child_process');",
      `const child = spawn(process.execPath, ['${path.join(__dirname, "..", "bin", "review.js")}'], {`,
      `  env: { ...process.env, HERDR_DEEP_CODE_READING_REPO: ${JSON.stringify(root)}, HERDR_DEEP_CODE_READING_MODE: 'review',`,
      "    COLUMNS: '179', LINES: '24' },",
      "  stdio: ['pipe', 'pipe', 'inherit'],",
      "});",
      "let out = '';",
      "child.stdout.on('data', (d) => { out += d.toString(); });",
      "setTimeout(() => child.stdin.write('A'), 250);",
      // Long enough that the timer must have fired if it is going to
      `setTimeout(() => { child.stdin.write('Q'); }, ${MESSAGE_TIMEOUT_MS + 1200});`,
      "child.on('exit', () => { process.stdout.write(out); });",
    ].join("\n")
  );

  const result = spawnSync(process.execPath, [driver], {
    encoding: "utf8",
    timeout: MESSAGE_TIMEOUT_MS + 8000,
  });

  // Each frame begins by homing the cursor, so that is where one ends and the next
  // starts. Only the last one says what the reader was left looking at.
  const HOME = "[H";
  const frames = (result.stdout || "")
    .split(HOME)
    .map((frame) => frame.replace(/\[[0-9;?]*[A-Za-z~]/g, ""))
    .filter((frame) => frame.trim() !== "");

  assert.ok(
    frames.some((frame) => frame.includes("Staged every change")),
    "the message never appeared at all"
  );

  const last = frames[frames.length - 1];
  assert.doesNotMatch(
    last,
    /Staged every change/,
    "the message was still on screen after waiting, with no keystroke to clear it"
  );
  // The first row rather than the last: at eighty columns the list runs past the four
  // rows a footer is allowed and ends with the key that shows the rest — see
  // lib/help-layout. What this is about is the footer coming back at all.
  assert.match(last, /j\/k/, "the key list never came back");
});
