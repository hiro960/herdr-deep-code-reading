"use strict";

// The review comment model and its markdown export.
//
// A comment is a note on a run of diff lines in one file, carrying the snippet it
// points at:
//
//   file   repo-relative path the comment is on
//   side   "new" for added or context lines, "old" for purely removed lines
//   start  first line of the range on that side, 1-based
//   end    last line of the range, equal to start for a single line
//   lines  the verbatim diff lines, each keeping its +/-/space marker
//   text   the reviewer's note
//
// `lines` is the authoritative anchor. Line numbers are never re-bound when the
// diff shifts underneath, so a stale comment still says what it was written against.
//
// Every function here is pure and returns new objects.

const SIDE_NEW = "new";
const SIDE_OLD = "old";

// What a question is, on the list a comment is on. They are the same thing in every
// way that matters here — written by the reader about a run of lines, kept for the
// session, sent to an agent in one batch — and differ in what the agent is being asked
// to do with it. One list, and a field that says which.
const KIND_QUESTION = "question";

const SIGNS = { add: "+", del: "-", context: " " };

/**
 * Diff line text with its marker restored.
 * A wrapped line carries the whole of itself beside the piece being shown, and it is
 * the whole line the agent has to be given: a quote cut at the pane's width would
 * name a line nobody wrote.
 */
function markedLine(cell) {
  return (SIGNS[cell.type] || " ") + (cell.full === undefined ? cell.text : cell.full);
}

/** Anchor a unified row, which carries exactly one diff line. */
function anchorFromUnifiedRow(cell) {
  return {
    side: cell.type === "del" ? SIDE_OLD : SIDE_NEW,
    start: cell.num,
    end: cell.num,
    lines: [markedLine(cell)],
  };
}

/** Anchor a two-column row, which may carry a deleted line, an added line, or both. */
function anchorFromPairRow(row) {
  const { left, right } = row;

  // A context line appears identically on both sides; record it once
  if (left && right && left.type === "context") {
    return {
      side: SIDE_NEW,
      start: right.num,
      end: right.num,
      lines: [markedLine(right)],
    };
  }

  if (left && right) {
    return {
      side: SIDE_NEW,
      start: right.num,
      end: right.num,
      lines: [markedLine(left), markedLine(right)],
    };
  }

  if (left) {
    return {
      side: SIDE_OLD,
      start: left.num,
      end: left.num,
      lines: [markedLine(left)],
    };
  }

  if (right) {
    return {
      side: SIDE_NEW,
      start: right.num,
      end: right.num,
      lines: [markedLine(right)],
    };
  }

  return null;
}

/**
 * Derive a comment anchor from a display row.
 * @returns {{side: string, start: number, end: number, lines: Array<string>}|null}
 *   null when the row carries no diff line (a hunk header or a note)
 */
function anchorFromRow(row) {
  if (row === undefined || row === null) {
    return null;
  }
  // A row built from a wrapped line carries the anchor of the whole line, worked
  // out before it was cut up. Every piece answers with the same one, which is what
  // makes a comment written on the third row of a line a comment on that line —
  // and what keeps a two-column row answering the same way after the side that ran
  // out first has left nothing on it to read.
  if (row.anchor !== undefined) {
    return row.anchor;
  }
  if (row.kind === "line") {
    return anchorFromUnifiedRow(row.cell);
  }
  if (row.kind === "pair") {
    return anchorFromPairRow(row);
  }
  return null;
}

/**
 * Drop the anchors a wrapped line repeats.
 *
 * One line that needed three rows to fit answers three times, with the same side,
 * the same number, and the same quoted text. The reader marked one line and expects
 * to have quoted it once.
 */
function dedupeByLine(anchors) {
  const seen = new Set();

  return anchors.filter((anchor) => {
    const key = `${anchor.side}:${anchor.start}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

/**
 * Derive one anchor from a run of display rows.
 *
 * "This whole function is the problem" is a comment about a span, not a line, and
 * the span is what has to reach the agent. The rule for the side is the same one a
 * single row follows, read over the run: a span that is nothing but removed lines
 * belongs to the old side, and anything else is read on the new one. Rows that carry
 * no diff line — a hunk header caught in the middle of a selection — contribute
 * nothing rather than breaking the span in two.
 *
 * @param {Array<object>} rows Display rows, in the order they appear on screen
 * @returns {{side: string, start: number, end: number, lines: Array<string>}|null}
 */
function anchorFromRows(rows) {
  const anchors = dedupeByLine(rows.map(anchorFromRow).filter((anchor) => anchor !== null));

  if (anchors.length === 0) {
    return null;
  }
  if (anchors.length === 1) {
    return anchors[0];
  }

  const side = anchors.every((anchor) => anchor.side === SIDE_OLD) ? SIDE_OLD : SIDE_NEW;
  // Numbers come from the rows that sit on the chosen side, so a deleted line caught
  // inside a new-side span does not drag the range onto the other file's numbering
  const onSide = anchors.filter((anchor) => anchor.side === side);
  const numbered = onSide.length === 0 ? anchors : onSide;

  return {
    side,
    start: Math.min(...numbered.map((anchor) => anchor.start)),
    end: Math.max(...numbered.map((anchor) => anchor.end)),
    lines: anchors.flatMap((anchor) => anchor.lines),
  };
}

/** Append a comment, returning a new list. */
function addComment(comments, comment) {
  return [...comments, comment];
}

/** Remove the comment at an index, returning a new list. */
function removeCommentAt(comments, index) {
  if (index < 0 || index >= comments.length) {
    return comments;
  }
  return comments.filter((_, position) => position !== index);
}

/** Number of comments per file, keyed by path. */
function countByFile(comments) {
  const counts = {};
  for (const comment of comments) {
    counts[comment.file] = (counts[comment.file] || 0) + 1;
  }
  return counts;
}

function formatRange(comment) {
  return comment.start === comment.end
    ? String(comment.start)
    : `${comment.start}-${comment.end}`;
}

const BACKTICK = "`";
const MIN_FENCE_LENGTH = 3;
const BACKTICK_RUN = /`+/g;

/**
 * A fence long enough to hold the lines it wraps.
 *
 * The snippet is verbatim source, so it can itself contain a fence — a context line
 * of a markdown file arrives here as " ```", and one leading space is still a closing
 * fence. Outrunning the longest backtick run in the snippet keeps the block whole.
 */
function fenceFor(lines) {
  let longestRun = 0;

  for (const line of lines) {
    for (const run of line.match(BACKTICK_RUN) || []) {
      longestRun = Math.max(longestRun, run.length);
    }
  }

  return BACKTICK.repeat(Math.max(MIN_FENCE_LENGTH, longestRun + 1));
}

function formatOne(comment) {
  const location = `${comment.file}:${formatRange(comment)}`;
  const fence = fenceFor(comment.lines);

  return [
    `### ${location} (${comment.side} side)`,
    "",
    `${fence}diff`,
    ...comment.lines,
    fence,
    "",
    comment.text,
  ].join("\n");
}

/** Whether an entry is a question rather than a review comment. */
function isQuestion(entry) {
  return entry.kind === KIND_QUESTION;
}

/**
 * One question, with the command that answers it underneath.
 *
 * The command is spelled out per question because bin/note.js writes one note per run:
 * five questions are five commands, and a batch that showed one would have four answers
 * land on the same line or not land at all.
 */
function formatQuestion(question) {
  return [formatOne(question), "", "```sh", question.reply, "```"].join("\n");
}

function countedAs(count, noun) {
  return `${count} ${count === 1 ? noun : noun + "s"}`;
}

/**
 * What a list of things to send is called, in as few words as it takes.
 * Used by the header, the send list and the guard on the quit key, so that all three
 * say the same thing about the same list.
 */
function describeEntries(entries) {
  const questions = entries.filter(isQuestion).length;
  const comments = entries.length - questions;

  if (questions === 0) {
    return countedAs(comments, "comment");
  }
  if (comments === 0) {
    return countedAs(questions, "question");
  }
  return `${countedAs(comments, "comment")}, ${countedAs(questions, "question")}`;
}

/**
 * Render everything chosen as one markdown document for an agent to act on.
 *
 * Two sections, because the two are different requests: the comments are things to
 * change, and the questions are things to answer and change nothing about. A batch of
 * comments alone is exactly the document it has always been.
 *
 * @param {Array<object>} entries Comments and questions, in the order they were written
 * @returns {string} Empty string when there is nothing to send
 */
function formatBatch(entries) {
  if (entries.length === 0) {
    return "";
  }

  const questions = entries.filter(isQuestion);
  const comments = entries.filter((entry) => !isQuestion(entry));
  const sections = [];

  if (comments.length > 0) {
    const noun = comments.length === 1 ? "comment" : "comments";
    sections.push(
      `Code review: ${comments.length} ${noun}. Please address each one.\n\n` +
        comments.map(formatOne).join("\n\n")
    );
  }

  if (questions.length > 0) {
    const noun = questions.length === 1 ? "question" : "questions";
    sections.push(
      [
        `${questions.length} ${noun} about this code. Please answer, and change nothing.`,
        "Answer each by running the command under it, so the answer appears beside the",
        "line it is about. Several lines can be piped in with `-` in place of the answer.",
        "",
        questions.map(formatQuestion).join("\n\n"),
      ].join("\n")
    );
  }

  // A blank line between entries keeps each one readable on its own
  return sections.join("\n\n") + "\n";
}

module.exports = {
  KIND_QUESTION,
  SIDE_NEW,
  SIDE_OLD,
  SIGNS,
  addComment,
  anchorFromRow,
  anchorFromRows,
  countByFile,
  describeEntries,
  fenceFor,
  formatBatch,
  isQuestion,
  removeCommentAt,
};
