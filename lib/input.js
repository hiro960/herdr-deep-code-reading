"use strict";

// Normalizes the bytes arriving on a raw-mode stdin into key names.
//
// stdin does not deliver one key per chunk. Fast typing and pasting arrive as a single
// chunk holding several keys, so a chunk has to be split into individual keys.

const { ESC } = require("./ansi");
const { sanitize } = require("./text");

// What a terminal wraps a paste in when it has been asked to — see lib/ansi. Between
// them is text somebody copied from somewhere else, and none of it is a key: a newline
// in a pasted commit message is a line of the message, not the Enter that ends it.
const PASTE_START = ESC + "[200~";
const PASTE_END = ESC + "[201~";

// A paste arrives as one key rather than as its characters, so that a field can take it
// whole and every other screen can leave it alone — a pasted `D` in the browser must
// not arm the delete it names. The NUL opening the name is what keeps it from ever
// colliding with a key a terminal could send.
const PASTE_KEY = "\u0000paste:";

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
 * The text a paste key carries, or null for an ordinary key.
 * Every screen but a field asks this and does nothing when the answer is not null.
 */
function pastedText(key) {
  return typeof key === "string" && key.startsWith(PASTE_KEY) ? key.slice(PASTE_KEY.length) : null;
}

/**
 * Split an input chunk into individual key names.
 *
 * stdin does not promise to deliver a paste whole, so whether the last chunk ended
 * inside one is handed in and handed back: a paste split down the middle would
 * otherwise finish as keystrokes, which is the failure this exists to prevent, only
 * later and larger.
 *
 * @param {Buffer|string} data
 * @param {boolean} [pasting] Whether the previous chunk ended inside a paste
 * @returns {{keys: Array<string>, pasting: boolean}}
 */
function decodeKeys(data, pasting) {
  const text = toText(data);
  const keys = [];
  let index = 0;
  let inside = pasting === true;

  while (index < text.length) {
    if (inside) {
      // Everything to the closing marker is text. Control characters are stripped from
      // it the way they are from everything else this draws — what was copied may have
      // come from anywhere — and the newlines and tabs sanitize leaves are the point.
      const closes = text.indexOf(PASTE_END, index);
      const end = closes === -1 ? text.length : closes;
      keys.push(PASTE_KEY + sanitize(text.slice(index, end)));
      index = closes === -1 ? text.length : closes + PASTE_END.length;
      inside = closes === -1;
      continue;
    }

    if (text.startsWith(PASTE_START, index)) {
      index += PASTE_START.length;
      inside = true;
      continue;
    }

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

  return { keys, pasting: inside };
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

module.exports = { PASTE_KEY, decodeKey, decodeKeys, pastedText };
