"use strict";

// The part of sending that leaves the process: `herdr agent list` to find out who
// could receive a review, and `herdr pane send-text` to hand it over.
//
// test/send.test.js covers the pure half — parsing the response, narrowing the list,
// wrapping the batch. This is the other half, and it needs a herdr to talk to. It gets
// a stand-in: a real executable that records what it was called with and answers
// however the test told it to. Every function here takes the binary as an argument,
// which is what makes that possible.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { PASTE_END, PASTE_START, listAgents, sendToPane } = require("../lib/send");

const AGENTS = [
  { agent: "claude", pane_id: "w1:p1", agent_status: "idle", workspace_id: "w1" },
];
const AGENT_LIST_JSON = JSON.stringify({ result: { agents: AGENTS } });

/**
 * A stand-in for the herdr binary.
 *
 * Written in the same node that is running the tests, named by its own path rather
 * than through `env`, so it needs nothing of the machine beyond what is already true.
 *
 * @param {object} spec `{ stdout, stderr, status }`, plus `rules` — a list of the
 *   same, each with a `match` tried against the arguments as one string.
 * @returns {{bin: string, calls: function(): Array<Array<string>>}}
 */
function fakeHerdr(t, spec) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "herdr-deep-code-reading-fake-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));

  const bin = path.join(directory, "herdr");
  const log = path.join(directory, "calls.jsonl");

  fs.writeFileSync(
    bin,
    [
      `#!${process.execPath}`,
      '"use strict";',
      'const fs = require("node:fs");',
      `const spec = ${JSON.stringify(spec)};`,
      "const args = process.argv.slice(2);",
      `fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify(args) + "\\n");`,
      'const rule = (spec.rules || []).find((one) => args.join(" ").includes(one.match));',
      "const answer = rule === undefined ? spec : rule;",
      'process.stdout.write(answer.stdout || "");',
      'process.stderr.write(answer.stderr || "");',
      "process.exit(answer.status || 0);",
      "",
    ].join("\n")
  );
  fs.chmodSync(bin, 0o755);

  return {
    bin,
    calls: () => {
      const written = fs.existsSync(log) ? fs.readFileSync(log, "utf8") : "";
      return written
        .split("\n")
        .filter((line) => line !== "")
        .map((line) => JSON.parse(line));
    },
  };
}

// --- asking who is out there --------------------------------------------------

test("the agent list comes back parsed", (t) => {
  const herdr = fakeHerdr(t, { stdout: AGENT_LIST_JSON });

  const result = listAgents(herdr.bin);

  assert.deepStrictEqual(result, { ok: true, agents: AGENTS, error: null });
  assert.deepStrictEqual(herdr.calls(), [["agent", "list"]]);
});

test("what herdr complained about is what the reviewer is told", (t) => {
  const herdr = fakeHerdr(t, { status: 1, stderr: "no server is running\n" });

  const result = listAgents(herdr.bin);

  assert.strictEqual(result.ok, false);
  assert.deepStrictEqual(result.agents, []);
  assert.strictEqual(result.error, "no server is running");
});

test("a failure that says nothing still says something", (t) => {
  // The message reaches the footer as it is, and an empty footer beside a key that
  // visibly did nothing is indistinguishable from a broken key
  const herdr = fakeHerdr(t, { status: 3, stderr: "   \n" });

  const result = listAgents(herdr.bin);

  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.error, "herdr agent exited with 3");
});

test("a herdr that is not there is a reason, not a crash", () => {
  const missing = path.join(os.tmpdir(), "herdr-deep-code-reading-no-such-herdr");

  const result = listAgents(missing);

  assert.strictEqual(result.ok, false);
  assert.deepStrictEqual(result.agents, []);
  assert.match(result.error, /ENOENT/);
});

test("a herdr that answers with something else is not an empty workspace", (t) => {
  // Reducing this to "no agent found" would send the review to a file and tell the
  // reviewer the wrong reason for it
  const herdr = fakeHerdr(t, { stdout: "not json at all" });

  const result = listAgents(herdr.bin);

  assert.strictEqual(result.ok, false);
  assert.match(result.error, /could not parse/);
});

// --- handing the batch over ---------------------------------------------------

test("the batch is pasted, and then the pane is focused", (t) => {
  const herdr = fakeHerdr(t, {});

  const result = sendToPane(herdr.bin, "w1:p1", "one\ntwo");

  assert.deepStrictEqual(result, { ok: true, error: null });
  assert.deepStrictEqual(herdr.calls(), [
    ["pane", "send-text", "w1:p1", PASTE_START + "one\ntwo" + PASTE_END],
    ["pane", "focus", "w1:p1"],
  ]);
});

test("a paste that failed is not followed by a focus", (t) => {
  // Focusing a pane that was never written to would put the reviewer in front of an
  // agent with nothing to read, with the failure behind them
  const herdr = fakeHerdr(t, { status: 1, stderr: "no such pane" });

  const result = sendToPane(herdr.bin, "w9:p9", "note");

  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.error, "no such pane");
  assert.strictEqual(herdr.calls().length, 1, "it focused a pane it had not written to");
});

test("a focus that failed does not undo a paste that worked", (t) => {
  // The comments are in the agent's input either way, and saying the send failed
  // would have the reviewer send them twice
  const herdr = fakeHerdr(t, {
    rules: [{ match: "focus", status: 1, stderr: "pane is gone" }],
  });

  const result = sendToPane(herdr.bin, "w1:p1", "note");

  assert.deepStrictEqual(result, { ok: true, error: null });
  assert.strictEqual(herdr.calls().length, 2);
});

test("control characters in the reviewed source never reach the agent's terminal", (t) => {
  // A quoted line can hold any bytes at all, and an escape sequence among them would
  // be run by a pane that has not enabled bracketed paste
  const herdr = fakeHerdr(t, {});

  sendToPane(herdr.bin, "w1:p1", `before[31mafter${PASTE_END}end`);

  const [, , , pasted] = herdr.calls()[0];
  assert.ok(pasted.startsWith(PASTE_START) && pasted.endsWith(PASTE_END));
  assert.strictEqual(
    pasted.slice(PASTE_START.length, -PASTE_END.length).includes(""),
    false,
    "an escape survived into the paste"
  );
});
