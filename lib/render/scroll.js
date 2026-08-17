"use strict";

// Where a list sits under its window.
//
// Two of them: the body follows a scroll offset the state keeps, and the panel has
// none of its own — it is wherever it has to be for the selected file to be visible.

/** Clamp a scroll offset into its valid range. */
function clampScroll(scroll, total, visible) {
  const maxScroll = Math.max(0, total - visible);
  return Math.max(0, Math.min(scroll, maxScroll));
}

/** Scroll the panel far enough to keep the selected row visible. */
function panelScrollFor(selectedIndex, total, visible) {
  return clampScroll(selectedIndex - Math.floor(visible / 2), total, visible);
}

module.exports = { clampScroll, panelScrollFor };
