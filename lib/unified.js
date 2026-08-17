"use strict";

// Converts a hunk into one display row per line.
//
// The side-by-side layout pairs deleted and added lines onto a single row. Collapsing
// those pairs when the terminal is too narrow would drop the deleted line, so the
// unified layout keeps every line separate and in its original order.

const { withSpans } = require("./word-diff");

/**
 * Convert a hunk into unified display rows.
 * @param {object} hunk A hunk produced by parseUnifiedDiff
 * @returns {Array<{num: number, text: string, type: string}>}
 */
function buildUnifiedRows(hunk) {
  const rows = [];
  let oldNum = hunk.oldStart;
  let newNum = hunk.newStart;

  // `spans` comes along with every line because it belongs to the line rather than to
  // the layout — see lib/word-diff, which puts it there before either layout is built.
  for (const line of hunk.lines) {
    if (line.type === "del") {
      rows.push(withSpans({ num: oldNum, text: line.text, type: "del" }, line));
      oldNum += 1;
      continue;
    }

    if (line.type === "add") {
      rows.push(withSpans({ num: newNum, text: line.text, type: "add" }, line));
      newNum += 1;
      continue;
    }

    rows.push({ num: newNum, text: line.text, type: "context" });
    oldNum += 1;
    newNum += 1;
  }

  return rows;
}

module.exports = { buildUnifiedRows };
