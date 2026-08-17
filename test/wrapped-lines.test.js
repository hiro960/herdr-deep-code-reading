"use strict";

// A line too long for the pane becomes several rows rather than being cut off.
//
// Regression: reading a Japanese file, everything past the pane's width was simply
// gone — no wrap, no scroll, and nothing to say a line had been cut.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const { createState, reduce, toScreenModel, withLayout } = require("../lib/app-state");
const { chromeRows, renderScreen } = require("../lib/render");
const { readTextWidth } = require("../lib/layout");
const { formatBatch } = require("../lib/comments");
const { displayWidth, prepareLine } = require("../lib/text");
const { buildContentRows } = require("../lib/file-view");
const { detectLanguage } = require("../lib/syntax");

const VIEWPORT = 20;
const COLUMNS = 179;
const GIT_IDENTITY = ["-c", "user.email=t@t", "-c", "user.name=t"];

const ESC = "";
const CURSOR = new RegExp(ESC + "\\[\\d+;\\d+H", "g");
const HOME = new RegExp(ESC + "\\[H", "g");
const ERASE = new RegExp(ESC + "\\[0K", "g");
const SGR = new RegExp(ESC + "\\[[0-9;]*m", "g");

// 220 columns of Japanese: 110 characters, which is what makes counting characters
// instead of columns cut it in the wrong place
const LONG_JA =
  "この行はとても長い日本語の文章です。ファイルビューで読んでいるときに、" +
  "画面の幅を超えた分がどこへ行ってしまうのかを確かめるために書いています。" +
  "折り返されるのが自然ですが、いまは切り捨てられているはずです。さらに続けます。";

function run(cwd, args) {
  execFileSync("git", args, { cwd, stdio: "ignore" });
}

function makeRepo(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "herdr-deep-code-reading-wrap-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  run(root, ["init", "-q"]);
  fs.writeFileSync(path.join(root, "notes.md"), ["# 見出し", LONG_JA, "短い行", "needle here", ""].join("\n"));
  run(root, ["add", "-A"]);
  run(root, [...GIT_IDENTITY, "commit", "-qm", "init"]);

  return root;
}

function press(state, keys) {
  return keys.reduce((current, key) => reduce(current, key, VIEWPORT), state);
}

/** Open notes.md in the reader. */
function openNotes(root, columns) {
  const state = press(createState(root, "files", columns || COLUMNS), ["l"]);
  assert.strictEqual(state.openPath, "notes.md");
  return state;
}

function rowsOfLine(state, line) {
  return state.rows.filter((row) => row.kind === "line" && row.cell.num === line);
}

function toPlainLines(frame) {
  return frame
    .replace(HOME, "")
    .replace(ERASE, "")
    .replace(CURSOR, "\n")
    .replace(SGR, "")
    .replace(/^\n/, "")
    .split("\n");
}

// --- the wrap itself --------------------------------------------------------

test("a line too wide for the pane gets more than one row", (t) => {
  const root = makeRepo(t);

  assert.ok(rowsOfLine(openNotes(root), 2).length > 1, "the long line still fits on one row");
});

test("nothing of the line is lost to the wrap", (t) => {
  // The whole point: what used to fall off the right edge is now on the next row
  const root = makeRepo(t);

  const shown = rowsOfLine(openNotes(root), 2)
    .map((row) => row.cell.text)
    .join("");

  assert.strictEqual(shown, LONG_JA);
});

test("no piece of a wrapped line is wider than the pane gives it", (t) => {
  const root = makeRepo(t);

  for (const columns of [80, 100, 120, 179, 240]) {
    const state = withLayout(openNotes(root, columns), columns);
    for (const row of rowsOfLine(state, 2)) {
      assert.ok(
        displayWidth(row.cell.text) <= readTextWidth(columns),
        `at ${columns} columns a piece is ${displayWidth(row.cell.text)} wide`
      );
    }
  }
});

test("a short line still gets exactly one row", (t) => {
  const root = makeRepo(t);

  assert.strictEqual(rowsOfLine(openNotes(root), 3).length, 1);
});

// --- following the terminal -------------------------------------------------

test("a resize rewraps the file to the new width", (t) => {
  const root = makeRepo(t);
  const wide = openNotes(root, 240);
  const atWide = rowsOfLine(wide, 2).length;

  const narrow = withLayout(wide, 80);

  assert.ok(rowsOfLine(narrow, 2).length > atWide, "narrowing did not add rows");
  assert.strictEqual(rowsOfLine(narrow, 2).map((row) => row.cell.text).join(""), LONG_JA);
});

test("a resize keeps the reader on the line they were reading", (t) => {
  // Regression: rewrapping rebuilt the rows and reset the cursor to the top, and
  // dragging a terminal fires a resize for every column it passes through — so a
  // reader 60 lines into a file was thrown back to line 1 sixty times over
  const root = makeRepo(t);
  fs.writeFileSync(
    path.join(root, "long.js"),
    Array.from({ length: 200 }, (_, i) => `const line${i} = ${i};`).join("\n") + "\n"
  );
  run(root, ["add", "-A"]);

  // long.js sorts before notes.md, so it is the entry the browser opens on
  const opened = press(createState(root, "files", COLUMNS), ["l"]);
  assert.strictEqual(opened.openPath, "long.js");
  const reading = press(opened, Array.from({ length: 60 }, () => "j"));
  const line = reading.rows[reading.cursor].cell.num;
  const offset = reading.cursor - reading.scroll;
  assert.ok(line > 1, "the cursor never left the first line");

  for (const columns of [178, 120, 80, 240]) {
    const resized = withLayout(reading, columns);
    assert.strictEqual(
      resized.rows[resized.cursor].cell.num,
      line,
      `resizing to ${columns} moved the cursor off line ${line}`
    );
    assert.strictEqual(resized.cursor - resized.scroll, offset, "the line moved up the screen");
  }
});

test("dragging a terminal narrower keeps the place the whole way", (t) => {
  const root = makeRepo(t);
  const reading = press(openNotes(root), ["j", "j"]);
  const line = reading.rows[reading.cursor].cell.num;

  let dragged = reading;
  for (let columns = COLUMNS; columns >= 80; columns -= 1) {
    dragged = withLayout(dragged, columns);
  }

  assert.strictEqual(dragged.rows[dragged.cursor].cell.num, line);
});

test("coming back after a resize brings the file back at the new width", (t) => {
  // Regression: a place carries the rows it was looking at, wrapped to the width of
  // the terminal at the time. Resizing while away and then stepping back drew those
  // rows at a width they were not built for, cutting the end off every piece.
  const root = makeRepo(t);
  const wide = openNotes(root, 240);
  const away = reduce(wide, "o", VIEWPORT);
  assert.strictEqual(away.view, "search");

  const narrowed = withLayout(away, 80);
  const back = reduce(narrowed, "h", VIEWPORT);

  assert.strictEqual(back.view, "read");
  assert.strictEqual(rowsOfLine(back, 2).map((row) => row.cell.text).join(""), LONG_JA);
  for (const row of rowsOfLine(back, 2)) {
    assert.ok(
      displayWidth(row.cell.text) <= readTextWidth(80),
      `a piece is ${displayWidth(row.cell.text)} columns in an 80 column terminal`
    );
  }
});

test("a run marked across a wrapped line and the next quotes both, once each", (t) => {
  const root = makeRepo(t);
  const state = openNotes(root);
  const first = state.rows.indexOf(rowsOfLine(state, 2)[0]);
  const pieces = rowsOfLine(state, 2).length;

  // From the top of the wrapped line, down past its last piece onto line 3
  const keys = ["v", ...Array.from({ length: pieces }, () => "j"), "c", "n", "o", "enter"];
  const written = press({ ...state, cursor: first }, keys);

  const comment = written.comments[0];
  assert.strictEqual(comment.start, 2);
  assert.strictEqual(comment.end, 3);
  assert.deepStrictEqual(comment.lines, [" " + LONG_JA, " 短い行"]);
});

test("the frame and the wrap agree on the width", (t) => {
  // They are separate calculations of the same number, so nothing but a test
  // stops them drifting — and drifting means text cut off again
  const root = makeRepo(t);

  for (const columns of [80, 100, 179, 240]) {
    const state = withLayout(openNotes(root, columns), columns);
    const lines = toPlainLines(renderScreen(toScreenModel(state), { columns, rows: 14 }));

    for (const [index, line] of lines.entries()) {
      assert.strictEqual(
        displayWidth(line),
        columns,
        `line ${index + 1} is ${displayWidth(line)} columns at width ${columns}`
      );
    }
    assert.strictEqual(lines.length, 14);
    assert.ok(chromeRows(toScreenModel(state), columns) >= 2);
  }
});

test("only the first row of a wrapped line is numbered", (t) => {
  const root = makeRepo(t);
  const state = openNotes(root);
  const rows = rowsOfLine(state, 2);

  assert.strictEqual(rows[0].cell.continues, false);
  for (const row of rows.slice(1)) {
    assert.strictEqual(row.cell.continues, true);
  }

  const lines = toPlainLines(renderScreen(toScreenModel(state), { columns: COLUMNS, rows: 14 }));
  const continuation = lines.find((line) => line.includes("いまは切り捨てられて"));
  assert.doesNotMatch(continuation.slice(0, 8), /\d/, "a continuation row carried a line number");
});

// --- the pieces and their colours have to describe the same line -------------

test("the highlighting of a wrapped line still spells the line", (t) => {
  // Regression: tokens were taken from the raw line and cut by offsets into the
  // prepared one. A tab is one character in the file and four on screen, so every
  // token after it was cut in the wrong place — and since a highlighted row is
  // painted from its tokens, characters went missing on screen while the row's
  // own text still looked right.
  const root = makeRepo(t);
  const cases = {
    "tabbed.js": ["\tconst a = 1; // " + LONG_JA, "\t\t// " + LONG_JA],
    "spaced.js": ["    const a = 1; // " + LONG_JA],
    "quoted.ts": ['const x = "' + LONG_JA + '";'],
    "prose.md": ["# 見出し", LONG_JA],
    "plain.txt": [LONG_JA],
  };

  for (const [name, lines] of Object.entries(cases)) {
    fs.writeFileSync(path.join(root, name), lines.join("\n") + "\n");
  }
  run(root, ["add", "-A"]);

  for (const [name, lines] of Object.entries(cases)) {
    const language = detectLanguage(name);

    for (let width = 12; width <= 200; width += 7) {
      const rows = buildContentRows({ ok: true, lines }, language, width);

      for (let line = 1; line <= lines.length; line += 1) {
        const mine = rows.filter((row) => row.kind === "line" && row.cell.num === line);
        const expected = prepareLine(lines[line - 1]);

        assert.strictEqual(
          mine.map((row) => row.cell.text).join(""),
          expected,
          `${name} line ${line} at width ${width}: the pieces do not spell the line`
        );
        assert.strictEqual(
          mine.flatMap((row) => row.cell.tokens || []).map((token) => token.text).join(""),
          expected,
          `${name} line ${line} at width ${width}: the colours do not spell the line`
        );
      }
    }
  }
});

test("a tabbed line reaches the screen with every character on it", (t) => {
  const root = makeRepo(t);
  fs.writeFileSync(path.join(root, "tabbed.js"), "\tconst a = 1; // " + LONG_JA + "\n");
  run(root, ["add", "-A"]);

  const opened = press(createState(root, "files", COLUMNS), ["j", "l"]);
  assert.strictEqual(opened.openPath, "tabbed.js");

  // Tall enough that nothing scrolls, so a body row is a state row
  const model = toScreenModel(opened);
  const height = opened.rows.length + chromeRows(model, COLUMNS) + 1;
  const lines = toPlainLines(renderScreen(model, { columns: COLUMNS, rows: height }));
  const chrome = 9; // gutter(2) + number(5) + space and sign(2)

  const drawn = opened.rows
    .map((row, index) => (row.kind === "line" ? lines[index + 1].slice(chrome).replace(/\s+$/, "") : ""))
    .join("");

  assert.strictEqual(drawn, prepareLine("\tconst a = 1; // " + LONG_JA).replace(/\s+$/, ""));
});

test("a highlighted line starts in the same column as a plain one", (t) => {
  // They used to differ by one, which gave a wrapped highlighted line a column
  // more than the wrap had allowed and cost it its last character
  const root = makeRepo(t);
  const state = openNotes(root);
  const model = toScreenModel(state);
  const height = state.rows.length + chromeRows(model, COLUMNS) + 1;

  const withCursorAway = toPlainLines(renderScreen(model, { columns: COLUMNS, rows: height }));
  const onTheLine = toPlainLines(
    renderScreen(toScreenModel({ ...state, cursor: 0, column: 0 }), { columns: COLUMNS, rows: height })
  );

  // Row 1 is "# 見出し"; the text must begin at the same column either way
  assert.strictEqual(
    withCursorAway[1].indexOf("#"),
    onTheLine[1].indexOf("#"),
    "the text moved sideways when the cursor arrived"
  );
});

// --- comments on a wrapped line ---------------------------------------------

test("a comment written on a continuation quotes the whole line", (t) => {
  const root = makeRepo(t);
  const state = openNotes(root);
  const rows = rowsOfLine(state, 2);
  const secondPiece = state.rows.indexOf(rows[1]);

  const written = press({ ...state, cursor: secondPiece }, ["c", "n", "o", "enter"]);

  assert.strictEqual(written.comments.length, 1);
  assert.strictEqual(written.comments[0].start, 2);
  assert.deepStrictEqual(written.comments[0].lines, [" " + LONG_JA]);
});

test("marking the whole wrapped line quotes it once, not once per row", (t) => {
  const root = makeRepo(t);
  const state = openNotes(root);
  const rows = rowsOfLine(state, 2);
  const first = state.rows.indexOf(rows[0]);

  // v, then down over every remaining piece of the same line
  const keys = ["v", ...rows.slice(1).map(() => "j"), "c", "n", "o", "enter"];
  const written = press({ ...state, cursor: first }, keys);

  assert.strictEqual(written.comments[0].lines.length, 1);
  assert.match(formatBatch(written.comments), /### notes\.md:2 \(new side\)/);
});

test("x deletes the comment from any row of the wrapped line", (t) => {
  const root = makeRepo(t);
  const state = openNotes(root);
  const rows = rowsOfLine(state, 2);
  const first = state.rows.indexOf(rows[0]);

  const written = press({ ...state, cursor: first }, ["c", "n", "o", "enter"]);
  assert.strictEqual(written.comments.length, 1);

  const deleted = reduce({ ...written, cursor: first + 1 }, "x", VIEWPORT);

  assert.strictEqual(deleted.comments.length, 0);
});

test("the gutter marks every row of a commented wrapped line", (t) => {
  const root = makeRepo(t);
  const state = openNotes(root);
  const first = state.rows.indexOf(rowsOfLine(state, 2)[0]);

  const written = press({ ...state, cursor: first }, ["c", "n", "o", "enter"]);

  assert.ok(toScreenModel(written).commentKeys.has("new:2"));
});

// --- line numbers are no longer row indexes ---------------------------------

test("a search hit lands on its line even when a line above it wrapped", (t) => {
  // Regression risk introduced by wrapping: hit.line - 1 was the row index, and
  // once anything above the hit takes two rows it names an unrelated line
  const root = makeRepo(t);
  const searched = press(createState(root, "files", COLUMNS), [
    "/", "n", "e", "e", "d", "l", "e", "enter",
  ]);
  assert.strictEqual(searched.view, "search");
  const hit = searched.rows.find((row) => row.kind === "hit").hit;
  assert.strictEqual(hit.line, 4, "the fixture stopped putting the needle on line 4");

  const opened = reduce(searched, "enter", VIEWPORT);

  assert.strictEqual(opened.rows[opened.cursor].cell.num, hit.line);
  assert.match(opened.rows[opened.cursor].cell.text, /needle/);
});

test("an outline entry lands on its line too", (t) => {
  const root = makeRepo(t);
  const outline = reduce(openNotes(root), "o", VIEWPORT);
  const heading = outline.rows.find((row) => row.kind === "hit").hit;

  const jumped = reduce(outline, "l", VIEWPORT);

  assert.strictEqual(jumped.rows[jumped.cursor].cell.num, heading.line);
});
