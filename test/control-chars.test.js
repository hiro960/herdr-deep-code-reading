"use strict";

// Control characters must not travel from a reviewed file into another pane's input.

const test = require("node:test");
const assert = require("node:assert");

const { formatBatch } = require("../lib/comments");
const { firstDiffRow, reduce, rowsForSelection } = require("../lib/app-state");
const { parseUnifiedDiff } = require("../lib/diff-parser");
const { PASTE_END, PASTE_START, wrapForPaste } = require("../lib/send");

const ESC = "\u001b";
const BELL = "\u0007";
const VIEWPORT = 10;

/** Every raw control character in the text, excluding tab and newline. */
function controlCharsIn(text) {
  return [...text].filter((char) => {
    const code = char.charCodeAt(0);
    return (code < 9 || (code > 10 && code < 32) || code === 127);
  });
}

test("strips control characters that came from the reviewed source", () => {
  // Arrange: a source line carrying a screen-clear and a title-setting sequence
  const line = `+const x = "${ESC}[2J${ESC}]0;pwned${BELL}";`;

  // Act
  const wrapped = wrapForPaste(
    formatBatch([
      { file: "evil.js", side: "new", start: 1, end: 1, lines: [line], text: "looks fine" },
    ])
  );

  // Assert: only the two paste markers may contain ESC
  const expectedEscapes = [...PASTE_START, ...PASTE_END].filter(
    (char) => char.charCodeAt(0) === 27
  ).length;
  assert.strictEqual(controlCharsIn(wrapped).length, expectedEscapes);
});

test("keeps newlines so the batch stays multi-line", () => {
  const wrapped = wrapForPaste("first\nsecond");

  assert.ok(wrapped.includes("first\nsecond"));
});

test("keeps tabs, which carry indentation", () => {
  assert.ok(wrapForPaste("a\tb").includes("a\tb"));
});

test("still strips a paste terminator hidden in the text", () => {
  const wrapped = wrapForPaste("before" + PASTE_END + "after");

  assert.strictEqual(wrapped.indexOf(PASTE_END), wrapped.length - PASTE_END.length);
});

// --- comment input -------------------------------------------------------

const DIFF = [
  "diff --git a/a.txt b/a.txt",
  "--- a/a.txt",
  "+++ b/a.txt",
  "@@ -1,2 +1,2 @@",
  "-old",
  "+new",
].join("\n");

function makeState() {
  const files = parseUnifiedDiff(DIFF).map((file) => ({ ...file, gitStatus: " M" }));
  const rows = rowsForSelection(files, 0, true);
  return {
    repoDir: "/repo",
    mode: "review",
    title: "t",
    branch: "main",
    files,
    sideBySide: true,
    selectedIndex: 0,
    rows,
    scroll: 0,
    cursor: firstDiffRow(rows),
    focus: "diff",
    comments: [],
    input: null,
    picker: null,
    message: null,
    effect: null,
    quit: false,
  };
}

test("ignores an unmapped control character while typing a comment", () => {
  // Ctrl+A has no binding, so it used to land in the text verbatim
  const opened = reduce(makeState(), "c", VIEWPORT);

  const typed = reduce(opened, "\u0001", VIEWPORT);

  assert.strictEqual(typed.input.text, "");
});

test("ignores a stray escape character while typing", () => {
  const opened = reduce(makeState(), "c", VIEWPORT);

  const typed = reduce(reduce(opened, "a", VIEWPORT), "\u007f", VIEWPORT);

  assert.strictEqual(typed.input.text, "a");
});

test("still accepts ordinary printable characters", () => {
  const opened = reduce(makeState(), "c", VIEWPORT);

  const typed = reduce(reduce(opened, "a", VIEWPORT), "!", VIEWPORT);

  assert.strictEqual(typed.input.text, "a!");
});

test("still accepts multi-byte characters", () => {
  const opened = reduce(makeState(), "c", VIEWPORT);

  const typed = reduce(reduce(opened, "日", VIEWPORT), "\u{1F363}", VIEWPORT);

  assert.strictEqual(typed.input.text, "日\u{1F363}");
});
