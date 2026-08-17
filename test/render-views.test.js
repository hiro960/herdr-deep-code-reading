"use strict";

// Every view must fill the terminal exactly. A line that is one column too wide
// wraps and shifts everything below it, which no other test would catch.

const test = require("node:test");
const assert = require("node:assert");

const { chromeRows, renderScreen } = require("../lib/render");
const { displayWidth } = require("../lib/text");

const ESC = "\u001b";
const SGR = new RegExp(ESC + "\\[[0-9;]*m", "g");
const CURSOR = new RegExp(ESC + "\\[\\d+;\\d+H", "g");
const ERASE = new RegExp(ESC + "\\[0K", "g");
const HOME = new RegExp(ESC + "\\[H", "g");

const WIDTHS = [70, 100, 120, 179, 240];

function toPlainLines(frame) {
  return frame
    .replace(HOME, "")
    .replace(ERASE, "")
    .replace(CURSOR, "\n")
    .replace(SGR, "")
    .replace(/^\n/, "")
    .split("\n");
}

function assertExactWidth(model, columns, rows) {
  const lines = toPlainLines(renderScreen(model, { columns, rows }));

  for (const [index, line] of lines.entries()) {
    assert.strictEqual(
      displayWidth(line),
      columns,
      `line ${index + 1} is ${displayWidth(line)} columns at width ${columns}`
    );
  }
  assert.strictEqual(lines.length, rows);
}

const BASE = {
  title: "t",
  subtitle: "s",
  files: [],
  selectedIndex: 0,
  rows: [],
  scroll: 0,
  cursor: 0,
  focus: "panel",
  commentKeys: new Set(),
  input: null,
  picker: null,
  help: "help",
  message: null,
};

// Full-width names and a nested directory are what stress the column maths
const BROWSE = {
  ...BASE,
  view: "browse",
  browse: {
    dir: "lib",
    filter: "",
    index: 0,
    entries: [
      { name: "ansi.js", path: "lib/ansi.js", isDirectory: false },
      { name: "deep", path: "lib/deep", isDirectory: true },
      { name: "とても長い日本語のファイル名.js", path: "lib/x.js", isDirectory: false },
    ],
    parentEntries: [
      { name: "lib", path: "lib", isDirectory: true },
      { name: "README.md", path: "README.md", isDirectory: false },
    ],
    parentIndex: 0,
  },
  preview: [
    { kind: "line", cell: { num: 1, text: "const 日本語 = 1;", type: "context", tokens: null } },
    { kind: "entry", entry: { name: "child.js", path: "lib/deep/child.js", isDirectory: false } },
  ],
};

const SEARCH = {
  ...BASE,
  view: "search",
  rows: [
    {
      kind: "hit",
      hit: { path: "lib/very/long/path/to/a/file.js", line: 1234, text: "  const 日本語 = 1;" },
    },
    { kind: "note", text: "No matches" },
  ],
};

const READ = {
  ...BASE,
  view: "read",
  openPath: "a.js",
  rows: [
    {
      kind: "line",
      cell: {
        num: 1,
        text: "const x = 1; // 日本語コメント",
        type: "context",
        tokens: [
          { text: "const", type: "keyword" },
          { text: " x = ", type: "plain" },
          { text: "1", type: "number" },
          { text: "; ", type: "plain" },
          { text: "// 日本語コメント", type: "comment" },
        ],
      },
    },
  ],
};

test("the file browser fills the terminal at every width", () => {
  for (const columns of WIDTHS) {
    assertExactWidth(BROWSE, columns, 12);
  }
});

test("the browser fills the terminal while a filter is active", () => {
  const filtered = { ...BROWSE, browse: { ...BROWSE.browse, filter: "日本" } };

  for (const columns of WIDTHS) {
    assertExactWidth(filtered, columns, 12);
  }
});

test("the browser fills the terminal at the repository root", () => {
  const atRoot = {
    ...BROWSE,
    browse: { ...BROWSE.browse, dir: "", parentEntries: [], parentIndex: -1 },
  };

  for (const columns of WIDTHS) {
    assertExactWidth(atRoot, columns, 12);
  }
});

test("the search results fill the terminal at every width", () => {
  for (const columns of WIDTHS) {
    assertExactWidth(SEARCH, columns, 8);
  }
});

test("a search hit fills the terminal when its path is full-width", () => {
  // Regression: the location was truncated to half the row, and a full-width
  // character straddling that mark gave back one column less than was reserved.
  // An all-wide path is what makes the boundary land mid-character.
  const wide = {
    ...SEARCH,
    rows: [{ kind: "hit", hit: { path: "本".repeat(40), line: 7, text: "const x = 1;" } }],
  };

  // Every width, not just the usual five: the mismatch only shows on half the rows
  for (let columns = 40; columns <= 240; columns += 1) {
    assertExactWidth(wide, columns, 6);
  }
});

test("the reading view fills the terminal at every width", () => {
  for (const columns of WIDTHS) {
    assertExactWidth(READ, columns, 8);
  }
});

test("a highlighted line never overflows its column", () => {
  // Tokens are painted one by one, so their widths have to add up exactly
  const long = {
    ...READ,
    rows: [
      {
        kind: "line",
        cell: {
          num: 1,
          text: "x".repeat(400),
          type: "context",
          tokens: [
            { text: "const", type: "keyword" },
            { text: " " + "x".repeat(400), type: "plain" },
          ],
        },
      },
    ],
  };

  for (const columns of WIDTHS) {
    assertExactWidth(long, columns, 6);
  }
});

test("a message does not change how tall the footer is", () => {
  // Regression: the height came from message-or-help, so every "Comment saved"
  // reflowed the whole body by a row and snapped it back on the next keystroke
  const wordy = {
    ...READ,
    help: Array.from({ length: 20 }, (_, index) => `k${index} does thing ${index}`).join("  "),
  };
  const speaking = { ...wordy, message: "Comment saved (1 total)" };

  for (const columns of WIDTHS) {
    assert.strictEqual(
      chromeRows(speaking, columns),
      chromeRows(wordy, columns),
      `the footer moved at ${columns} columns`
    );
    assertExactWidth(speaking, columns, 12);
  }
});

test("a message is shown without hiding the whole key list", () => {
  const wordy = {
    ...READ,
    help: Array.from({ length: 20 }, (_, index) => `k${index} does thing ${index}`).join("  "),
    message: "Comment saved (1 total)",
  };

  const lines = toPlainLines(renderScreen(wordy, { columns: 80, rows: 12 }));
  const footer = lines.slice(lines.length - chromeRows(wordy, 80) + 1);

  assert.match(footer[0], /Comment saved/);
  assert.ok(
    footer.slice(1).some((line) => /k\d+ does thing/.test(line)),
    "the key list vanished behind the message"
  );
});

test("a wrapping footer keeps the frame the height it was given", () => {
  // The footer carries every key the view binds, so a narrow terminal gives it
  // several rows — and the body has to give up exactly those rows, no more
  const wordy = {
    ...READ,
    help: Array.from({ length: 20 }, (_, index) => `k${index} does thing ${index}`).join("  "),
  };

  for (const columns of WIDTHS) {
    assertExactWidth(wordy, columns, 12);
  }
});

test("the word under the cursor keeps its row exactly one terminal wide", () => {
  // The reversed run is cut out of text that is already the right width; getting
  // the offsets wrong would take a column with it
  const line = "const withFilter = require('./browse-state');";
  for (let start = 0; start < line.length; start += 1) {
    const highlighted = {
      ...READ,
      cursor: 0,
      cursorActive: true,
      word: { start, end: Math.min(start + 6, line.length), text: "x" },
      rows: [{ kind: "line", cell: { num: 1, text: line, type: "context", tokens: null } }],
    };
    for (const columns of WIDTHS) {
      assertExactWidth(highlighted, columns, 6);
    }
  }
});

test("a highlighted word survives a line of full-width characters", () => {
  const highlighted = {
    ...READ,
    cursor: 0,
    cursorActive: true,
    word: { start: 4, end: 8, text: "name" },
    rows: [
      {
        kind: "line",
        cell: { num: 1, text: "// 日本語 name 日本語コメント", type: "context", tokens: null },
      },
    ],
  };

  for (let columns = 40; columns <= 200; columns += 1) {
    assertExactWidth(highlighted, columns, 5);
  }
});

test("the text input line fills the terminal", () => {
  for (const kind of ["comment", "commit", "filter", "search"]) {
    const typing = {
      ...BROWSE,
      input: { kind, text: "日本語を入力中", file: "a.js", start: 1 },
    };
    for (const columns of WIDTHS) {
      assertExactWidth(typing, columns, 8);
    }
  }
});
