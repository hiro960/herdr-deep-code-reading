"use strict";

// The colours, as named roles rather than numbers.
//
// Four palettes fill the same set of names, in two pairs. The `classic` pair is
// written in 256-colour indices, which every terminal has and which a user's own
// terminal theme gets to interpret. The Catppuccin pair is written in the hex it is
// defined in, because the point of a palette like that is its exact hues — a
// nearest-256 approximation would be a different theme wearing its name.
//
// Each pair has a dark member and a light one. Only the dark ones are ever chosen for
// a reader: nothing a terminal reports says whether its background is light, and
// guessing wrong is the one mistake that makes a diff unreadable rather than ugly. The
// light palettes answer to their name, and to nothing else.
//
// Everything here is data. Which one is in use is decided once, in lib/ansi.

const CLASSIC = "classic";
const CLASSIC_LIGHT = "classic-light";
const CATPPUCCIN_MOCHA = "catppuccin-mocha";
const CATPPUCCIN_LATTE = "catppuccin-latte";

// 256-colour palette, chosen for dark terminal backgrounds.
const classic = {
  headerBg: 236,
  headerFg: 253,
  footerFg: 245,
  panelFg: 250,
  panelSelectedBg: 24,
  panelSelectedFg: 255,
  panelFocusFg: 111,
  lineNumberFg: 242,
  hunkFg: 111,
  noteFg: 244,
  addBg: 22,
  addFg: 194,
  delBg: 52,
  delFg: 224,
  // The row the reader is on. A plain line takes a grey band; an added or removed one
  // keeps its own hue and is brightened a step, because the background is what says
  // which of the two it is and the cursor must not paint that away.
  cursorLineBg: 238,
  addCursorBg: 28,
  delCursorBg: 88,
  // A third step of the same hue, for the words within a changed line that actually
  // changed. Above the line's colour and above the cursor's, so the three read in order.
  addWordBg: 34,
  delWordBg: 124,
  // The two sides of a conflict. Neither is an addition or a removal — both versions of
  // the line exist and the reader is choosing between them — so they take two hues of
  // their own rather than borrowing the diff's, which say something else. Blue for the
  // side already here and violet for the side that arrived, far enough apart that a
  // glance at a block says which of the two it is.
  conflictOursBg: 17,
  conflictTheirsBg: 53,
  fillerBg: 234,
  borderFg: 240,
  statusAddedFg: 114,
  statusDeletedFg: 174,
  statusRenamedFg: 180,
  statusModifiedFg: 180,
  tokenComment: 244,
  tokenString: 114,
  tokenNumber: 180,
  tokenKeyword: 111,
  // One colour per lane of the commit graph, cycled. Six is more than any readable
  // graph draws at once, and they are far enough apart that two neighbouring lanes
  // are never the same hue.
  graphLanes: [111, 114, 180, 174, 141, 116],
  refHeadFg: 114,
  refLocalFg: 111,
  refRemoteFg: 180,
  refTagFg: 174,
};

// The same palette turned over for a light terminal: the greys run the other way, and
// every hue is the darker member of its pair so that it reads against paper rather
// than against ink. The diff backgrounds swap places with their foregrounds — a light
// green field with dark green text, where the dark palette has the reverse.
const classicLight = {
  headerBg: 253,
  headerFg: 235,
  footerFg: 243,
  panelFg: 238,
  panelSelectedBg: 153,
  panelSelectedFg: 235,
  panelFocusFg: 26,
  lineNumberFg: 246,
  hunkFg: 26,
  noteFg: 244,
  addBg: 194,
  addFg: 22,
  delBg: 224,
  delFg: 52,
  cursorLineBg: 254,
  addCursorBg: 157,
  delCursorBg: 217,
  addWordBg: 120,
  delWordBg: 210,
  conflictOursBg: 189,
  conflictTheirsBg: 225,
  fillerBg: 255,
  borderFg: 250,
  statusAddedFg: 28,
  statusDeletedFg: 124,
  statusRenamedFg: 130,
  statusModifiedFg: 136,
  tokenComment: 245,
  tokenString: 28,
  tokenNumber: 130,
  tokenKeyword: 91,
  graphLanes: [26, 28, 130, 124, 91, 30],
  refHeadFg: 28,
  refLocalFg: 26,
  refRemoteFg: 136,
  refTagFg: 127,
};

// Catppuccin Mocha, taken from the palette the theme itself ships:
//   rosewater #f5e0dc  flamingo #f2cdcd  pink     #f5c2e7  mauve    #cba6f7
//   red       #f38ba8  maroon   #eba0ac  peach    #fab387  yellow   #f9e2af
//   green     #a6e3a1  teal     #94e2d5  sky      #89dceb  sapphire #74c7ec
//   blue      #89b4fa  lavender #b4befe  text     #cdd6f4  subtext1 #bac2de
//   subtext0  #a6adc8  overlay2 #9399b2  overlay1 #7f849c  overlay0 #6c7086
//   surface2  #585b70  surface1 #45475a  surface0 #313244  base     #1e1e2e
//   mantle    #181825  crust    #11111b
//
// The roles follow the theme's own highlight groups where it has one: Comment is
// overlay2, String green, Number peach, Keyword mauve, LineNr surface1, Visual
// surface1, CursorLineNr lavender. The two diff backgrounds are its DiffAdd and
// DiffDelete, which are the accent blended into the base — green and red at 0.18 —
// rather than the accent itself, which would drown the text on top of it.
const catppuccinMocha = {
  headerBg: "#181825",
  headerFg: "#cdd6f4",
  footerFg: "#7f849c",
  panelFg: "#a6adc8",
  panelSelectedBg: "#45475a",
  panelSelectedFg: "#cdd6f4",
  panelFocusFg: "#b4befe",
  lineNumberFg: "#45475a",
  hunkFg: "#89b4fa",
  noteFg: "#7f849c",
  addBg: "#364143",
  addFg: "#cdd6f4",
  delBg: "#443244",
  delFg: "#cdd6f4",
  // CursorLine is surface0, the theme's own. The two diff colours under the cursor are
  // the same blend as their backgrounds taken further — the accent at 0.32 into the
  // base rather than 0.18 — so the row lifts without changing which colour it is.
  cursorLineBg: "#313244",
  addCursorBg: "#4a5d53",
  delCursorBg: "#624155",
  // The same blend taken to 0.5, which is where the accent is unmistakable and the
  // text laid over it is still readable
  addWordBg: "#628168",
  delWordBg: "#89556b",
  // The two sides of a conflict, blended the same way the diff's two are: blue and
  // mauve at 0.18 into the base. Neither side is an add or a delete — both versions
  // are there and one of them is about to be chosen — so neither borrows those hues.
  conflictOursBg: "#313953",
  conflictTheirsBg: "#3d3752",
  fillerBg: "#181825",
  borderFg: "#45475a",
  statusAddedFg: "#a6e3a1",
  statusDeletedFg: "#f38ba8",
  statusRenamedFg: "#fab387",
  statusModifiedFg: "#f9e2af",
  tokenComment: "#9399b2",
  tokenString: "#a6e3a1",
  tokenNumber: "#fab387",
  tokenKeyword: "#cba6f7",
  // blue, green, peach, red, mauve, teal — the theme's own accents, in an order that
  // never puts two neighbouring lanes in the same part of the wheel
  graphLanes: ["#89b4fa", "#a6e3a1", "#fab387", "#f38ba8", "#cba6f7", "#94e2d5"],
  refHeadFg: "#a6e3a1",
  refLocalFg: "#89b4fa",
  refRemoteFg: "#f9e2af",
  refTagFg: "#f5c2e7",
};

// Catppuccin Latte, the light member of the same family:
//   rosewater #dc8a78  flamingo #dd7878  pink     #ea76cb  mauve    #8839ef
//   red       #d20f39  maroon   #e64553  peach    #fe640b  yellow   #df8e1d
//   green     #40a02b  teal     #179299  sky      #04a5e5  sapphire #209fb5
//   blue      #1e66f5  lavender #7287fd  text     #4c4f69  subtext1 #5c5f77
//   subtext0  #6c6f85  overlay2 #7c7f93  overlay1 #8c8fa1  overlay0 #9ca0b0
//   surface2  #acb0be  surface1 #bcc0cc  surface0 #ccd0da  base     #eff1f5
//   mantle    #e6e9ef  crust    #dce0e8
//
// Role for role with Mocha above, with one deliberate departure: the line number takes
// overlay0 rather than surface1. Light greys on a light field lose more contrast than
// dark greys on a dark one, and surface1 here is close enough to the base to disappear.
//
// The diff backgrounds are computed the same way Mocha's are — the accent at 0.18 into
// the base, and at 0.32 for the row under the cursor.
const catppuccinLatte = {
  headerBg: "#e6e9ef",
  headerFg: "#4c4f69",
  footerFg: "#8c8fa1",
  panelFg: "#6c6f85",
  panelSelectedBg: "#bcc0cc",
  panelSelectedFg: "#4c4f69",
  panelFocusFg: "#7287fd",
  lineNumberFg: "#9ca0b0",
  hunkFg: "#1e66f5",
  noteFg: "#8c8fa1",
  addBg: "#d0e2d1",
  addFg: "#4c4f69",
  delBg: "#eac8d3",
  delFg: "#4c4f69",
  cursorLineBg: "#ccd0da",
  addCursorBg: "#b7d7b4",
  delCursorBg: "#e6a9b9",
  addWordBg: "#98c990",
  delWordBg: "#e18097",
  conflictOursBg: "#c9d8f5",
  conflictTheirsBg: "#dcd0f4",
  fillerBg: "#e6e9ef",
  borderFg: "#bcc0cc",
  statusAddedFg: "#40a02b",
  statusDeletedFg: "#d20f39",
  statusRenamedFg: "#fe640b",
  statusModifiedFg: "#df8e1d",
  tokenComment: "#7c7f93",
  tokenString: "#40a02b",
  tokenNumber: "#fe640b",
  tokenKeyword: "#8839ef",
  graphLanes: ["#1e66f5", "#40a02b", "#fe640b", "#d20f39", "#8839ef", "#179299"],
  refHeadFg: "#40a02b",
  refLocalFg: "#1e66f5",
  refRemoteFg: "#df8e1d",
  refTagFg: "#ea76cb",
};

const THEMES = {
  [CLASSIC]: classic,
  [CLASSIC_LIGHT]: classicLight,
  [CATPPUCCIN_MOCHA]: catppuccinMocha,
  [CATPPUCCIN_LATTE]: catppuccinLatte,
};

/**
 * Whether a terminal has said it can draw a colour exactly.
 *
 * A hex palette on a terminal that cannot is worse than no palette at all, so the
 * one written in hex is only chosen by default where the terminal has said so. Asking
 * for it by name overrides that: a terminal that can do it and never says so is
 * common enough, and the reader knows their own terminal better than this does.
 */
function hasTrueColor(environment) {
  const declared = (environment || {}).COLORTERM || "";
  return declared === "truecolor" || declared === "24bit";
}

/**
 * The palette to use when nobody has asked for one.
 * Never a light one: see the note at the top of this file.
 */
function defaultThemeName(environment) {
  return hasTrueColor(environment) ? CATPPUCCIN_MOCHA : CLASSIC;
}

/**
 * The palette of a given name.
 * An unknown name falls back rather than failing: a mistyped colour scheme is not a
 * reason to refuse to show a diff.
 *
 * @param {string} [name] What was asked for
 * @param {object} [environment] Where to look for a terminal's own claims
 */
function themeNamed(name, environment) {
  return THEMES[name] || THEMES[defaultThemeName(environment)];
}

module.exports = {
  CATPPUCCIN_LATTE,
  CATPPUCCIN_MOCHA,
  CLASSIC,
  CLASSIC_LIGHT,
  THEMES,
  defaultThemeName,
  hasTrueColor,
  themeNamed,
};
