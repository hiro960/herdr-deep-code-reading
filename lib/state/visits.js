"use strict";

// Putting a place on the record of what has been read.
//
// One function, in one file, because three transitions in three different modules do
// it and each of them is otherwise about something else: opening a file from the
// browser, opening a commit from the log, opening one from a history list. What they
// have in common is that the reader chose the place, which is what makes it worth
// remembering — see ../journal.

const { appendEntry } = require("../journal");

/**
 * Record a visit and ask for the record to be written.
 *
 * The write goes out on every visit rather than being batched. Each of the callers has
 * just run git or read a file from disk, so one more write of a small JSON store is
 * nothing beside what it already cost — and it keeps the invariant the bookmarks have,
 * that the list in hand is the list on disk, with no counter to keep and nothing to
 * flush on the way out.
 *
 * A state carries one effect, so this cannot be added to a transition that already asks
 * the world for something. None of the three do.
 */
function recordVisit(state, entry) {
  return {
    ...state,
    journal: appendEntry(state.journal || [], entry),
    effect: { type: "save-journal" },
  };
}

module.exports = { recordVisit };
