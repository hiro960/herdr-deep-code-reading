"use strict";

// The scroll model and the drawn frame must agree on how tall the body is.
//
// Two places size it: bin/review.js, which tells `reduce` how far a half-page is,
// and renderScreen, which decides how many rows to draw. They are separate call
// sites of the same calculation, so nothing but a test keeps them from drifting —
// and drifting means `d` scrolls past what the reader can see.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const { createState, reduce, toScreenModel } = require("../lib/app-state");
const { chromeRows, renderScreen } = require("../lib/render");

const ESC = "";
const CURSOR = new RegExp(ESC + "\\[\\d+;\\d+H", "g");
const HOME = new RegExp(ESC + "\\[H", "g");
const ERASE = new RegExp(ESC + "\\[0K", "g");
const SGR = new RegExp(ESC + "\\[[0-9;]*m", "g");

const SIZES = [
  { columns: 80, rows: 24 },
  { columns: 100, rows: 30 },
  { columns: 120, rows: 24 },
  { columns: 179, rows: 45 },
  { columns: 240, rows: 60 },
];

function run(cwd, args) {
  execFileSync("git", args, { cwd, stdio: "ignore" });
}

function makeRepo(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "herdr-deep-code-reading-viewport-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  run(root, ["init", "-q"]);
  fs.mkdirSync(path.join(root, "lib"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "lib", "a.js"),
    Array.from({ length: 80 }, (_, line) => `const value${line} = call${line}(arg);`).join("\n") + "\n"
  );
  run(root, ["add", "-A"]);
  run(root, ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init"]);
  fs.appendFileSync(path.join(root, "lib", "a.js"), "const extra = 1;\n");

  return root;
}

/** The same calculation bin/review.js makes before calling reduce. */
function viewportHeight(state, size) {
  return Math.max(1, size.rows - chromeRows(toScreenModel(state), size.columns));
}

/** The rows renderScreen actually drew between the header and the footer. */
function drawnBodyHeight(state, size) {
  const model = toScreenModel(state);
  const lines = renderScreen(model, size)
    .replace(HOME, "")
    .replace(ERASE, "")
    .replace(CURSOR, "\n")
    .replace(SGR, "")
    .replace(/^\n/, "")
    .split("\n");

  return lines.length - chromeRows(model, size.columns);
}

function press(state, keys) {
  return keys.reduce((current, key) => reduce(current, key, 20), state);
}

test("the body the reader scrolls is the body that gets drawn", (t) => {
  const root = makeRepo(t);

  // One state per view, plus the states whose footers are longest
  const states = {
    "diff/panel": createState(root, "review", 179),
    "diff/body": reduce(createState(root, "review", 179), "tab", 20),
    "diff/panel (staged)": createState(root, "staged", 179),
    browse: createState(root, "files", 179),
    read: press(createState(root, "files", 179), ["l", "l"]),
    outline: press(createState(root, "files", 179), ["l", "l", "o"]),
    "writing a comment": press(createState(root, "review", 179), ["tab", "c"]),
    "with a message": reduce(createState(root, "review", 179), "x", 20),
  };

  for (const [label, state] of Object.entries(states)) {
    for (const size of SIZES) {
      assert.strictEqual(
        drawnBodyHeight(state, size),
        viewportHeight(state, size),
        `${label} at ${size.columns}x${size.rows}: the frame and the scroll model disagree`
      );
    }
  }
});

test("a half-page never jumps further than the rows on screen", (t) => {
  // A viewport wider than the drawn body would scroll past what the reader can see
  const root = makeRepo(t);
  const reading = press(createState(root, "files", 179), ["l", "l"]);

  for (const size of SIZES) {
    const viewport = viewportHeight(reading, size);
    const jumped = reduce(reading, "d", viewport);

    assert.ok(
      jumped.cursor - reading.cursor <= viewport,
      `at ${size.columns}x${size.rows}: d moved ${jumped.cursor - reading.cursor} rows into ${viewport}`
    );
    assert.ok(jumped.cursor >= jumped.scroll, "the cursor scrolled out of view");
    assert.ok(jumped.cursor < jumped.scroll + viewport, "the cursor scrolled past the body");
  }
});
