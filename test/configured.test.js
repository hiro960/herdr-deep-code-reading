"use strict";

// What the config file changes, once its settings have reached the environment.
//
// test/config.test.js is about reading the file. This is about the three settings
// that then have to be obeyed somewhere else — the layout a pane opens in, the band
// on the cursor's row, and which editor `E` hands the file to. The palette needs no
// test of its own here: HERDR_DEEP_CODE_READING_THEME was already the way one was chosen, and
// test/themes.test.js is where that lives.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync, spawnSync } = require("node:child_process");

const { createState } = require("../lib/app-state");
const { LAYOUT_SPLIT, LAYOUT_STACKED } = require("../lib/layout");

// Wide enough that the width alone would choose two columns, so a configured stack is
// visibly a decision rather than a coincidence
const SPLIT_COLUMNS = 179;

function makeRepo(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "herdr-deep-code-reading-configured-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

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

/** Run a state through with one variable set, and put the environment back after. */
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

// --- the layout a pane opens in ----------------------------------------------

test("a configured stack is honoured at a width that would have split", (t) => {
  const root = makeRepo(t);
  withEnv(t, "HERDR_DEEP_CODE_READING_LAYOUT", LAYOUT_STACKED);

  const state = createState(root, "review", SPLIT_COLUMNS);

  assert.strictEqual(state.layout, LAYOUT_STACKED);
  assert.strictEqual(state.sideBySide, false, "the pane split anyway");
});

test("a configured split is remembered as a choice, not guessed again", (t) => {
  // The state carries the choice so that a later resize follows it rather than
  // recomputing from the new width — see withLayout
  const root = makeRepo(t);
  withEnv(t, "HERDR_DEEP_CODE_READING_LAYOUT", LAYOUT_SPLIT);

  const state = createState(root, "review", SPLIT_COLUMNS);

  assert.strictEqual(state.layout, LAYOUT_SPLIT);
  assert.strictEqual(state.sideBySide, true);
});

test("with nothing configured the width still decides", (t) => {
  const root = makeRepo(t);
  withEnv(t, "HERDR_DEEP_CODE_READING_LAYOUT", undefined);

  const state = createState(root, "review", SPLIT_COLUMNS);

  assert.strictEqual(state.layout, null, "an unasked-for layout was recorded as a choice");
  assert.strictEqual(state.sideBySide, true);
});

test("a layout nobody has is not a choice", (t) => {
  const root = makeRepo(t);
  withEnv(t, "HERDR_DEEP_CODE_READING_LAYOUT", "diagonal");

  const state = createState(root, "review", SPLIT_COLUMNS);

  assert.strictEqual(state.layout, null, "an unknown name was recorded as a choice");
});

// --- the band on the cursor's row ---------------------------------------------

// The palette and the band are both settled the moment lib/ansi is first required, so
// turning the band off cannot be done inside a process that has already drawn with it
// on. A child is the honest way to ask, and it is what a reader's own pane is.
const BAND_PROBE = `
  const { renderDiffBody } = require(${JSON.stringify(require.resolve("../lib/render/diff-rows"))});
  const row = { kind: "line", cell: { num: 1, text: "  keep", type: "context" } };
  process.stdout.write(JSON.stringify({
    cursor: renderDiffBody(row, 40, false, null, true),
    plain: renderDiffBody(row, 40, false, null, false),
  }));
`;

function probeBand(cursorline) {
  const env = { ...process.env };
  delete env.HERDR_DEEP_CODE_READING_CURSORLINE;
  if (cursorline !== undefined) {
    env.HERDR_DEEP_CODE_READING_CURSORLINE = cursorline;
  }

  const result = spawnSync(process.execPath, ["-e", BAND_PROBE], { env, encoding: "utf8" });
  assert.strictEqual(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

test("cursorline = false draws the cursor's row like any other", () => {
  const { cursor, plain } = probeBand("false");

  assert.strictEqual(cursor, plain, "the band was drawn after being turned off");
});

test("the band is on unless it is turned off", () => {
  for (const setting of [undefined, "true", "yes", ""]) {
    const { cursor, plain } = probeBand(setting);

    assert.notStrictEqual(cursor, plain, `${JSON.stringify(setting)} turned the band off`);
  }
});
