"use strict";

// Drawing the log screen: four panes whose widths add up to the terminal's, a graph
// column that stays a straight line down the screen, and the branch labels that say
// where each branch is.

const test = require("node:test");
const assert = require("node:assert");

const { KIND_HEAD, KIND_LOCAL, KIND_REMOTE, KIND_TAG } = require("../lib/graph");
const { BRANCH_MIN_COLUMNS, resolveLogLayout } = require("../lib/log-layout");
const {
  renderBranchRow,
  renderCommitRow,
  renderGraph,
  renderLogBody,
  renderRefs,
} = require("../lib/render/log");
const { displayWidth } = require("../lib/text");

const ESC_SEQUENCE = /\u001b\[[0-9;]*m/g;

/** What the row looks like to the terminal: its cells, without the colours. */
function plain(text) {
  return text.replace(ESC_SEQUENCE, "");
}

function widthOf(text) {
  return displayWidth(plain(text));
}

function commit(fields) {
  return {
    sha: "0123456789abcdef",
    shortSha: "0123456",
    parents: [],
    date: "2026-08-15",
    author: "A Reader",
    refs: [],
    subject: "do the thing",
    ...fields,
  };
}

/** A model of the log screen, as toScreenModel hands one over. */
function model(overrides) {
  const rows = [
    { graph: "*", commit: commit({ shortSha: "aaaaaaa", subject: "newest" }) },
    { graph: "|\\", commit: null },
    { graph: "| *", commit: commit({ shortSha: "bbbbbbb", subject: "on the side" }) },
  ];

  return {
    files: [],
    selectedIndex: 0,
    rows: [],
    scroll: 0,
    cursor: 0,
    commentKeys: new Set(),
    selection: null,
    word: null,
    cursorActive: false,
    log: {
      rows,
      cursor: 0,
      scroll: 0,
      graphWidth: 4,
      branchRows: [
        { kind: "heading", text: "branches" },
        { kind: "branch", branch: { name: "main", kind: KIND_HEAD } },
      ],
      branchCursor: 1,
      branchScroll: 0,
      focus: "graph",
      ref: null,
    },
    ...overrides,
  };
}

// --- the graph column ------------------------------------------------------------------

test("the graph is drawn into a fixed width, so a lane is a straight line", () => {
  assert.strictEqual(widthOf(renderGraph("*", 5)), 5);
  assert.strictEqual(widthOf(renderGraph("| |/", 5)), 5);
  assert.strictEqual(widthOf(renderGraph("", 5)), 5);
});

test("the graph's own characters survive being coloured", () => {
  assert.strictEqual(plain(renderGraph("| * |", 8)), "| * |   ");
});

test("a graph wider than its column is cut rather than pushing the row out", () => {
  assert.strictEqual(widthOf(renderGraph("| | | | |", 4)), 4);
});

// --- what a commit row says --------------------------------------------------------------

test("a commit row carries its sha, its subject, and who wrote it when", () => {
  const row = plain(renderCommitRow(commit({}), 100, false));

  assert.match(row, /0123456/);
  assert.match(row, /do the thing/);
  assert.match(row, /A Reader/);
  assert.match(row, /2026-08-15/);
});

test("a commit row is exactly as wide as it was asked to be", () => {
  for (const width of [40, 60, 80, 120, 200]) {
    assert.strictEqual(widthOf(renderCommitRow(commit({}), width, false)), width, `${width}`);
  }
});

test("a long subject is cut rather than wrapped: one commit is one row", () => {
  const long = commit({ subject: "x".repeat(400) });

  assert.strictEqual(widthOf(renderCommitRow(long, 80, false)), 80);
});

test("a full-width subject still leaves the row the width it was given", () => {
  const japanese = commit({ subject: "変更履歴をブランチごとに読む".repeat(10) });

  assert.strictEqual(widthOf(renderCommitRow(japanese, 81, false)), 81);
});

test("a row with almost no room still comes out the width it was given", () => {
  for (const width of [1, 2, 3, 5, 9, 20, 63]) {
    assert.strictEqual(widthOf(renderCommitRow(commit({}), width, false)), width, `${width}`);
  }
});

test("no room at all draws nothing", () => {
  assert.strictEqual(renderCommitRow(commit({}), 0, false), "");
});

test("the cursor's row keeps its width when it carries labels too", () => {
  const decorated = commit({ refs: [{ name: "main", kind: KIND_HEAD }] });

  assert.strictEqual(widthOf(renderCommitRow(decorated, 80, true)), 80);
});

test("the cursor's row is drawn differently from the rest", () => {
  const here = renderCommitRow(commit({}), 80, true);
  const elsewhere = renderCommitRow(commit({}), 80, false);

  assert.notStrictEqual(here, elsewhere);
  assert.strictEqual(widthOf(here), widthOf(elsewhere));
});

// --- the branch labels a commit carries ------------------------------------------------------

test("every name pointing at a commit is drawn beside it", () => {
  const refs = [
    { name: "main", kind: KIND_HEAD },
    { name: "origin/main", kind: KIND_REMOTE },
    { name: "v1.0.0", kind: KIND_TAG },
  ];

  const drawn = plain(renderRefs(refs));

  assert.match(drawn, /main/);
  assert.match(drawn, /origin\/main/);
  assert.match(drawn, /v1\.0\.0/);
});

test("a commit nothing points at gets no labels and no space for them", () => {
  assert.strictEqual(renderRefs([]), "");
});

test("a label is bracketed, so it does not read as the first word of the subject", () => {
  const drawn = plain(renderRefs([{ name: "main", kind: KIND_HEAD }]));

  assert.strictEqual(drawn, "(main)");
});

test("a kind nothing knows about is still drawn, in the ordinary colour", () => {
  const drawn = plain(renderRefs([{ name: "odd", kind: "something-else" }]));

  assert.strictEqual(drawn, "(odd)");
});

test("more labels than a row has room for are dropped, not squeezed", () => {
  const crowded = commit({
    refs: Array.from({ length: 20 }, (_, at) => ({
      name: `branch-number-${at}`,
      kind: KIND_LOCAL,
    })),
    subject: "still says what it did",
  });

  const row = plain(renderCommitRow(crowded, 100, false));

  assert.strictEqual(displayWidth(row), 100);
  assert.match(row, /still says/, "the subject survives a commit at twenty tips");
});

test("the labels are part of the row's width, not drawn over it", () => {
  const decorated = commit({
    refs: [
      { name: "main", kind: KIND_HEAD },
      { name: "origin/main", kind: KIND_REMOTE },
    ],
  });

  assert.strictEqual(widthOf(renderCommitRow(decorated, 80, false)), 80);
});

// --- the branch list ---------------------------------------------------------------------------

test("a heading and a branch are both exactly the column's width", () => {
  const heading = { kind: "heading", text: "branches" };
  const branch = { kind: "branch", branch: { name: "main", kind: KIND_HEAD } };

  assert.strictEqual(widthOf(renderBranchRow(heading, 24, false, false)), 24);
  assert.strictEqual(widthOf(renderBranchRow(branch, 24, false, false)), 24);
});

test("a name too long for the column is cut, not spilled into the graph", () => {
  const branch = { kind: "branch", branch: { name: "origin/" + "x".repeat(80), kind: KIND_REMOTE } };

  assert.strictEqual(widthOf(renderBranchRow(branch, 24, false, false)), 24);
});

test("an empty column is still the column's width", () => {
  assert.strictEqual(widthOf(renderBranchRow(undefined, 24, false, false)), 24);
});

test("the branch being read is marked, and the mark costs no width", () => {
  const branch = { kind: "branch", branch: { name: "main", kind: KIND_LOCAL } };

  const chosen = renderBranchRow(branch, 24, true, true);

  assert.strictEqual(widthOf(chosen), 24);
  assert.notStrictEqual(plain(chosen), plain(renderBranchRow(branch, 24, false, false)));
});

// --- the whole body -------------------------------------------------------------------------------

test("every row of the body is exactly the terminal's width", () => {
  const height = 30;

  for (const columns of [80, 100, 120, 160, 200]) {
    const lines = renderLogBody(model(), columns, height);

    for (const [at, line] of lines.entries()) {
      assert.strictEqual(widthOf(line), columns, `${columns} columns, row ${at}`);
    }
  }
});

test("the body fills the height it was given, no more and no less", () => {
  for (const height of [6, 9, 10, 24, 40]) {
    assert.strictEqual(renderLogBody(model(), 160, height).length, height, `${height} rows`);
  }
});

test("a narrow terminal drops the branch column rather than squeezing it", () => {
  const narrow = renderLogBody(model(), BRANCH_MIN_COLUMNS - 1, 20);

  assert.ok(
    !plain(narrow.join("\n")).includes("branches"),
    "the heading is gone with the column"
  );
});

test("the graph is above the rule and the diff below it", () => {
  const columns = 160;
  const height = 30;
  const layout = resolveLogLayout(columns, height);
  const lines = renderLogBody(model(), columns, height).map(plain);

  assert.ok(lines[0].includes("newest"), "the graph starts at the top");
  assert.ok(layout.showDiff, "30 rows has room for both");
  assert.match(lines[layout.logHeight], /^[─┬┴┼]+$/, "a rule between them");
});

test("an empty graph says so rather than drawing nothing", () => {
  const empty = model({
    log: { ...model().log, rows: [], cursor: 0, graphWidth: 1 },
  });

  const lines = renderLogBody(empty, 160, 20).map(plain);

  assert.match(lines[0], /No commits/);
  for (const [at, line] of lines.entries()) {
    assert.strictEqual(displayWidth(line), 160, `row ${at}`);
  }
});

test("a body too short for both is all graph", () => {
  const lines = renderLogBody(model(), 160, 6).map(plain);

  assert.ok(lines[0].includes("newest"));
  assert.ok(lines[0].includes("branches"), "the branch list stays beside it");
  assert.ok(
    lines.every((line) => !/^[─┬┴┼]+$/.test(line)),
    "no rule, because there is nothing under it"
  );
});

test("the branch list scrolls on its own, and the graph on its own", () => {
  const many = model();
  const branchRows = [
    { kind: "heading", text: "branches" },
    ...Array.from({ length: 30 }, (_, at) => ({
      kind: "branch",
      branch: { name: `branch-${at}`, kind: KIND_LOCAL },
    })),
  ];
  const scrolled = model({
    log: { ...many.log, branchRows, branchCursor: 29, branchScroll: 25 },
  });

  const lines = renderLogBody(scrolled, 160, 20).map(plain);

  const branchColumn = lines.join("\n");
  assert.ok(!branchColumn.includes("branch-0 "), "the top of the branch list is scrolled past");
  assert.ok(branchColumn.includes("branch-29"), "and its end is in view");
  assert.ok(lines[0].includes("newest"), "the graph beside it did not scroll with it");
});
