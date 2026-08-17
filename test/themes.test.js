"use strict";

// The palettes, and the two forms a colour can be written in.

const test = require("node:test");
const assert = require("node:assert");

const {
  CATPPUCCIN_LATTE,
  CATPPUCCIN_MOCHA,
  CLASSIC,
  CLASSIC_LIGHT,
  THEMES,
  defaultThemeName,
  hasTrueColor,
  themeNamed,
} = require("../lib/themes");
const { bg, fg } = require("../lib/ansi");

const ESC = "";

// Which form each palette is written in. A palette written in hex needs a terminal
// that can be asked for a colour exactly; one written in indices does not.
const INDEXED = [CLASSIC, CLASSIC_LIGHT];
const HEX = [CATPPUCCIN_MOCHA, CATPPUCCIN_LATTE];

// Every name lib/render and lib/ansi reach for. A palette missing one paints
// undefined, which the terminal reads as a colour nobody chose.
const ROLES = [
  "headerBg",
  "headerFg",
  "footerFg",
  "panelFg",
  "panelSelectedBg",
  "panelSelectedFg",
  "panelFocusFg",
  "lineNumberFg",
  "hunkFg",
  "noteFg",
  "addBg",
  "addFg",
  "delBg",
  "delFg",
  // The row the reader is on, which is painted across its whole width. An added or
  // removed line keeps its own colour and is lifted rather than overpainted: the
  // background is what says the line was added, and the cursor must not take that away.
  "cursorLineBg",
  "addCursorBg",
  "delCursorBg",
  // The words within a changed line that actually changed. A third step of the same
  // hue, above the line's own colour and above the cursor's.
  "addWordBg",
  "conflictOursBg",
  "conflictTheirsBg",
  "delWordBg",
  "fillerBg",
  "borderFg",
  "statusAddedFg",
  "statusDeletedFg",
  "statusRenamedFg",
  "statusModifiedFg",
  "tokenComment",
  "tokenString",
  "tokenNumber",
  "tokenKeyword",
  "graphLanes",
  "refHeadFg",
  "refLocalFg",
  "refRemoteFg",
  "refTagFg",
];

/** How light a #rrggbb is, from 0 to 1. Rec. 601 luma, which is close enough to ask
 *  "would black or white read on this" of a palette. */
function brightness(hex) {
  const [r, g, b] = [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16));
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

// The lane colours are a list rather than one value, so the checks below look at what
// is in the list instead of at the list itself.
function colourValues(palette) {
  return Object.entries(palette).flatMap(([role, value]) =>
    Array.isArray(value)
      ? value.map((entry, at) => [`${role}[${at}]`, entry])
      : [[role, value]]
  );
}

// --- every palette answers for every role -----------------------------------

test("every palette names a colour for every role", () => {
  for (const [name, palette] of Object.entries(THEMES)) {
    for (const role of ROLES) {
      assert.notStrictEqual(palette[role], undefined, `${name} has no ${role}`);
    }
  }
});

test("no palette carries a role nobody asks for", () => {
  for (const [name, palette] of Object.entries(THEMES)) {
    for (const role of Object.keys(palette)) {
      assert.ok(ROLES.includes(role), `${name} carries ${role}, which nothing reads`);
    }
  }
});

test("every palette is offered under one of the two forms", () => {
  // A palette in neither list is one nothing below has checked the colours of
  assert.deepStrictEqual([...INDEXED, ...HEX].sort(), Object.keys(THEMES).sort());
});

test("the indexed palettes are written in 256-colour indices", () => {
  for (const name of INDEXED) {
    for (const [role, value] of colourValues(THEMES[name])) {
      assert.strictEqual(typeof value, "number", `${name}'s ${role} is not an index`);
      assert.ok(value >= 0 && value <= 255, `${name}'s ${role} is outside the palette`);
    }
  }
});

test("the Catppuccin palettes are written in the hex they are defined in", () => {
  for (const name of HEX) {
    for (const [role, value] of colourValues(THEMES[name])) {
      assert.match(value, /^#[0-9a-f]{6}$/, `${name}'s ${role} is not a colour`);
    }
  }
});

// --- the row the reader is on ------------------------------------------------

test("every palette lifts the cursor's row off the rows around it", () => {
  for (const [name, palette] of Object.entries(THEMES)) {
    assert.notStrictEqual(
      palette.cursorLineBg,
      palette.headerBg,
      `${name}'s cursor row is the header's colour`
    );
    assert.notStrictEqual(
      palette.addCursorBg,
      palette.addBg,
      `${name} draws the cursor on an added line no differently`
    );
    assert.notStrictEqual(
      palette.delCursorBg,
      palette.delBg,
      `${name} draws the cursor on a removed line no differently`
    );
  }
});

test("every palette tells the changed words from the line around them", () => {
  // Three steps of one hue: the line, the line under the cursor, and the words that
  // actually changed. Any two of them the same makes one of the three say nothing.
  for (const [name, palette] of Object.entries(THEMES)) {
    const adds = [palette.addBg, palette.addCursorBg, palette.addWordBg];
    const dels = [palette.delBg, palette.delCursorBg, palette.delWordBg];

    assert.strictEqual(new Set(adds).size, 3, `${name} repeats a colour across the added steps`);
    assert.strictEqual(new Set(dels).size, 3, `${name} repeats a colour across the removed steps`);
    assert.notStrictEqual(palette.addWordBg, palette.delWordBg, `${name} confuses the two`);
  }
});

test("an added line under the cursor is still not a removed one", () => {
  // Lifting the two diff colours must not lift them into each other: the background
  // is what says which of the two the line is
  for (const [name, palette] of Object.entries(THEMES)) {
    assert.notStrictEqual(palette.addCursorBg, palette.delCursorBg, `${name} confuses the two`);
    assert.notStrictEqual(palette.addCursorBg, palette.cursorLineBg, `${name} loses the add`);
    assert.notStrictEqual(palette.delCursorBg, palette.cursorLineBg, `${name} loses the delete`);
  }
});

test("the two sides of a conflict are told apart, and from a diff's two", () => {
  // Both versions of the line are there and one of them is about to be chosen, which
  // is a different question from added-or-removed — so the colours have to be too
  for (const [name, palette] of Object.entries(THEMES)) {
    assert.notStrictEqual(
      palette.conflictOursBg,
      palette.conflictTheirsBg,
      `${name} draws the two sides the same`
    );
    for (const role of ["addBg", "delBg", "cursorLineBg", "fillerBg"]) {
      assert.notStrictEqual(
        palette.conflictOursBg,
        palette[role],
        `${name} draws our side as ${role}`
      );
      assert.notStrictEqual(
        palette.conflictTheirsBg,
        palette[role],
        `${name} draws their side as ${role}`
      );
    }
  }
});

test("every palette gives the graph the same number of lanes", () => {
  const lanes = Object.values(THEMES).map((palette) => palette.graphLanes.length);

  assert.ok(lanes[0] > 1, "one lane would colour a merge the same as the trunk");
  assert.ok(
    lanes.every((count) => count === lanes[0]),
    "a graph should not change shape with the palette"
  );
});

test("Catppuccin Mocha uses the colours the palette ships", () => {
  // Spot-checked against the theme's own palette file rather than from memory:
  // mauve, green, peach and overlay2 are what it paints a keyword, a string, a
  // number and a comment with
  const mocha = THEMES[CATPPUCCIN_MOCHA];

  assert.strictEqual(mocha.tokenKeyword, "#cba6f7");
  assert.strictEqual(mocha.tokenString, "#a6e3a1");
  assert.strictEqual(mocha.tokenNumber, "#fab387");
  assert.strictEqual(mocha.tokenComment, "#9399b2");
  assert.strictEqual(mocha.headerFg, "#cdd6f4");
  assert.strictEqual(mocha.headerBg, "#181825");
});

test("the diff backgrounds are the blend the theme uses, not the accent itself", () => {
  // DiffAdd and DiffDelete are green and red mixed 18% into the base; the accents
  // themselves would drown the text laid over them
  const mocha = THEMES[CATPPUCCIN_MOCHA];

  assert.strictEqual(mocha.addBg, "#364143");
  assert.strictEqual(mocha.delBg, "#443244");
  assert.notStrictEqual(mocha.addBg, "#a6e3a1");
  assert.notStrictEqual(mocha.delBg, "#f38ba8");
});

// --- which one is chosen -----------------------------------------------------

test("a name picks a palette", () => {
  assert.strictEqual(themeNamed(CLASSIC), THEMES[CLASSIC]);
  assert.strictEqual(themeNamed(CATPPUCCIN_MOCHA), THEMES[CATPPUCCIN_MOCHA]);
});

test("a terminal that says it can draw a colour exactly gets the hex palette", () => {
  assert.strictEqual(defaultThemeName({ COLORTERM: "truecolor" }), CATPPUCCIN_MOCHA);
  assert.strictEqual(defaultThemeName({ COLORTERM: "24bit" }), CATPPUCCIN_MOCHA);
});

test("a terminal that says nothing keeps the palette every terminal can draw", () => {
  assert.strictEqual(defaultThemeName({}), CLASSIC);
  assert.strictEqual(defaultThemeName({ TERM: "xterm-256color" }), CLASSIC);
  assert.strictEqual(hasTrueColor({ COLORTERM: "" }), false);
});

test("a light palette is never chosen for the reader", () => {
  // Nothing a terminal reports says whether its background is light, and guessing
  // wrong is the one mistake that makes a diff unreadable rather than ugly. So the
  // light palettes answer to their name and to nothing else.
  assert.notStrictEqual(defaultThemeName({}), CLASSIC_LIGHT);
  assert.notStrictEqual(defaultThemeName({}), CATPPUCCIN_LATTE);
  assert.notStrictEqual(defaultThemeName({ COLORTERM: "truecolor" }), CATPPUCCIN_LATTE);
  assert.notStrictEqual(defaultThemeName({ COLORTERM: "24bit" }), CLASSIC_LIGHT);
});

test("the light palettes answer to their names", () => {
  assert.strictEqual(themeNamed(CLASSIC_LIGHT, {}), THEMES[CLASSIC_LIGHT]);
  assert.strictEqual(themeNamed(CATPPUCCIN_LATTE, {}), THEMES[CATPPUCCIN_LATTE]);
  // And keep answering when the terminal has an opinion of its own
  assert.strictEqual(
    themeNamed(CATPPUCCIN_LATTE, { COLORTERM: "truecolor" }),
    THEMES[CATPPUCCIN_LATTE]
  );
});

test("Catppuccin Latte uses the colours that palette ships", () => {
  // Spot-checked against Latte's own palette file, the same four roles Mocha is
  // checked on: mauve, green, peach and overlay2
  const latte = THEMES[CATPPUCCIN_LATTE];

  assert.strictEqual(latte.tokenKeyword, "#8839ef");
  assert.strictEqual(latte.tokenString, "#40a02b");
  assert.strictEqual(latte.tokenNumber, "#fe640b");
  assert.strictEqual(latte.tokenComment, "#7c7f93");
  assert.strictEqual(latte.headerFg, "#4c4f69");
});

test("the light palettes are light and the dark ones are dark", () => {
  // The header's background is the darkest thing a dark palette draws and the
  // lightest thing a light one does, so it is the one role that says which is which
  assert.ok(brightness(THEMES[CATPPUCCIN_LATTE].headerBg) > 0.5, "Latte is not light");
  assert.ok(brightness(THEMES[CATPPUCCIN_MOCHA].headerBg) < 0.5, "Mocha is not dark");
});

test("asking for one by name overrides what the terminal claims", () => {
  // A terminal that can do it and never says so is common enough
  assert.strictEqual(themeNamed(CATPPUCCIN_MOCHA, {}), THEMES[CATPPUCCIN_MOCHA]);
  assert.strictEqual(
    themeNamed(CLASSIC, { COLORTERM: "truecolor" }),
    THEMES[CLASSIC]
  );
});

test("a name nobody has falls back rather than failing", () => {
  // A mistyped colour scheme is not a reason to refuse to show a diff
  assert.strictEqual(themeNamed("dracula", {}), THEMES[CLASSIC]);
  assert.strictEqual(themeNamed(undefined, {}), THEMES[CLASSIC]);
});

// --- the escapes each form produces -----------------------------------------

test("an index asks the terminal for one of its own colours", () => {
  assert.strictEqual(fg(111), ESC + "[38;5;111m");
  assert.strictEqual(bg(22), ESC + "[48;5;22m");
});

test("a hex asks for that colour exactly", () => {
  assert.strictEqual(fg("#cdd6f4"), ESC + "[38;2;205;214;244m");
  assert.strictEqual(bg("#364143"), ESC + "[48;2;54;65;67m");
});

test("black and white survive the conversion", () => {
  assert.strictEqual(fg("#000000"), ESC + "[38;2;0;0;0m");
  assert.strictEqual(fg("#ffffff"), ESC + "[38;2;255;255;255m");
});
