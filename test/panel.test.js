"use strict";

// The file panel's own row.
//
// The two-letter git status is the only place a single cell carries two meanings —
// the left letter is what is staged, the right what is not — so they are coloured
// apart, and neither is allowed to cost the row its width.

const test = require("node:test");
const assert = require("node:assert");

const { renderPanelRow, renderStatus } = require("../lib/render/panel");
const { displayWidth } = require("../lib/text");

const SGR = /\[[0-9;]*m/g;
// Every painted run ends with a reset, so counting resets counts the runs — which is
// the question here, rather than how many codes each run happens to open with.
const RESET = /\[0m/g;
const WIDTH = 34;

function plain(text) {
  return text.replace(SGR, "");
}

/** How many separately styled runs a string is painted in. */
function runCount(text) {
  return (text.match(RESET) || []).length;
}

function entry(overrides) {
  return {
    path: "lib/a.js",
    label: "lib/a.js",
    status: " M",
    added: 3,
    deleted: 1,
    comments: 0,
    ...overrides,
  };
}

test("colours the index and worktree letters apart", () => {
  // Arrange: staged, and then modified again
  const painted = renderStatus("MM");

  // Assert: two painted runs, so the two letters can differ
  assert.strictEqual(plain(painted), "MM");
  assert.strictEqual(runCount(painted), 2, "the two letters are painted as one run");
});

test("paints an untracked file's status as one thing", () => {
  // Arrange: "??" is not two states, it is one
  const painted = renderStatus("??");

  // Assert
  assert.strictEqual(plain(painted), "??");
  assert.strictEqual(runCount(painted), 1, "?? should be a single painted run");
});

test("keeps the status two columns wide whatever it is given", () => {
  // Assert
  for (const status of ["M", "MM", "??", "R ", "", "MMM"]) {
    assert.strictEqual(displayWidth(plain(renderStatus(status))), 2, `status ${status}`);
  }
});

test("an unselected row is exactly the panel's width", () => {
  // Act
  const row = renderPanelRow(entry(), WIDTH, false, false);

  // Assert
  assert.strictEqual(displayWidth(plain(row)), WIDTH);
});

test("a selected row is exactly the panel's width too", () => {
  // Act
  const row = renderPanelRow(entry(), WIDTH, true, true);

  // Assert
  assert.strictEqual(displayWidth(plain(row)), WIDTH);
});

test("a full-width path does not push the row past its width", () => {
  // Arrange: a Japanese path is half as many characters as it is columns
  const row = renderPanelRow(entry({ label: "ドキュメント/読み方.md" }), WIDTH, false, false);

  // Assert
  assert.strictEqual(displayWidth(plain(row)), WIDTH);
});

test("shows the comment count in place of the line counts", () => {
  // Act
  const withNotes = renderPanelRow(entry({ comments: 2 }), WIDTH, false, false);
  const withoutNotes = renderPanelRow(entry(), WIDTH, false, false);

  // Assert
  assert.match(plain(withNotes), /●2/);
  assert.match(plain(withoutNotes), /\+3 -1/);
});

test("marks the selected row only while the panel has focus", () => {
  // Act
  const focused = renderPanelRow(entry(), WIDTH, true, true);
  const unfocused = renderPanelRow(entry(), WIDTH, true, false);

  // Assert
  assert.ok(plain(focused).startsWith("▸"));
  assert.ok(plain(unfocused).startsWith(" "));
});
