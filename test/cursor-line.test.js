"use strict";

// The row the reader is on, painted across its whole width.
//
// A terminal cannot make one line taller or wider than the others — the grid is one
// size everywhere — so the row under the cursor is marked by colour instead. The hard
// part is not the colour, it is the coverage: paint() closes every run with a reset,
// so any piece of the row drawn as a bare string shows the terminal's own background
// through it. The test that matters here walks the escape sequences and asserts there
// is no such hole.

const test = require("node:test");
const assert = require("node:assert");

const { bg, theme } = require("../lib/ansi");
const { renderDiffBody, renderGutter } = require("../lib/render/diff-rows");
const { displayWidth } = require("../lib/text");

const SGR = /\[[0-9;]*m/g;
const WIDTH = 48;

/** A row of file contents, with syntax tokens the way the reading view builds them. */
function tokenRow(text) {
  return {
    kind: "line",
    cell: {
      num: 12,
      text,
      type: "context",
      tokens: [
        { type: "keyword", text: "const" },
        { type: undefined, text: " x = " },
        { type: "number", text: "1" },
      ],
    },
  };
}

function lineRow(type, text) {
  return { kind: "line", cell: { num: 7, text, type } };
}

function pairRow(left, right) {
  return { left, right };
}

/** The visible characters of a painted row, with the escapes taken out. */
function plain(painted) {
  return painted.replace(SGR, "");
}

/**
 * Every run of visible text in a painted string, paired with whether a background
 * colour was in force while it was written.
 *
 * SGR 0 closes everything, and `48;5;n` / `48;2;r;g;b` open a background. Nothing here
 * opens one any other way, so tracking those two is enough to answer the question.
 */
function runs(painted) {
  const found = [];
  let background = false;
  let at = 0;

  for (const match of painted.matchAll(SGR)) {
    const text = painted.slice(at, match.index);
    if (text !== "") {
      found.push({ text, background });
    }
    const codes = match[0].slice(2, -1);
    if (codes === "" || codes === "0") {
      background = false;
    } else if (/(^|;)48;/.test(codes)) {
      background = true;
    }
    at = match.index + match[0].length;
  }

  const tail = painted.slice(at);
  if (tail !== "") {
    found.push({ text: tail, background });
  }
  return found;
}

/** What the row shows through: the characters written with no background behind them. */
function holes(painted) {
  return runs(painted)
    .filter((run) => !run.background)
    .map((run) => run.text)
    .join("");
}

// --- the invariant that matters ----------------------------------------------

const EVERY_KIND = [
  ["a line of file contents", tokenRow("const x = 1")],
  ["a context line", lineRow("context", "  return value;")],
  ["an added line", lineRow("add", "  return value;")],
  ["a removed line", lineRow("del", "  return value;")],
  ["a wrapped continuation", { kind: "line", cell: { num: 7, text: "more", type: "context", continues: true } }],
  ["a blamed line", { kind: "line", cell: { num: 7, text: "x", type: "context", blame: "a1b2c3d hq" } }],
  ["a hunk heading", { kind: "hunk", text: "@@ -1,3 +1,3 @@" }],
  ["a search hit", { kind: "hit", hit: { path: "lib/a.js", line: 4, text: "  const x = 1;" } }],
  ["a note", { kind: "note", text: "imports (3)" }],
  ["a paired row", pairRow({ num: 1, text: "old", type: "del" }, { num: 1, text: "new", type: "add" })],
  ["a paired row with one side missing", pairRow(null, { num: 1, text: "new", type: "add" })],
];

for (const [what, row] of EVERY_KIND) {
  const sideBySide = row.kind === undefined;

  test(`the cursor's row leaves no gap in the background: ${what}`, () => {
    const painted = renderDiffBody(row, WIDTH, sideBySide, null, true);

    assert.strictEqual(
      holes(painted),
      "",
      `${what} shows the terminal's own background through the cursor's row`
    );
  });

  test(`marking the cursor's row does not change its width: ${what}`, () => {
    const plainWidth = displayWidth(plain(renderDiffBody(row, WIDTH, sideBySide, null, false)));
    const markedWidth = displayWidth(plain(renderDiffBody(row, WIDTH, sideBySide, null, true)));

    assert.strictEqual(markedWidth, plainWidth, `${what} changed width under the cursor`);
  });

  test(`a row that is not the cursor's is drawn as it was: ${what}`, () => {
    assert.strictEqual(
      renderDiffBody(row, WIDTH, sideBySide, null, false),
      renderDiffBody(row, WIDTH, sideBySide, null),
      `${what} is drawn differently when the flag is omitted`
    );
  });
}

// --- which colour each kind of line takes ------------------------------------

test("a plain line under the cursor takes the cursor row's colour", () => {
  const painted = renderDiffBody(lineRow("context", "  keep"), WIDTH, false, null, true);

  assert.ok(painted.includes(bg(theme.cursorLineBg)), "no cursor row colour");
});

test("an added line under the cursor keeps being an added line", () => {
  const painted = renderDiffBody(lineRow("add", "  added"), WIDTH, false, null, true);

  assert.ok(painted.includes(bg(theme.addCursorBg)), "the add was not lifted");
  assert.ok(!painted.includes(bg(theme.cursorLineBg)), "the add was painted over");
  assert.ok(!painted.includes(bg(theme.addBg)), "the cursor left the add unmarked");
});

test("a removed line under the cursor keeps being a removed line", () => {
  const painted = renderDiffBody(lineRow("del", "  gone"), WIDTH, false, null, true);

  assert.ok(painted.includes(bg(theme.delCursorBg)), "the delete was not lifted");
  assert.ok(!painted.includes(bg(theme.cursorLineBg)), "the delete was painted over");
  assert.ok(!painted.includes(bg(theme.delBg)), "the cursor left the delete unmarked");
});

test("the row the reader is not on carries no cursor colour at all", () => {
  for (const type of ["context", "add", "del"]) {
    const painted = renderDiffBody(lineRow(type, "  line"), WIDTH, false, null, false);

    assert.ok(!painted.includes(bg(theme.cursorLineBg)), `${type} took the cursor colour`);
    assert.ok(!painted.includes(bg(theme.addCursorBg)), `${type} took the add cursor colour`);
    assert.ok(!painted.includes(bg(theme.delCursorBg)), `${type} took the delete cursor colour`);
  }
});

test("syntax colouring survives the cursor's row", () => {
  // The point of marking the row is to read it, so the reading is what must not be
  // lost: the keyword is still a keyword under the band
  const painted = renderDiffBody(tokenRow("const x = 1"), WIDTH, false, null, true);

  assert.ok(painted.includes(bg(theme.cursorLineBg)), "no cursor row colour");
  assert.match(painted, /38;[25];/, "the tokens lost their colours");
  assert.ok(plain(painted).includes("const x = 1"), "the text did not survive");
});

// --- the margin the band starts at -------------------------------------------

test("the band reaches the gutter, so the row starts at the left edge", () => {
  // Two unpainted columns between the file panel and the band would read as a break
  // in the row rather than as the margin they are
  for (const hasComment of [false, true]) {
    const painted = renderGutter(true, hasComment, false);

    assert.strictEqual(holes(painted), "", "the gutter shows through");
    assert.ok(painted.includes(bg(theme.cursorLineBg)), "the gutter is outside the band");
    assert.strictEqual(displayWidth(plain(painted)), 2, "the gutter changed width");
  }
});

test("the gutter of any other row is what it always was", () => {
  for (const isSelected of [false, true]) {
    for (const hasComment of [false, true]) {
      const painted = renderGutter(false, hasComment, isSelected);

      assert.ok(!painted.includes(bg(theme.cursorLineBg)), "a plain row took the band");
      assert.strictEqual(displayWidth(plain(painted)), 2, "the gutter changed width");
    }
  }
});

test("the word under the cursor is still picked out on the cursor's row", () => {
  // Both marks land on the same row by definition, and the narrower one has to win
  // inside its own span or following a name would stop showing where it is
  const word = { start: 2, end: 8 };
  const painted = renderDiffBody(lineRow("context", "  return value;"), WIDTH, false, word, true);

  assert.ok(painted.includes("[7m"), "the word cursor is gone");
  assert.strictEqual(holes(painted), "", "the word cursor punched a hole in the row");
});
