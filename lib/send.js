"use strict";

// Handing review comments to a coding agent running in another Herdr pane.
//
// The comments are written into the agent's input without submitting, then the pane
// is focused, so the reviewer reads and edits the batch before sending it. Nothing
// is submitted on the reviewer's behalf.

const { spawnSync } = require("node:child_process");

const { sanitize } = require("./text");

const PASTE_START = "\u001b[200~";
const PASTE_END = "\u001b[201~";

/**
 * Wrap text for a bracketed paste.
 *
 * A raw newline reaches the receiving pane as Enter, so a multi-line batch has to
 * be pasted rather than typed.
 *
 * The batch quotes lines from the repository under review, which may hold any bytes
 * at all. Every control character except tab and newline is stripped before
 * wrapping: a pane that has not enabled bracketed paste would otherwise interpret
 * an escape sequence embedded in the reviewed source, and a stray paste terminator
 * would end the paste early and let the remainder run as input.
 */
function wrapForPaste(text) {
  return PASTE_START + sanitize(text) + PASTE_END;
}

/**
 * Read the agent array out of a `herdr agent list` response.
 * A parse failure is reported rather than reduced to an empty list: the caller
 * would otherwise tell the user that no agent exists, which is the wrong reason.
 * @returns {{ok: boolean, agents: Array<object>, error: string|null}}
 */
function parseAgentList(stdout) {
  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch (error) {
    return { ok: false, agents: [], error: `could not parse the response: ${error.message}` };
  }

  const agents = parsed && parsed.result && parsed.result.agents;
  if (!Array.isArray(agents)) {
    return { ok: false, agents: [], error: "the response carried no agent list" };
  }

  return { ok: true, agents, error: null };
}

/**
 * Narrow the agent list to usable targets.
 * Placement never narrows the set: any agent pane in the workspace is a candidate.
 */
function candidateAgents(agents, options) {
  const { workspaceId, excludePaneId } = options || {};

  return agents.filter((agent) => {
    if (!agent.pane_id) {
      return false;
    }
    if (excludePaneId && agent.pane_id === excludePaneId) {
      return false;
    }
    if (workspaceId && agent.workspace_id !== workspaceId) {
      return false;
    }
    return true;
  });
}

/** One-line description of an agent, for the picker. */
function agentLabel(agent) {
  const title = agent.terminal_title_stripped || agent.pane_id;
  return `${agent.agent}  ${agent.agent_status || "unknown"} · ${title}`;
}

function runHerdr(herdrBin, args) {
  const result = spawnSync(herdrBin, args, { encoding: "utf8" });

  if (result.error) {
    return { ok: false, stdout: "", error: result.error.message };
  }
  if (result.status !== 0) {
    // The message reaches the footer as-is, so an empty stderr has to say something
    const detail = (result.stderr || "").trim();
    return { ok: false, stdout: "", error: detail || `herdr ${args[0]} exited with ${result.status}` };
  }
  return { ok: true, stdout: result.stdout || "", error: null };
}

/** Every agent Herdr currently knows about. */
function listAgents(herdrBin) {
  const result = runHerdr(herdrBin, ["agent", "list"]);
  if (!result.ok) {
    return { ok: false, agents: [], error: result.error };
  }
  return parseAgentList(result.stdout);
}

/** Paste a batch into a pane's input without submitting it, then focus the pane. */
function sendToPane(herdrBin, paneId, text) {
  const written = runHerdr(herdrBin, ["pane", "send-text", paneId, wrapForPaste(text)]);
  if (!written.ok) {
    return written;
  }
  // Focusing is a convenience; a failure here does not undo the write
  runHerdr(herdrBin, ["pane", "focus", paneId]);
  return { ok: true, error: null };
}

module.exports = {
  PASTE_END,
  PASTE_START,
  agentLabel,
  candidateAgents,
  listAgents,
  parseAgentList,
  sendToPane,
  wrapForPaste,
};
