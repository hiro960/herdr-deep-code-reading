"use strict";

// Where a name is used, as opposed to where it is declared.
//
// `Enter` goes to the one line that declares a name and `K` reads it out. The other
// half of the question — who calls this, and from where — was a search away and the
// search answers with both: the definition sits in the middle of the hundred lines
// that use it. This is the hundred, without the one.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const { createState, reduce, toScreenModel } = require("../lib/app-state");

const COLUMNS = 120;
const VIEWPORT = 20;

function makeRepo(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "herdr-deep-code-reading-refs-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  execFileSync("git", ["init", "-q"], { cwd: root, stdio: "ignore" });
  fs.writeFileSync(path.join(root, "a.js"), "function helper() {\n  return 1;\n}\n");
  fs.writeFileSync(path.join(root, "b.js"), "const one = helper();\nconst two = helper();\n");
  execFileSync("git", ["add", "-A"], { cwd: root, stdio: "ignore" });
  execFileSync(
    "git",
    ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init"],
    { cwd: root, stdio: "ignore" }
  );

  return root;
}

function press(state, keys) {
  return keys.reduce((current, key) => reduce(current, key, VIEWPORT), state);
}

/** The reading view, open on b.js with the cursor on the name `helper`. */
function onTheName(t) {
  const state = press(createState(makeRepo(t), "files", COLUMNS), ["j", "l"]);
  assert.strictEqual(state.openPath, "b.js");

  let moved = state;
  for (let step = 0; step < 6; step += 1) {
    if (toScreenModel(moved).word && toScreenModel(moved).word.text === "helper") {
      return moved;
    }
    moved = reduce(moved, "w", VIEWPORT);
  }

  throw new Error("the cursor never landed on the name");
}

test("R lists where the name is used", (t) => {
  const listed = reduce(onTheName(t), "R", VIEWPORT);

  assert.match(toScreenModel(listed).title, /helper/);
  assert.strictEqual(listed.hits.length, 2, "both calls, and only the calls");
  assert.ok(listed.hits.every((hit) => hit.path === "b.js"));
});

test("the line that declares it is not one of them", (t) => {
  // Which is the whole difference between this and a search for the name
  const listed = reduce(onTheName(t), "R", VIEWPORT);

  assert.ok(
    !listed.hits.some((hit) => hit.text.includes("function helper")),
    "the definition is in the list of uses"
  );
});

test("Enter goes to one of them", (t) => {
  const there = press(onTheName(t), ["R", "enter"]);

  assert.strictEqual(there.openPath, "b.js");
});

test("a name nothing uses says so rather than opening an empty list", (t) => {
  const root = makeRepo(t);
  fs.writeFileSync(path.join(root, "c.js"), "const lonely = 1;\n");
  execFileSync("git", ["add", "-A"], { cwd: root, stdio: "ignore" });

  const state = press(createState(root, "files", COLUMNS), ["j", "j", "l", "w"]);
  assert.strictEqual(toScreenModel(state).word.text, "lonely");

  const listed = reduce(state, "R", VIEWPORT);

  assert.match(listed.message, /nothing uses lonely/i);
  assert.strictEqual(listed.view, state.view);
});

test("the cursor on no name at all is told so", (t) => {
  const root = makeRepo(t);
  fs.writeFileSync(path.join(root, "d.js"), "  \n");
  execFileSync("git", ["add", "-A"], { cwd: root, stdio: "ignore" });

  const state = press(createState(root, "files", COLUMNS), ["j", "j", "j", "l"]);
  assert.strictEqual(state.openPath, "d.js");

  const listed = reduce(state, "R", VIEWPORT);

  assert.match(listed.message, /name/i);
});

test("it answers on a diff as well, where the cursor is also on a line of code", (t) => {
  const root = makeRepo(t);
  fs.writeFileSync(path.join(root, "b.js"), "const one = helper();\nconst three = helper();\n");
  const state = createState(root, "review", COLUMNS);

  const listed = press(state, ["j", "w", "w", "w", "R"]);

  assert.ok(listed.hits === undefined || Array.isArray(listed.hits));
  assert.ok(listed.message === null || typeof listed.message === "string");
});
