"use strict";

// Reading a whole file for the browsing view.
//
// The rows it produces are the same shape the unified diff layout uses, so the
// renderer and the comment anchors work on file contents without knowing the
// difference. A file line is anchored exactly like a diff context line.

const fs = require("node:fs");
const path = require("node:path");

const { tokenizeLines } = require("./syntax");
const { prepareLine } = require("./text");
const { sliceTokens, wrapSegments } = require("./wrap");

const MAX_FILE_BYTES = 2 * 1024 * 1024;
// A NUL this early means the file is not text worth showing line by line
const BINARY_PROBE_BYTES = 8 * 1024;
const NUL_BYTE = 0;

const NOTE_EMPTY = "Empty file";
const NOTE_BINARY = "Binary file — nothing to read here";

function looksBinary(buffer) {
  const limit = Math.min(buffer.length, BINARY_PROBE_BYTES);
  for (let index = 0; index < limit; index += 1) {
    if (buffer[index] === NUL_BYTE) {
      return true;
    }
  }
  return false;
}

/**
 * Resolve a path and prove it stays inside the repository.
 *
 * git tracks symlinks, so a repository can contain one pointing at anything on the
 * machine. Both ends are resolved through realpath before the comparison: the root
 * because a temporary directory is often itself a symlink, and the target because a
 * link is exactly what this is guarding against.
 *
 * @returns {{ok: true, path: string}|{ok: false, reason: string}}
 */
function resolveInsideRepo(repoDir, relativePath) {
  let root;
  try {
    root = fs.realpathSync(repoDir);
  } catch (error) {
    return { ok: false, reason: `Cannot read the repository: ${error.code || error.message}` };
  }

  let real;
  try {
    real = fs.realpathSync(path.resolve(root, relativePath));
  } catch (error) {
    return { ok: false, reason: `Cannot read ${relativePath}: ${error.code || error.message}` };
  }

  if (real !== root && !real.startsWith(root + path.sep)) {
    return { ok: false, reason: `${relativePath} is outside the repository` };
  }

  return { ok: true, path: real };
}

/** The deepest ancestor of a path that is actually there, which the root always is. */
function deepestExisting(dir) {
  let at = dir;

  for (;;) {
    if (fs.existsSync(at)) {
      return at;
    }
    const parent = path.dirname(at);
    if (parent === at) {
      return at;
    }
    at = parent;
  }
}

/**
 * Resolve a path that is not there yet, and prove that making it would stay inside
 * the repository.
 *
 * resolveInsideRepo cannot answer this: it resolves both ends through realpath, and
 * realpath fails on a name nothing has been written to. So the question is asked of
 * the deepest ancestor that does exist. That is not a technicality — it is the whole
 * check. git tracks symlinks, so a repository can carry `lib/elsewhere -> /etc`, and
 * `lib/elsewhere/hosts` normalizes clean, holds no `..`, and is outside the repository
 * anyway. Only resolving what exists finds that.
 *
 * @returns {{ok: true, path: string}|{ok: false, reason: string}}
 */
function resolveNewInsideRepo(repoDir, relativePath) {
  if (path.isAbsolute(relativePath)) {
    return { ok: false, reason: `${relativePath} is not a name inside the repository` };
  }

  const normalized = path.normalize(relativePath);
  if (
    normalized === "" ||
    normalized === "." ||
    normalized.split(path.sep).includes("..")
  ) {
    return { ok: false, reason: `${relativePath} is not a name inside the repository` };
  }

  let root;
  try {
    root = fs.realpathSync(repoDir);
  } catch (error) {
    return { ok: false, reason: `Cannot read the repository: ${error.code || error.message}` };
  }

  const target = path.resolve(root, normalized);
  const existing = deepestExisting(path.dirname(target));

  let real;
  try {
    real = fs.realpathSync(existing);
  } catch (error) {
    return { ok: false, reason: `Cannot read ${relativePath}: ${error.code || error.message}` };
  }

  if (real !== root && !real.startsWith(root + path.sep)) {
    return { ok: false, reason: `${relativePath} is outside the repository` };
  }

  // Built back from what the ancestor really is, so that the path handed on is the one
  // the containment check was made about
  return { ok: true, path: path.join(real, path.relative(existing, target)) };
}

/**
 * Read a repository file into lines.
 * @returns {{ok: true, lines: Array<string>}|{ok: false, reason: string}}
 */
function readFileLines(repoDir, relativePath) {
  const resolved = resolveInsideRepo(repoDir, relativePath);
  if (!resolved.ok) {
    return resolved;
  }
  const target = resolved.path;

  let stats;
  try {
    stats = fs.statSync(target);
  } catch (error) {
    return { ok: false, reason: `Cannot read ${relativePath}: ${error.code || error.message}` };
  }

  if (stats.isDirectory()) {
    return { ok: false, reason: `${relativePath} is a directory` };
  }
  if (stats.size > MAX_FILE_BYTES) {
    const megabytes = (MAX_FILE_BYTES / 1024 / 1024).toFixed(0);
    return { ok: false, reason: `File is too large to show (over ${megabytes}MB)` };
  }

  let buffer;
  try {
    buffer = fs.readFileSync(target);
  } catch (error) {
    return { ok: false, reason: `Cannot read ${relativePath}: ${error.code || error.message}` };
  }

  if (looksBinary(buffer)) {
    // Told apart from the other refusals: a binary file is a fact about the file,
    // and a caller building a diff entry marks it binary rather than quoting a reason
    return { ok: false, reason: NOTE_BINARY, isBinary: true };
  }

  const text = buffer.toString("utf8");
  if (text === "") {
    return { ok: true, lines: [] };
  }

  const lines = text.split("\n");
  // A trailing newline produces one empty element that is not a line of the file
  if (lines[lines.length - 1] === "") {
    lines.pop();
  }

  return { ok: true, lines: lines.map((line) => line.replace(/\r$/, "")) };
}

/**
 * The rows one line of a file needs.
 *
 * A line too long for the pane becomes several rows rather than being cut off with
 * the rest thrown away — which is what a line of Japanese, half as many characters
 * as it is columns, does almost immediately.
 *
 * Every row of the run keeps the line's real number and the whole line beside it, so
 * a comment written on any of them quotes the line rather than the piece: the number
 * is what the gutter mark and the delete key match on, and `full` is what reaches the
 * agent. Only `continues` tells the renderer to leave the number column blank.
 */
function rowsForLine(prepared, num, tokens, width, blame) {
  return wrapSegments(prepared, width).map((segment, index) => ({
    kind: "line",
    cell: {
      num,
      text: prepared.slice(segment.from, segment.to),
      type: "context",
      tokens: sliceTokens(tokens, segment.from, segment.to),
      full: prepared,
      continues: index > 0,
      // The blame column, when one was asked for. Present-but-empty on the rows a
      // wrapped line continues onto: they are the same line and it has been labelled
      // already, but the column still has to be there or the text below it would
      // start further left than the text above.
      ...(blame === null || blame === undefined
        ? {}
        : { blame: index > 0 ? "" : blame.get(num) || "" }),
    },
  }));
}

/**
 * Turn a read result into display rows.
 * Highlighting happens here, once per file, rather than on every frame.
 * @param {object} result What readFileLines returned
 * @param {string} [language] Language for highlighting; omit to leave text plain
 * @param {number} [width] Columns a line gets; omit to leave long lines uncut
 * @param {Map<number, string>} [blame] Line number to its blame label; omit for none
 * @returns {Array<{kind: string}>} One element per screen row
 */
function buildContentRows(result, language, width, blame) {
  if (!result.ok) {
    return [{ kind: "note", text: result.reason }];
  }
  if (result.lines.length === 0) {
    return [{ kind: "note", text: NOTE_EMPTY }];
  }

  // Prepared first, tokenized second. A tab is one character in the file and four
  // on screen, so tokenizing the raw line would number its tokens in a coordinate
  // system the wrap does not share — and slicing one by the other's offsets shifts
  // every token after the tab, which on screen reads as characters going missing.
  const prepared = result.lines.map(prepareLine);
  const highlighted =
    language === undefined || language === null ? null : tokenizeLines(prepared, language);
  const room = width === undefined || width === null ? Infinity : width;

  return prepared.flatMap((text, index) =>
    rowsForLine(text, index + 1, highlighted === null ? null : highlighted[index], room, blame)
  );
}

/**
 * The row a line number lands on.
 *
 * Wrapping breaks the one-row-per-line rule the rest of the tool is built on, so
 * anything holding a line number — a search hit, an outline entry — has to ask
 * rather than subtract one.
 *
 * @returns {number} The row index, or -1 when the line is not among these rows
 */
function rowOfLine(rows, line) {
  return rows.findIndex(
    (row) => row.kind === "line" && row.cell.num === line && !row.cell.continues
  );
}

module.exports = {
  MAX_FILE_BYTES,
  buildContentRows,
  readFileLines,
  resolveInsideRepo,
  resolveNewInsideRepo,
  rowOfLine,
};
