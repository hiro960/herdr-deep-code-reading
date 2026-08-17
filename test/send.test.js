"use strict";

const test = require("node:test");
const assert = require("node:assert");

const { agentLabel, candidateAgents, parseAgentList, wrapForPaste } = require("../lib/send");

const ESC = "\u001b";
const PASTE_START = ESC + "[200~";
const PASTE_END = ESC + "[201~";

const AGENTS = [
  {
    agent: "claude",
    pane_id: "w1:p1",
    agent_status: "idle",
    workspace_id: "w1",
    terminal_title_stripped: "Fix the header",
  },
  {
    agent: "codex",
    pane_id: "w1:p3",
    agent_status: "working",
    workspace_id: "w1",
    terminal_title_stripped: "Port the parser",
  },
  {
    agent: "claude",
    pane_id: "w2:p1",
    agent_status: "idle",
    workspace_id: "w2",
    terminal_title_stripped: "Other workspace",
  },
];

// --- bracketed paste -----------------------------------------------------

test("wraps text in bracketed paste markers", () => {
  // A raw newline is read as Enter by the receiving pane, so multi-line text
  // has to be pasted rather than typed.
  const wrapped = wrapForPaste("a\nb");

  assert.ok(wrapped.startsWith(PASTE_START));
  assert.ok(wrapped.endsWith(PASTE_END));
  assert.ok(wrapped.includes("a\nb"));
});

test("strips a paste terminator hidden inside the text", () => {
  // Otherwise the paste would end early and the rest would execute as input
  const wrapped = wrapForPaste("before" + PASTE_END + "after");

  assert.strictEqual(wrapped.indexOf(PASTE_END), wrapped.length - PASTE_END.length);
});

test("strips a paste introducer hidden inside the text", () => {
  const wrapped = wrapForPaste("before" + PASTE_START + "after");

  assert.strictEqual(wrapped.lastIndexOf(PASTE_START), 0);
});

test("wraps empty text without error", () => {
  assert.strictEqual(wrapForPaste(""), PASTE_START + PASTE_END);
});

// --- agent discovery -----------------------------------------------------

test("parses the agent list response", () => {
  const response = JSON.stringify({ result: { agents: AGENTS } });
  const parsed = parseAgentList(response);

  assert.strictEqual(parsed.ok, true);
  assert.strictEqual(parsed.agents.length, 3);
  assert.strictEqual(parsed.error, null);
});

test("reports a malformed response instead of pretending no agent exists", () => {
  // Answering "no agents" here would send the user to the file export with the
  // wrong reason
  const parsed = parseAgentList("not json");

  assert.strictEqual(parsed.ok, false);
  assert.deepStrictEqual(parsed.agents, []);
  assert.ok(parsed.error);
});

test("reports a response whose shape is unexpected", () => {
  const parsed = parseAgentList(JSON.stringify({ result: {} }));

  assert.strictEqual(parsed.ok, false);
  assert.ok(parsed.error);
});

test("accepts a response that genuinely lists no agents", () => {
  const parsed = parseAgentList(JSON.stringify({ result: { agents: [] } }));

  assert.strictEqual(parsed.ok, true);
  assert.deepStrictEqual(parsed.agents, []);
});

test("keeps only agents in the same workspace", () => {
  const candidates = candidateAgents(AGENTS, { workspaceId: "w1" });

  assert.deepStrictEqual(
    candidates.map((agent) => agent.pane_id),
    ["w1:p1", "w1:p3"]
  );
});

test("excludes the review pane itself", () => {
  const candidates = candidateAgents(AGENTS, { workspaceId: "w1", excludePaneId: "w1:p3" });

  assert.deepStrictEqual(
    candidates.map((agent) => agent.pane_id),
    ["w1:p1"]
  );
});

test("keeps every agent when no workspace is given", () => {
  assert.strictEqual(candidateAgents(AGENTS, {}).length, 3);
});

test("drops entries that carry no pane id", () => {
  const agents = [...AGENTS, { agent: "ghost", workspace_id: "w1" }];

  assert.strictEqual(candidateAgents(agents, { workspaceId: "w1" }).length, 2);
});

test("labels an agent with its kind, status, and title", () => {
  const label = agentLabel(AGENTS[0]);

  assert.match(label, /claude/);
  assert.match(label, /idle/);
  assert.match(label, /Fix the header/);
});

test("labels an agent that has no title", () => {
  const label = agentLabel({ agent: "codex", pane_id: "w1:p9", agent_status: "idle" });

  assert.match(label, /codex/);
  assert.match(label, /w1:p9/);
});
