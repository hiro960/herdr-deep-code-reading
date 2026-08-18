"use strict";

// One key at a time, folded into the state.
//
// A chunk of stdin can carry several keys — a held-down j, a pasted line — so each is
// applied in turn and the screen is drawn once at the end rather than once per key.

const { reduce } = require("../app-state");
const { decodeKeys } = require("../input");
const { performEffect } = require("./effects");
const { viewportHeight } = require("./terminal");

// The effects that end in the pane reading the repository again, and the key that does
// it on its own. Together they are every way a key press leaves the pane holding a
// newer repository than the watcher's last fingerprint — which is what the watcher has
// to be told about, so that its next tick does not announce work already on screen.
// A pull moves HEAD and the files under it, and a fetch moves the copies the branch
// counts are read from; both end in the pane reading the repository again, so both
// belong here beside the writes.
const REFRESHING_EFFECTS = new Set([
  "stage",
  "stage-all",
  "commit",
  "edit",
  "fetch",
  "pull",
  "push",
  // Settling a merge moves the index and the files both, and finishing or undoing one
  // moves HEAD as well
  "resolve",
  "commit-merge",
  "abort-merge",
]);
const RELOAD_KEY = "r";

/**
 * Whether a key press reloaded the pane from the repository.
 *
 * Asked of the key and the effect rather than of the files it left behind. Loading a
 * commit's diff changes the files too — the log does it on every step down the graph —
 * and calling that a reload would have the watcher record a repository the reader has
 * never been shown, swallowing the very commit they turned the watch on to see.
 */
function refreshesFromTheRepository(key, effectType) {
  return key === RELOAD_KEY || REFRESHING_EFFECTS.has(effectType);
}

/**
 * One key, applied to a state.
 *
 * Never throws. A key that fails is not a reason to take the pane down with the
 * review inside it: the reviewer's comments are worth more than the keystroke, and
 * everything they have written so far is still in the state this returns. What went
 * wrong goes to the footer, and the next key still works.
 *
 * @param {number} [viewport] Body rows; measured from the terminal when omitted
 * @returns {object} The next state; the same reference when nothing changed
 */
function applyKey(state, key, runtime, viewport) {
  try {
    const rows = viewport === undefined ? viewportHeight(state) : viewport;
    const reduced = reduce(state, key, rows);
    if (reduced.quit) {
      return reduced;
    }

    // Read before the effect is performed, which is what clears it
    const effect = reduced.effect === null || reduced.effect === undefined ? null : reduced.effect.type;
    const done = performEffect(reduced, runtime);

    if (runtime && runtime.watcher && refreshesFromTheRepository(key, effect)) {
      runtime.watcher.sync();
    }
    return done;
  } catch (error) {
    return { ...state, message: `That key failed: ${error.message}`, effect: null };
  }
}

/**
 * Apply every key in one stdin chunk, then redraw once if anything moved.
 *
 * Whether the last chunk ended in the middle of a paste is kept on the session, beside
 * the state the handlers share. stdin does not promise to deliver a paste whole, and a
 * paste that resumed as keystrokes would be the very failure bracketed paste exists to
 * prevent — see lib/input.
 */
function handleInput(session, runtime, data) {
  let changed = false;

  const decoded = decodeKeys(data, session.pasting === true);
  session.pasting = decoded.pasting;

  for (const key of decoded.keys) {
    const next = applyKey(session.state, key, runtime);
    if (next.quit) {
      runtime.shutdown(0);
      return;
    }
    if (next !== session.state) {
      session.state = next;
      changed = true;
    }
  }

  if (changed) {
    runtime.draw();
  }
}

module.exports = {
  applyKey,
  handleInput,
};
