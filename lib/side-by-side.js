"use strict";

// Converts a hunk's lines into rows for the two-column layout.
//
// Pairing strategy: collect consecutive runs of deleted and added lines, then at each
// boundary (a context line or the end of the hunk) pair them up by index. Whichever
// side runs out first is padded with null. git has already produced a line-level diff,
// so there is no need to diff again here.

const { withSpans } = require("./word-diff");

/**
 * Build one side of a row. Advancing the line counter is the caller's job.
 * `spans` comes along because it belongs to the line rather than to the layout — see
 * lib/word-diff, which puts it there before either layout is built.
 */
function makeCell(num, line) {
  return withSpans({ num, text: line.text, type: line.type }, line);
}

/**
 * Flush the pending deleted and added lines into paired rows.
 * @returns {{oldNum: number, newNum: number}} Line counters after the flush
 */
function flushPending(rows, pending, oldNum, newNum) {
  const total = Math.max(pending.dels.length, pending.adds.length);
  let nextOld = oldNum;
  let nextNew = newNum;

  for (let index = 0; index < total; index += 1) {
    const del = pending.dels[index];
    const add = pending.adds[index];

    rows.push({
      left: del === undefined ? null : makeCell(nextOld, del),
      right: add === undefined ? null : makeCell(nextNew, add),
    });

    if (del !== undefined) {
      nextOld += 1;
    }
    if (add !== undefined) {
      nextNew += 1;
    }
  }

  return { oldNum: nextOld, newNum: nextNew };
}

/**
 * Convert a single hunk into two-column rows.
 * @param {object} hunk A hunk produced by parseUnifiedDiff
 * @returns {Array<{left: object|null, right: object|null}>}
 */
function buildSideBySideRows(hunk) {
  const rows = [];
  let oldNum = hunk.oldStart;
  let newNum = hunk.newStart;
  let pending = { dels: [], adds: [] };

  for (const line of hunk.lines) {
    if (line.type === "del") {
      pending.dels.push(line);
      continue;
    }
    if (line.type === "add") {
      pending.adds.push(line);
      continue;
    }

    const flushed = flushPending(rows, pending, oldNum, newNum);
    oldNum = flushed.oldNum;
    newNum = flushed.newNum;
    pending = { dels: [], adds: [] };

    rows.push({
      left: makeCell(oldNum, line),
      right: makeCell(newNum, line),
    });
    oldNum += 1;
    newNum += 1;
  }

  flushPending(rows, pending, oldNum, newNum);

  return rows;
}

module.exports = { buildSideBySideRows };
