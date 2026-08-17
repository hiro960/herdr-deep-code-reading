"use strict";

// The terminal itself: how big it is, how much of it the body gets, and giving it up
// and taking it back.
//
// Everything here talks to process.stdout and process.stdin directly. It is the only
// place in lib/ that does, which is what lets the rest be tested without one.

const { screen } = require("../ansi");
const { FALLBACK_COLUMNS } = require("../layout");
const { helpText, stickyFor } = require("../app-state");
const { chromeRows } = require("../render");

const FALLBACK_ROWS = 24;

// The frame never writes into the final column.
//
// Two reasons, and either would be enough. The first is auto-wrap: a character put in
// the last cell of a row leaves the terminal holding a pending wrap, and the next thing
// written goes to the row below — the classic way a full-width frame comes out one row
// short of itself, differently on every terminal.
//
// The second is that a host can be wrong about its own width, and one was: a pane
// reported 152 columns through the pty and drew 151 of them, so every row the frame
// filled lost its last cell on the way to the screen. A wrapped line lost the character
// the wrap had carefully moved to the next row — one per wrap, silently, in the one tool
// that must show a file exactly as it is. Nothing inside a pane can see that happen.
//
// So one column is given up, everywhere, by the one function the whole frame asks for
// its width. It costs a column of a hundred and fifty and it costs the same column to
// every part of the frame at once, which is what keeps the wrap and the draw agreeing.
const LAST_COLUMN_MARGIN = 1;

function terminalSize() {
  const reported = process.stdout.columns || FALLBACK_COLUMNS;
  return {
    columns: Math.max(1, reported - LAST_COLUMN_MARGIN),
    rows: process.stdout.rows || FALLBACK_ROWS,
  };
}

/**
 * Rows the body has, given what the footer needs for the state it is describing.
 * The footer carries every key the view binds, so it wraps — and the scroll model
 * has to size itself from the same calculation the frame draws with.
 */
function viewportHeight(state) {
  const size = terminalSize();
  // Only the parts of a frame that take rows are handed over. Building a whole screen
  // model to ask would tie the scroll model to every part of the state a frame happens
  // to draw — but every one of these has to be here, because a body measured one row
  // taller than it is drawn is a cursor that can sit on a row nobody can see.
  const chrome = chromeRows(
    { help: helpText(state), input: state.input, sticky: stickyFor(state) },
    size.columns
  );
  return Math.max(1, size.rows - chrome);
}

function enterFullScreen() {
  process.stdout.write(screen.enterAlt + screen.hideCursor + screen.clear);
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
  }
  process.stdin.resume();
}

function leaveFullScreen() {
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(false);
  }
  process.stdout.write(screen.showCursor + screen.leaveAlt);
}

// Giving the terminal up and taking it back, as one thing that can be handed to
// editFile. The test for it drives a real editor through a real spawn, and would
// otherwise leave the runner holding a resumed stdin it never asked for.
const FULL_SCREEN = { leave: leaveFullScreen, enter: enterFullScreen };

module.exports = {
  FULL_SCREEN,
  LAST_COLUMN_MARGIN,
  enterFullScreen,
  leaveFullScreen,
  terminalSize,
  viewportHeight,
};
