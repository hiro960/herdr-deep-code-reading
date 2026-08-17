"use strict";

const test = require("node:test");
const assert = require("node:assert");

const {
  addComment,
  anchorFromRow,
  countByFile,
  formatBatch,
  removeCommentAt,
} = require("../lib/comments");

const COMMENT = {
  file: "src/a.js",
  side: "new",
  start: 2,
  end: 2,
  lines: ['-  return "Hello, " + name;', "+  return `Hello, ${name}!`;"],
  text: "Why a template literal here?",
};

// --- anchors -------------------------------------------------------------

test("anchors a unified deleted line to the old side", () => {
  const row = { kind: "line", cell: { num: 7, text: "gone", type: "del" } };

  assert.deepStrictEqual(anchorFromRow(row), {
    side: "old",
    start: 7,
    end: 7,
    lines: ["-gone"],
  });
});

test("anchors a unified added line to the new side", () => {
  const row = { kind: "line", cell: { num: 9, text: "fresh", type: "add" } };

  assert.deepStrictEqual(anchorFromRow(row), {
    side: "new",
    start: 9,
    end: 9,
    lines: ["+fresh"],
  });
});

test("anchors a unified context line to the new side with a space marker", () => {
  const row = { kind: "line", cell: { num: 4, text: "keep", type: "context" } };

  assert.deepStrictEqual(anchorFromRow(row), {
    side: "new",
    start: 4,
    end: 4,
    lines: [" keep"],
  });
});

test("anchors a replaced pair to the new side and keeps both diff lines", () => {
  // Arrange: a deleted line paired with its replacement
  const row = {
    kind: "pair",
    left: { num: 2, text: "old", type: "del" },
    right: { num: 2, text: "new", type: "add" },
  };

  // Act / Assert
  assert.deepStrictEqual(anchorFromRow(row), {
    side: "new",
    start: 2,
    end: 2,
    lines: ["-old", "+new"],
  });
});

test("anchors a purely deleted pair to the old side", () => {
  const row = {
    kind: "pair",
    left: { num: 5, text: "gone", type: "del" },
    right: null,
  };

  assert.deepStrictEqual(anchorFromRow(row), {
    side: "old",
    start: 5,
    end: 5,
    lines: ["-gone"],
  });
});

test("anchors a purely added pair to the new side", () => {
  const row = {
    kind: "pair",
    left: null,
    right: { num: 8, text: "fresh", type: "add" },
  };

  assert.deepStrictEqual(anchorFromRow(row), {
    side: "new",
    start: 8,
    end: 8,
    lines: ["+fresh"],
  });
});

test("anchors a context pair to the new side once", () => {
  const row = {
    kind: "pair",
    left: { num: 3, text: "keep", type: "context" },
    right: { num: 3, text: "keep", type: "context" },
  };

  assert.deepStrictEqual(anchorFromRow(row), {
    side: "new",
    start: 3,
    end: 3,
    lines: [" keep"],
  });
});

test("refuses to anchor a hunk header", () => {
  assert.strictEqual(anchorFromRow({ kind: "hunk", text: "@@ -1 +1 @@" }), null);
});

test("refuses to anchor a note row", () => {
  assert.strictEqual(anchorFromRow({ kind: "note", text: "No changes" }), null);
});

// --- collection ----------------------------------------------------------

test("adds a comment without mutating the original list", () => {
  // Arrange
  const before = [];

  // Act
  const after = addComment(before, COMMENT);

  // Assert
  assert.strictEqual(before.length, 0);
  assert.strictEqual(after.length, 1);
  assert.notStrictEqual(before, after);
});

test("removes a comment without mutating the original list", () => {
  const before = addComment([], COMMENT);

  const after = removeCommentAt(before, 0);

  assert.strictEqual(before.length, 1);
  assert.strictEqual(after.length, 0);
});

test("ignores a removal index outside the list", () => {
  const before = addComment([], COMMENT);

  assert.deepStrictEqual(removeCommentAt(before, 5), before);
});

test("counts comments per file", () => {
  const comments = [
    COMMENT,
    { ...COMMENT, start: 4, end: 4 },
    { ...COMMENT, file: "src/b.js" },
  ];

  assert.deepStrictEqual(countByFile(comments), {
    "src/a.js": 2,
    "src/b.js": 1,
  });
});

test("counts nothing for an empty list", () => {
  assert.deepStrictEqual(countByFile([]), {});
});

// --- formatting ----------------------------------------------------------

test("formats a comment with its file, line, snippet, and text", () => {
  const batch = formatBatch([COMMENT]);

  assert.match(batch, /src\/a\.js:2/);
  assert.match(batch, /Why a template literal here\?/);
  assert.match(batch, /return `Hello/);
});

test("marks the snippet as a diff code block", () => {
  const batch = formatBatch([COMMENT]);

  assert.match(batch, /```diff/);
});

test("outruns a code fence quoted from the reviewed file", () => {
  // Regression: a context line of a markdown file arrives as " ```", and one
  // leading space is still a closing fence — the block ended on the snippet and
  // the reviewer's own note fell outside it.
  const onAFence = { ...COMMENT, file: "README.md", lines: [" ```", "-x", "+y"] };

  const batch = formatBatch([onAFence]);
  const opening = batch.match(/^(`{3,})diff$/m);

  assert.notStrictEqual(opening, null, "no opening fence");
  assert.ok(opening[1].length > 3, "the fence is no longer than the line it wraps");
  assert.ok(
    batch.includes(`\n${opening[1]}\n\n${onAFence.text}`),
    "the note is not inside the block the fence closes"
  );
});

test("keeps the plain three-backtick fence when the snippet has none", () => {
  const batch = formatBatch([{ ...COMMENT, lines: ["-old", "+new"] }]);

  assert.match(batch, /^```diff$/m);
});

test("shows a line range when the comment spans several lines", () => {
  const batch = formatBatch([{ ...COMMENT, start: 2, end: 5 }]);

  assert.match(batch, /src\/a\.js:2-5/);
});

test("states how many comments the batch carries", () => {
  const batch = formatBatch([COMMENT, { ...COMMENT, start: 9, end: 9 }]);

  assert.match(batch, /2 comments/);
});

test("uses the singular form for one comment", () => {
  assert.match(formatBatch([COMMENT]), /1 comment\b/);
});

test("returns an empty string for no comments", () => {
  assert.strictEqual(formatBatch([]), "");
});

test("keeps the old-side line number for an old-side comment", () => {
  const batch = formatBatch([{ ...COMMENT, side: "old", start: 11, end: 11 }]);

  assert.match(batch, /src\/a\.js:11/);
  assert.match(batch, /old/);
});

test("separates several comments so each is readable on its own", () => {
  const batch = formatBatch([COMMENT, { ...COMMENT, file: "src/b.js", text: "second" }]);

  assert.match(batch, /src\/a\.js/);
  assert.match(batch, /src\/b\.js/);
  assert.match(batch, /second/);
});

test("puts a blank line between consecutive comments", () => {
  const batch = formatBatch([COMMENT, { ...COMMENT, file: "src/b.js", text: "second" }]);

  // The previous comment's text must not run straight into the next heading
  assert.match(batch, /\n\n### src\/b\.js/);
});

test("ends the batch with a newline", () => {
  assert.ok(formatBatch([COMMENT]).endsWith("\n"));
});
