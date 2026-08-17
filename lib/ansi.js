"use strict";

// ANSI escape sequences and the color palette. No external library is used.

const { themeNamed } = require("./themes");

const ESC = "\u001b";
const CSI = ESC + "[";

const RESET = CSI + "0m";
const BOLD = CSI + "1m";
const DIM = CSI + "2m";
const REVERSE = CSI + "7m";

const screen = {
  enterAlt: CSI + "?1049h",
  leaveAlt: CSI + "?1049l",
  hideCursor: CSI + "?25l",
  showCursor: CSI + "?25h",
  clear: CSI + "2J",
  home: CSI + "H",
  eraseToEnd: CSI + "0K",
};

/** Move the cursor to a 1-based row and column. */
function moveTo(row, column) {
  return CSI + row + ";" + column + "H";
}

const FOREGROUND = "38";
const BACKGROUND = "48";
const HEX_CHANNELS = [1, 3, 5];

/** The three channels of a #rrggbb, as numbers. */
function channelsOf(hex) {
  return HEX_CHANNELS.map((at) => parseInt(hex.slice(at, at + 2), 16));
}

// One escape sequence per colour, built once. The renderer asks for a colour several
// hundred times a frame and the palette is settled at startup, so every one of those
// after the first is the same handful of strings being taken apart and put back
// together — a hex sliced into three, parsed, and joined again, for a frame that will
// ask for it again on the next keystroke. The palette is a few dozen entries, so the
// table stops growing almost immediately.
const SEQUENCES = new Map();

/**
 * A colour, in whichever of the two forms the palette wrote it.
 *
 * A number is an index into the terminal's own 256-colour palette, which lets a
 * user's terminal theme have its say. A #rrggbb is the colour itself, which is what
 * a palette defined in hex needs to keep its hues — see lib/themes.
 */
function color(value, layer) {
  const key = layer + String(value);
  const known = SEQUENCES.get(key);
  if (known !== undefined) {
    return known;
  }

  const sequence =
    typeof value === "string"
      ? CSI + layer + ";2;" + channelsOf(value).join(";") + "m"
      : CSI + layer + ";5;" + value + "m";
  SEQUENCES.set(key, sequence);
  return sequence;
}

function fg(value) {
  return color(value, FOREGROUND);
}

function bg(value) {
  return color(value, BACKGROUND);
}

// The palette in use, settled once at startup. HERDR_DEEP_CODE_READING_THEME names one; without
// it, a terminal that says it can draw a colour exactly gets the one written in hex.
const theme = themeNamed(process.env.HERDR_DEEP_CODE_READING_THEME, process.env);

// Whether the row under the cursor is drawn as a band of colour across its width.
// Settled here beside the palette and for the same reason: the renderer asks this of
// every row of every frame, and it cannot change while a pane is open.
const cursorLine = process.env.HERDR_DEEP_CODE_READING_CURSORLINE !== "false";

// Whether the words that changed within a changed line are picked out. Settled here
// for the same reason as the palette and the band.
const wordDiff = process.env.HERDR_DEEP_CODE_READING_WORDDIFF !== "false";

/** Wrap text in the given colors and attributes. Omitted options are skipped. */
function paint(text, options) {
  const opened =
    (options.bg === undefined ? "" : bg(options.bg)) +
    (options.fg === undefined ? "" : fg(options.fg)) +
    (options.bold ? BOLD : "") +
    (options.dim ? DIM : "") +
    (options.reverse ? REVERSE : "");

  if (opened === "") {
    return text;
  }
  return opened + text + RESET;
}

module.exports = {
  ESC,
  RESET,
  bg,
  cursorLine,
  fg,
  moveTo,
  paint,
  screen,
  theme,
  wordDiff,
};
