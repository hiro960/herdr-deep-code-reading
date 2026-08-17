"use strict";

// What the repository is allowed to put on the terminal.
//
// Every string on screen that did not come from this program came from somewhere that
// answers to whoever wrote the repository: a file name, a commit subject, the author of
// a commit, a note an agent left. git hands all four back verbatim — its `-z` output is
// unquoted by definition, and `core.quotePath` has nothing to say about it — so a file
// named with an escape sequence in it arrives here as one.
//
// A pane that drew it would be a pane the repository can repaint. That matters more
// here than in most programs: this one exists to show a reader what a change does, and
// a change that can move the cursor can show them something other than itself. The
// terminal is also an input — a sequence that asks it a question is answered on stdin,
// where lib/input reads keys.
//
// So the invariant every one of these holds is the same. Take a rendered row, remove
// the colours this program itself writes, and nothing that is not printable may be left.

const test = require("node:test");
const assert = require("node:assert");

const { displayWidth } = require("../lib/text");
const { renderEntryRow } = require("../lib/render/browse");
const { renderDiffBody, renderHitRow } = require("../lib/render/diff-rows");
const { renderFooter, renderHeader } = require("../lib/render/chrome");
const { renderCommitRow } = require("../lib/render/log");
const { renderPanelRow } = require("../lib/render/panel");

// Written by code point rather than as literals: a test file about control characters
// is the last file that should carry any.
const ESC = String.fromCharCode(0x1b);
const BELL = String.fromCharCode(0x07);
// The 8-bit form of CSI. A terminal reading UTF-8 may still act on it, and it is not
// an escape character, so a guard written against ESC alone lets it through.
const CSI_8BIT = String.fromCharCode(0x9b);

const CLEAR_SCREEN = ESC + "[2J";
const SET_TITLE = ESC + "]0;pwned" + BELL;

// The colours this program writes, which are the only escapes a row may carry
const SGR = new RegExp(ESC + "\\[[0-9;]*m", "g");

const TAB = 0x09;
const LAST_C0 = 0x1f;
const DELETE = 0x7f;
const FIRST_C1 = 0x80;
const LAST_C1 = 0x9f;

const WIDTH = 60;

/** The first character a terminal would act on rather than draw, or null. */
function firstControl(text) {
  for (const char of text) {
    const code = char.codePointAt(0);
    if (code === TAB) {
      continue; // Expanded rather than stripped — see lib/text
    }
    if (code <= LAST_C0 || code === DELETE || (code >= FIRST_C1 && code <= LAST_C1)) {
      return char;
    }
  }
  return null;
}

/** A rendered row with the styling this program added taken back out. */
function visible(row) {
  return row.replace(SGR, "");
}

function assertClean(row, what) {
  const found = firstControl(visible(row));
  assert.strictEqual(
    found,
    null,
    `${what} let ${JSON.stringify(found)} through to the terminal`
  );
}

test("a file name carrying an escape sequence cannot repaint the panel", () => {
  const entry = {
    label: `src/${CLEAR_SCREEN}owned.js`,
    status: "M ",
    added: 1,
    deleted: 0,
    comments: 0,
  };

  assertClean(renderPanelRow(entry, WIDTH, false, false), "the file panel");
  assertClean(renderPanelRow(entry, WIDTH, true, true), "the selected panel row");
});

test("a file name carrying an escape sequence cannot repaint the browser", () => {
  const entry = { name: `${CLEAR_SCREEN}owned.js`, isDirectory: false };

  assertClean(renderEntryRow(entry, WIDTH, false), "a browser entry");
});

test("a search hit cannot repaint the pane through its path", () => {
  const hit = { path: `src/${CLEAR_SCREEN}owned.js`, line: 3, text: "const x = 1;" };

  assertClean(renderHitRow(hit, WIDTH, undefined), "a search hit's location");
});

test("a note cannot repaint the pane through the label an agent wrote", () => {
  // The notes file is written by something that is not the reader, and bin/note.js
  // takes `--from` from whoever ran it
  const hit = { path: "a.js", line: 1, label: `agent${SET_TITLE}`, text: "it caches" };

  assertClean(renderHitRow(hit, WIDTH, undefined), "a note's label");
});

test("a note's own text cannot repaint the pane", () => {
  const row = { kind: "note", text: `answered${SET_TITLE}` };

  assertClean(renderDiffBody(row, WIDTH, false), "a note row");
});

test("a commit subject cannot repaint the header", () => {
  const model = { title: `abc1234 subject${SET_TITLE}`, subtitle: `${CLEAR_SCREEN}branch` };

  assertClean(renderHeader(model, WIDTH), "the header");
});

test("a commit author cannot repaint the log", () => {
  const commit = {
    shortSha: "abc1234",
    subject: `subject${CLEAR_SCREEN}`,
    author: `me${SET_TITLE}`,
    date: "2026-08-16",
    refs: [],
  };

  assertClean(renderCommitRow(commit, 120, false), "a commit row");
  assertClean(renderCommitRow(commit, 120, true), "the commit row under the cursor");
});

test("a file name cannot repaint the pane through the comment field's label", () => {
  const model = {
    input: { kind: "comment", file: `src/${CLEAR_SCREEN}owned.js`, start: 1, end: 1, text: "why?" },
    help: "",
  };

  for (const row of renderFooter(model, WIDTH)) {
    assertClean(row, "the comment field");
  }
});

test("the eight-bit form of CSI is stripped as well as the escape character", () => {
  const entry = {
    label: `src/${CSI_8BIT}2Jowned.js`,
    status: "M ",
    added: 1,
    deleted: 0,
    comments: 0,
  };

  assertClean(renderPanelRow(entry, WIDTH, false, false), "the file panel");
});

test("a row carrying escapes is still exactly as wide as it was asked to be", () => {
  // The width invariant is the other half of this. An escape counts as one column to
  // anything measuring characters and none to the terminal drawing them, so a row
  // holding one came out narrower than the frame had allowed for.
  const entry = {
    label: `src/${CLEAR_SCREEN}owned.js`,
    status: "M ",
    added: 1,
    deleted: 0,
    comments: 0,
  };

  assert.strictEqual(displayWidth(visible(renderPanelRow(entry, WIDTH, false, false))), WIDTH);
  assert.strictEqual(
    displayWidth(visible(renderEntryRow({ name: `a${CLEAR_SCREEN}.js` }, WIDTH, false))),
    WIDTH
  );
  assert.strictEqual(
    displayWidth(visible(renderHeader({ title: `t${CLEAR_SCREEN}`, subtitle: "s" }, WIDTH))),
    WIDTH
  );
});
