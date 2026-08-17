"use strict";

// A reading session, as one document.
//
// Four stores know something about the afternoon just spent: the journal knows what was
// opened, the read marks know what was finished, the notes hold what an agent answered,
// and the comments and questions of the session hold what the reader had to say. None of
// them is a thing to read back, and all four are about the same afternoon.
//
// This is the afternoon, in markdown: what was read, what was asked and what came back,
// and what the reader wrote. It is written out rather than kept — the store is not
// widened by this, and what leaves here is a file the reader owns.
//
// Everything here is pure. The clock arrives as an argument, so a test can hand in a
// day; lib/run/effects is where the real one is read and where the file is written.

const path = require("node:path");

const { fenceFor, isQuestion } = require("./comments");
const { isRead } = require("./read-commits");
const { KIND_COMMIT, KIND_FILE } = require("./journal");

// The same mark the file panel and the log put on something already read through
const READ_MARK = "✓";
// What a name is cut down to so that it can be a filename: anything else becomes a dash
const UNSAFE_NAME = /[^\w.-]+/g;

/** The day something happened, as the date a filename and a heading both want. */
function dayOf(when) {
  const at = new Date(when);
  const month = String(at.getMonth() + 1).padStart(2, "0");
  const day = String(at.getDate()).padStart(2, "0");
  return `${at.getFullYear()}-${month}-${day}`;
}

/** What the document is called: the repository, and the day it was read. */
function readingFilename(repoDir, when) {
  const name = path.basename(repoDir).replace(UNSAFE_NAME, "-");
  return `reading-${name}-${dayOf(when)}.md`;
}

/** Where a comment or a question points, said the way the rest of the plugin says it. */
function locationOf(entry) {
  const range = entry.start === entry.end ? entry.start : `${entry.start}-${entry.end}`;
  return `${entry.file}:${range}`;
}

/**
 * The lines an entry was written against, fenced as a diff.
 *
 * The fence is measured rather than fixed, the way the batch's is — see comments.fenceFor.
 * The lines are verbatim source, so they can hold a fence of their own: a context line of
 * a markdown file arrives here as " ```", and a three-backtick fence would close on it and
 * leave the rest of that file's text standing in the document as prose of the reader's.
 */
function quoted(lines) {
  const fence = fenceFor(lines);
  return [`${fence}diff`, ...lines, fence].join("\n");
}

/** The commits opened, and which of them were read through. */
function commitSection(entries, marks) {
  const commits = entries.filter((entry) => entry.kind === KIND_COMMIT);
  if (commits.length === 0) {
    return null;
  }

  const rows = commits.map((commit) => {
    const mark = isRead(marks, commit.sha) ? `${READ_MARK} ` : "";
    return `- ${mark}\`${commit.shortSha || commit.sha.slice(0, 7)}\` ${commit.subject || ""}`;
  });

  return [`## Commits (${commits.length})`, "", ...rows].join("\n");
}

/** The files opened, in the order they were. */
function fileSection(entries) {
  const files = entries.filter((entry) => entry.kind === KIND_FILE);
  if (files.length === 0) {
    return null;
  }

  return [`## Files (${files.length})`, "", ...files.map((file) => `- \`${file.path}\``)].join("\n");
}

/** The notes written against one line, which is where an answer to a question lands. */
function answersAt(notes, filePath, line) {
  return notes.filter((note) => note.path === filePath && note.line === line);
}

/** One question, with whatever came back to the line it was asked about. */
function questionEntry(question, notes) {
  const answers = answersAt(notes, question.file, question.start);
  const answered =
    answers.length === 0
      ? ["_unanswered_"]
      : answers.map((note) => `**${note.from || "agent"}** — ${note.text}`);

  return [
    `### ${locationOf(question)}`,
    "",
    quoted(question.lines),
    "",
    `**Q** ${question.text}`,
    "",
    ...answered,
  ].join("\n");
}

/** A note nobody asked for: an agent can leave one without being asked. */
function noteEntry(note) {
  return [`### ${note.path}:${note.line}`, "", `**${note.from || "agent"}** — ${note.text}`].join(
    "\n"
  );
}

/**
 * What was asked and what came back.
 *
 * The questions first, each with the answers that landed on the line it was asked
 * about, and then the notes that answer no question of the reader's.
 */
function questionSection(comments, notes) {
  const questions = comments.filter(isQuestion);
  const asked = new Set(questions.map((question) => `${question.file}:${question.start}`));
  const unasked = notes.filter((note) => !asked.has(`${note.path}:${note.line}`));

  if (questions.length === 0 && unasked.length === 0) {
    return null;
  }

  const entries = [
    ...questions.map((question) => questionEntry(question, notes)),
    ...unasked.map(noteEntry),
  ];

  return [`## Questions and answers (${entries.length})`, "", entries.join("\n\n")].join("\n");
}

/** What the reader had to say, as they wrote it. */
function commentSection(comments) {
  const written = comments.filter((entry) => !isQuestion(entry));
  if (written.length === 0) {
    return null;
  }

  const entries = written.map((comment) =>
    [
      `### ${locationOf(comment)} (${comment.side} side)`,
      "",
      quoted(comment.lines),
      "",
      comment.text,
    ].join("\n")
  );

  return [`## Comments (${entries.length})`, "", entries.join("\n\n")].join("\n");
}

/**
 * The whole session, as one markdown document.
 *
 * A section with nothing in it is left out rather than left empty: a document of five
 * headings and no content is one nobody reads twice.
 *
 * @param {number} when Epoch milliseconds, from the caller's clock
 * @returns {string} Empty when there is nothing to write
 */
function formatReading(state, when) {
  const journal = state.journal || [];
  const comments = state.comments || [];
  const notes = state.notes || [];

  const sections = [
    commitSection(journal, state.readCommits || []),
    fileSection(journal),
    questionSection(comments, notes),
    commentSection(comments),
  ].filter((section) => section !== null);

  if (sections.length === 0) {
    return "";
  }

  const heading = [`# Reading: ${path.basename(state.repoDir)}`, "", dayOf(when)].join("\n");
  return [heading, ...sections].join("\n\n") + "\n";
}

module.exports = { READ_MARK, formatReading, readingFilename };
