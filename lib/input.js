"use strict";

// Normalizes the bytes arriving on a raw-mode stdin into key names.
//
// stdin does not deliver one key per chunk. Fast typing and pasting arrive as a single
// chunk holding several keys, so a chunk has to be split into individual keys.

const { ESC } = require("./ansi");

const SEQUENCES = new Map([
  [ESC + "[A", "up"],
  [ESC + "[B", "down"],
  [ESC + "[C", "right"],
  [ESC + "[D", "left"],
  [ESC + "[H", "home"],
  [ESC + "[F", "end"],
  [ESC + "[5~", "pageup"],
  [ESC + "[6~", "pagedown"],
  [ESC + "OA", "up"],
  [ESC + "OB", "down"],
  [ESC + "OC", "right"],
  [ESC + "OD", "left"],
  [ESC, "escape"],
  ["\r", "enter"],
  ["\n", "enter"],
  ["\t", "tab"],
  ["\u0002", "ctrl-b"],
  ["\u0003", "ctrl-c"],
  ["\u0004", "ctrl-d"],
  ["\u0006", "ctrl-f"],
  ["\u000f", "ctrl-o"],
  ["\u0012", "ctrl-r"],
  ["\u0015", "ctrl-u"],
  ["\u007f", "backspace"],
]);

// Match longer sequences first so a lone ESC does not swallow a longer one.
// A zero-length key would loop forever in decodeKeys, so it is filtered out here.
const SEQUENCES_BY_LENGTH = [...SEQUENCES.keys()]
  .filter((sequence) => sequence.length > 0)
  .sort((a, b) => b.length - a.length);

function toText(data) {
  return typeof data === "string" ? data : data.toString("utf8");
}

/** Longest known sequence starting at the given index, or null. */
function matchSequence(text, index) {
  for (const sequence of SEQUENCES_BY_LENGTH) {
    if (text.startsWith(sequence, index)) {
      return { key: SEQUENCES.get(sequence), length: sequence.length };
    }
  }
  return null;
}

/**
 * Split an input chunk into individual key names.
 * @param {Buffer|string} data
 * @returns {Array<string>}
 */
function decodeKeys(data) {
  const text = toText(data);
  const keys = [];
  let index = 0;

  while (index < text.length) {
    const matched = matchSequence(text, index);
    if (matched !== null) {
      keys.push(matched.key);
      index += matched.length;
      continue;
    }

    // Advance by code point so surrogate pairs are not split
    const char = String.fromCodePoint(text.codePointAt(index));
    keys.push(char);
    index += char.length;
  }

  return keys;
}

/**
 * Convert an input chunk into a single key name.
 * Unknown sequences are returned unchanged.
 * @param {Buffer|string} data
 * @returns {string}
 */
function decodeKey(data) {
  const text = toText(data);
  const known = SEQUENCES.get(text);
  return known === undefined ? text : known;
}

module.exports = { decodeKey, decodeKeys };
