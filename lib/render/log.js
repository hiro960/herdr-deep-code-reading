"use strict";

// The log screen's four panes.
//
// Across the top: the branch list, and the graph beside it. Underneath, behind a rule:
// the file panel and the diff, drawn by ./body — the same two the diff view draws, so
// they behave here exactly as they do there.
//
// Two invariants hold every row together. The graph column is one fixed width for the
// whole screen, which is what makes a lane a straight line down it rather than a
// staircase; and every row is exactly as wide as the terminal, which is what keeps the
// column separators lining up under each other.

const { paint, theme } = require("../ansi");
const { KIND_HEAD, KIND_LOCAL, KIND_REMOTE, KIND_TAG, laneOfColumn } = require("../graph");
const { GUTTER_WIDTH, SEPARATOR_WIDTH } = require("../layout");
const { resolveLogLayout } = require("../log-layout");
const { NOTE_NO_COMMITS } = require("../history");
const { abbreviatePath } = require("../path-display");
const { displayWidth, fitToWidth, prepareLine, truncateToWidth } = require("../text");
const { trackingLabel } = require("../upstream");
const { cell, separator } = require("./cells");
const { renderBodyLine } = require("./body");
// The same mark a file already read carries, because it says the same thing one size up
const { VIEWED_MARK } = require("./panel");
const { clampScroll, panelScrollFor } = require("./scroll");

// Columns of an abbreviated sha. git's own default, and enough to name a commit in
// any repository a reader is holding in their head.
const SHA_WIDTH = 7;
const GAP = 1;

// The author and the date, drawn hard against the right edge. They answer "who, and
// when", which is a different question from "what" and belongs in a different column.
const AUTHOR_WIDTH = 12;
const DATE_WIDTH = 10;
const META_WIDTH = AUTHOR_WIDTH + GAP + DATE_WIDTH;
// Below this the row gives the whole of itself to the subject: on a narrow pane, what
// the commit did matters more than who did it.
const META_MIN_ROW_WIDTH = 64;

// The share of a row the branch labels may take before they are dropped. A commit at
// the tip of eight branches would otherwise leave no room for what it says it did.
const REF_SHARE = 3;

const BRANCH_MARKER = "▸";
const BRANCH_MARKER_WIDTH = 2;

const RULE = "─";
const RULE_ABOVE = "┴";
const RULE_BELOW = "┬";
const RULE_BOTH = "┼";

const REF_COLOURS = {
  [KIND_HEAD]: () => theme.refHeadFg,
  [KIND_LOCAL]: () => theme.refLocalFg,
  [KIND_REMOTE]: () => theme.refRemoteFg,
  [KIND_TAG]: () => theme.refTagFg,
};

/** The colour a name is drawn in, by what kind of name it is. */
function refColour(kind) {
  const found = REF_COLOURS[kind];
  return found === undefined ? theme.panelFg : found();
}

/** The colour of one lane, cycled so that a graph wider than the palette still draws. */
function laneColour(lane) {
  const lanes = theme.graphLanes;
  return lanes[lane % lanes.length];
}

/**
 * The graph column, each lane in its own colour.
 *
 * Drawn into an exact width whatever git wrote, because the lanes only read as lines
 * if every row spends the same number of columns on them. The characters are ASCII —
 * `*`, `|`, `/`, `\`, `_` and spaces — so a column is a character here.
 */
function renderGraph(graph, width) {
  const visible = truncateToWidth(graph, width);
  let out = "";

  for (let at = 0; at < visible.length; at += 1) {
    const char = visible[at];
    // A space belongs to no lane, and painting it would spend an escape sequence
    // saying so on every row of the screen
    out += char === " " ? char : paint(char, { fg: laneColour(laneOfColumn(at)) });
  }

  return out + " ".repeat(Math.max(0, width - visible.length));
}

/**
 * A name as it is drawn beside a commit.
 * Bracketed the way git's own decoration is: a bare name sitting between a sha and a
 * subject reads as the first word of the subject.
 */
function refLabel(ref) {
  return `(${ref.name})`;
}

/** The names pointing at a commit, each in the colour of its kind. */
function renderRefs(refs) {
  if (refs.length === 0) {
    return "";
  }
  return refs
    .map((ref) => paint(refLabel(ref), { fg: refColour(ref.kind), bold: true }))
    .join(" ");
}

/** As many of a commit's names as fit the room they are allowed, in git's order. */
function cappedRefs(refs, room) {
  const kept = [];
  let used = 0;

  for (const ref of refs) {
    const needed = displayWidth(refLabel(ref)) + GAP;
    if (used + needed > room) {
      break;
    }
    kept.push(ref);
    used += needed;
  }

  return kept;
}

/** Who wrote the commit, and when. */
function metaOf(commit) {
  return `${fitToWidth(commit.author, AUTHOR_WIDTH)} ${fitToWidth(commit.date, DATE_WIDTH)}`;
}

/**
 * One commit row, as pieces whose widths add up to exactly the width asked for.
 *
 * Built as pieces rather than as a string because the cursor's row is painted in one
 * colour over the whole of it, and every other row is painted a piece at a time. Both
 * need the same text and the same widths; only the painting differs.
 */
function commitParts(commit, width, isRead) {
  const showMeta = width >= META_MIN_ROW_WIDTH;
  const metaRoom = showMeta ? META_WIDTH + GAP : 0;
  const parts = [];
  let left = Math.max(0, width - metaRoom);

  const take = (text, style) => {
    if (left <= 0) {
      return;
    }
    const fitted = truncateToWidth(text, left);
    if (fitted === "") {
      return;
    }
    parts.push({ text: fitted, style });
    left -= displayWidth(fitted);
  };

  // The column is spent whether or not there is a mark in it: a mark that moved the
  // sha two columns right on the rows that carry one would make a ragged left edge of
  // the one thing on this screen that is always in the same place.
  take(isRead === true ? VIEWED_MARK : " ", { fg: theme.noteFg });
  take(" ", {});
  take(fitToWidth(commit.shortSha, SHA_WIDTH), { fg: theme.hunkFg });
  take(" ", {});

  for (const ref of cappedRefs(commit.refs || [], Math.floor(width / REF_SHARE))) {
    take(refLabel(ref), { fg: refColour(ref.kind), bold: true });
    take(" ", {});
  }

  take(prepareLine(commit.subject), { fg: theme.panelFg });

  if (left > 0) {
    parts.push({ text: " ".repeat(left), style: {} });
  }

  if (metaRoom > 0) {
    parts.push({ text: " ", style: {} });
    parts.push({ text: fitToWidth(metaOf(commit), META_WIDTH), style: { fg: theme.noteFg, dim: true } });
  }

  return parts;
}

/**
 * One commit, in the width the graph column left it.
 *
 * @param {boolean} [isRead] Whether the reader has been through it, which dims the row
 *   and puts the mark in the column at its left — a commit already read is still there
 *   to go back to and is no longer one of the things asking to be looked at
 */
function renderCommitRow(commit, width, isCursor, isRead) {
  if (width <= 0) {
    return "";
  }

  const parts = commitParts(commit, width, isRead);

  if (isCursor) {
    // One colour over the whole row: a cursor drawn as a background has to cover the
    // row's own colours, and painting the pieces separately would leave gaps in it
    return cell(parts.map((part) => part.text).join(""), width, {
      bg: theme.panelSelectedBg,
      fg: theme.panelSelectedFg,
    });
  }

  return parts
    .map((part) => paint(part.text, isRead === true ? { ...part.style, dim: true } : part.style))
    .join("");
}

/**
 * The colour of the counts beside a branch.
 *
 * Behind is the one worth a colour: it is work that has arrived and not been read, and
 * it is the only one of the three a key on this screen can do anything about. Ahead is
 * dimmed — it is a fact about this repository rather than something waiting — and an
 * upstream that has been deleted is coloured the way a deleted file is.
 */
function trackColour(track) {
  if (track.gone) {
    return theme.statusDeletedFg;
  }
  return track.behind > 0 ? theme.statusAddedFg : theme.noteFg;
}

/** One row of the branch list: a group's heading, a branch, or nothing at all. */
function renderBranchRow(row, width, isSelected, isFocused) {
  if (row === undefined) {
    return " ".repeat(width);
  }
  if (row.kind !== "branch") {
    return cell(` ${row.text}`, width, { fg: theme.noteFg, dim: true });
  }

  const marker = isSelected && isFocused ? BRANCH_MARKER : " ";
  // How far this branch has drifted from the one it follows — see lib/upstream. Held
  // against the right edge so that the numbers line up down the column and a reader
  // can see at a glance which branches have something waiting on them.
  const track = trackingLabel(row.branch.track);
  const trackRoom = track === "" ? 0 : displayWidth(track) + GAP;
  // Drop the middle of a long name rather than its end: `origin/feat/…/x` says more
  // than the first twenty characters of it would
  const name = abbreviatePath(
    row.branch.name,
    Math.max(0, width - BRANCH_MARKER_WIDTH - trackRoom)
  );
  const named = fitToWidth(`${marker} ${name}`, Math.max(0, width - trackRoom));
  const counts = trackRoom === 0 ? "" : fitToWidth(` ${track}`, trackRoom);

  if (isSelected) {
    // One colour over the whole row, for the reason a commit row is painted that way:
    // a cursor drawn as a background has to cover what is under it
    return cell(named + counts, width, {
      bg: theme.panelSelectedBg,
      fg: theme.panelSelectedFg,
    });
  }

  return (
    paint(named, { fg: refColour(row.branch.kind) }) +
    (counts === "" ? "" : paint(counts, { fg: trackColour(row.branch.track) }))
  );
}

/**
 * The rule between the graph and the diff.
 * The two halves divide their columns at different places, so the rule says where each
 * of them does: `┴` where a column above it ends, `┬` where one below it begins.
 */
function renderDivider(layout, columns) {
  const above = layout.showBranches ? layout.branchWidth : -1;
  const below = layout.showPanel ? layout.panelWidth - SEPARATOR_WIDTH : -1;

  let out = "";
  for (let at = 0; at < columns; at += 1) {
    const endsAbove = at === above;
    const beginsBelow = at === below;
    if (endsAbove && beginsBelow) {
      out += RULE_BOTH;
    } else {
      out += endsAbove ? RULE_ABOVE : beginsBelow ? RULE_BELOW : RULE;
    }
  }

  return paint(out, { fg: theme.borderFg });
}

/** One row of the upper half: a branch beside a commit, or beside an edge. */
function renderUpperLine(model, layout, context) {
  const { graphScroll, branchScroll, offset } = context;
  const log = model.log;
  let line = "";

  if (layout.showBranches) {
    const index = branchScroll + offset;
    line +=
      renderBranchRow(
        log.branchRows[index],
        layout.branchWidth,
        index === log.branchCursor,
        log.focus === "branches"
      ) + separator();
  }

  // A repository with no commits, or a branch with none. Saying so is what tells an
  // empty graph apart from one that failed to load.
  if (log.rows.length === 0) {
    const text = offset === 0 ? `  ${NOTE_NO_COMMITS}` : "";
    return line + cell(text, layout.graphWidth, { fg: theme.noteFg, dim: true });
  }

  const at = graphScroll + offset;
  const row = log.rows[at];

  if (row === undefined) {
    return line + " ".repeat(layout.graphWidth);
  }

  // The graph never takes more than the column it is in, however deep the branching
  const gutter = Math.min(log.graphWidth, layout.graphWidth);
  const rest = layout.graphWidth - gutter;
  const graph = renderGraph(row.graph, gutter);

  if (row.commit === null) {
    return line + graph + " ".repeat(rest);
  }

  const isCursor = at === log.cursor && log.focus === "graph";
  const isRead = model.readShas !== undefined && model.readShas.has(row.commit.sha);
  return line + graph + renderCommitRow(row.commit, rest, isCursor, isRead);
}

/**
 * The log screen's body, from the header down to the footer.
 *
 * The lower half is handed to ./body with the log's own focus in place of the diff
 * view's, so that the file panel highlights when Tab has brought the reader to it and
 * the diff's cursor is drawn only while they are in the diff.
 */
function renderLogBody(model, columns, bodyHeight) {
  const layout = resolveLogLayout(columns, bodyHeight, model.diffLayout);
  const log = model.log;
  const lines = [];

  const graphScroll = clampScroll(log.scroll, log.rows.length, layout.logHeight);
  const branchScroll = clampScroll(log.branchScroll, log.branchRows.length, layout.logHeight);

  for (let offset = 0; offset < layout.logHeight; offset += 1) {
    lines.push(renderUpperLine(model, layout, { graphScroll, branchScroll, offset }));
  }

  if (!layout.showDiff) {
    return lines;
  }

  lines.push(renderDivider(layout, columns));

  const below = {
    ...model,
    panelActive: log.focus === "panel",
    cursorActive: log.focus === "diff",
  };
  const diffLayout = { ...layout, sideBySide: model.sideBySide === true };
  const diffScroll = clampScroll(model.scroll, model.rows.length, layout.diffHeight);
  const panelScroll = panelScrollFor(model.selectedIndex, model.files.length, layout.diffHeight);
  const bodyWidth = Math.max(1, layout.diffWidth - GUTTER_WIDTH);

  for (let offset = 0; offset < layout.diffHeight; offset += 1) {
    lines.push(
      renderBodyLine(below, {
        offset,
        layout: diffLayout,
        rows: model.rows,
        diffScroll,
        panelScroll,
        bodyWidth,
        showingPicker: false,
      })
    );
  }

  return lines;
}

module.exports = {
  renderBranchRow,
  renderCommitRow,
  renderGraph,
  renderLogBody,
  renderRefs,
};
