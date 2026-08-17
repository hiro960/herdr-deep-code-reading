"use strict";

// Shortening a path so it stays recognisable in a narrow panel.
//
// The file name identifies the row, so directories are dropped first and the name
// itself is only elided when it cannot fit on its own.

const { displayWidth, truncateToWidth } = require("./text");

const ELLIPSIS = "…";
const SEPARATOR = "/";
const RENAME_ARROW = " → ";

/** Keep both ends of a name and elide its middle. */
function elideMiddle(text, maxWidth) {
  if (maxWidth <= 0) {
    return "";
  }
  if (displayWidth(text) <= maxWidth) {
    return text;
  }
  if (maxWidth <= 1) {
    return ELLIPSIS;
  }

  const headWidth = Math.ceil((maxWidth - 1) / 2);
  const tailWidth = maxWidth - 1 - headWidth;

  const head = truncateToWidth(text, headWidth);
  // Take the tail by truncating the reversed string, then reversing back
  const tail = [...truncateToWidth([...text].reverse().join(""), tailWidth)]
    .reverse()
    .join("");

  return head + ELLIPSIS + tail;
}

/** Shorten a single path, dropping leading directories first. */
function abbreviateSinglePath(path, maxWidth) {
  if (displayWidth(path) <= maxWidth) {
    return path;
  }

  const segments = path.split(SEPARATOR);

  // Keep as many trailing segments as fit behind the ellipsis
  for (let start = 1; start < segments.length; start += 1) {
    const candidate = ELLIPSIS + SEPARATOR + segments.slice(start).join(SEPARATOR);
    if (displayWidth(candidate) <= maxWidth) {
      return candidate;
    }
  }

  // Not even the file name fits, so elide its middle
  return elideMiddle(segments[segments.length - 1], maxWidth);
}

/**
 * Shorten a panel label to a display width.
 * A rename label is reduced to the two file names before the usual rule applies.
 * @param {string} label Path, or "old → new" for a rename
 * @param {number} maxWidth Available display columns
 * @returns {string}
 */
function abbreviatePath(label, maxWidth) {
  if (maxWidth <= 0 || label === "") {
    return "";
  }
  if (displayWidth(label) <= maxWidth) {
    return label;
  }

  if (label.includes(RENAME_ARROW)) {
    const [from, to] = label.split(RENAME_ARROW);
    const basename = (path) => path.split(SEPARATOR).pop();
    const shortened = basename(from) + RENAME_ARROW + basename(to);
    return displayWidth(shortened) <= maxWidth
      ? shortened
      : elideMiddle(shortened, maxWidth);
  }

  return abbreviateSinglePath(label, maxWidth);
}

module.exports = { abbreviatePath };
