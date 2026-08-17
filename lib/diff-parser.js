"use strict";

// Turns git's unified diff output into structured data.
//
// git computes the diff; this module only parses it — with one exception, and it is
// one git does not offer. A unified diff says which lines changed and nothing about
// which words within them did, so the last pass here asks lib/word-diff to work that
// out and writes it onto the lines. It happens once, here, because doing it while
// drawing would mean walking the whole diff on every keystroke.

const { markWordSpans } = require("./word-diff");

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/;
const GIT_HEADER = /^diff --git a\/(.+) b\/(.+)$/;
const DEFAULT_HUNK_COUNT = 1;

const RENAME_FROM_PREFIX = "rename from ";
const RENAME_TO_PREFIX = "rename to ";

/** Strip the a/ or b/ prefix and any trailing timestamp from a header path. */
function stripPathPrefix(raw) {
  const path = raw.split("\t")[0].trim();
  if (path === "/dev/null") {
    return null;
  }
  if (path.startsWith("a/") || path.startsWith("b/")) {
    return path.slice(2);
  }
  return path;
}

function createFile() {
  return {
    oldPath: null,
    newPath: null,
    isNew: false,
    isDeleted: false,
    isRenamed: false,
    isBinary: false,
    hunks: [],
  };
}

function createHunk(match) {
  return {
    oldStart: Number(match[1]),
    oldCount: match[2] === undefined ? DEFAULT_HUNK_COUNT : Number(match[2]),
    newStart: Number(match[3]),
    newCount: match[4] === undefined ? DEFAULT_HUNK_COUNT : Number(match[4]),
    header: match[5].trim(),
    lines: [],
  };
}

/**
 * Handle a metadata line that appears outside a hunk.
 * Inside a hunk these are indistinguishable from deleted lines such as "--- x",
 * so the caller must guarantee the position.
 * @returns {boolean} true when the line was consumed
 */
function consumeMetaLine(file, line) {
  if (line.startsWith("new file mode")) {
    file.isNew = true;
    return true;
  }
  if (line.startsWith("deleted file mode")) {
    file.isDeleted = true;
    return true;
  }
  if (line.startsWith(RENAME_FROM_PREFIX)) {
    file.isRenamed = true;
    file.oldPath = line.slice(RENAME_FROM_PREFIX.length);
    return true;
  }
  if (line.startsWith(RENAME_TO_PREFIX)) {
    file.isRenamed = true;
    file.newPath = line.slice(RENAME_TO_PREFIX.length);
    return true;
  }
  if (line.startsWith("Binary files") || line.startsWith("GIT binary patch")) {
    file.isBinary = true;
    return true;
  }
  if (line.startsWith("--- ")) {
    file.oldPath = stripPathPrefix(line.slice(4));
    return true;
  }
  if (line.startsWith("+++ ")) {
    file.newPath = stripPathPrefix(line.slice(4));
    return true;
  }
  return false;
}

/** Classify one line of hunk body. Returns null when it is not a diff line. */
function classifyHunkLine(line) {
  if (line.startsWith("\\")) {
    return null; // "\ No newline at end of file"
  }
  if (line.startsWith(" ")) {
    return { type: "context", text: line.slice(1) };
  }
  if (line.startsWith("-")) {
    return { type: "del", text: line.slice(1) };
  }
  if (line.startsWith("+")) {
    return { type: "add", text: line.slice(1) };
  }
  return null;
}

/** Start a new file from its `diff --git` header. */
function beginFile(line) {
  const file = createFile();
  const match = GIT_HEADER.exec(line);
  if (match) {
    file.oldPath = match[1];
    file.newPath = match[2];
  }
  return file;
}

/**
 * A `/dev/null` on one side already cleared that path; make the flags agree so
 * callers can rely on a single source of truth.
 */
function normalizePaths(files) {
  for (const file of files) {
    if (file.isNew) {
      file.oldPath = null;
    }
    if (file.isDeleted) {
      file.newPath = null;
    }
  }
  return files;
}

/**
 * Parse unified diff text into per-file structures.
 * @param {string} text Raw output of `git diff`
 * @returns {Array<object>} One entry per file
 */
function parseUnifiedDiff(text) {
  if (!text) {
    return [];
  }

  const files = [];
  let file = null;
  let hunk = null;

  for (const line of text.split("\n")) {
    if (line.startsWith("diff --git ")) {
      file = beginFile(line);
      hunk = null;
      files.push(file);
      continue;
    }

    if (file === null) {
      continue; // Ignore any preamble before the first file header
    }

    const hunkMatch = HUNK_HEADER.exec(line);
    if (hunkMatch) {
      hunk = createHunk(hunkMatch);
      file.hunks.push(hunk);
      continue;
    }

    if (hunk === null) {
      consumeMetaLine(file, line);
      continue;
    }

    const parsed = classifyHunkLine(line);
    if (parsed !== null) {
      hunk.lines.push(parsed);
    }
  }

  return markWordSpans(normalizePaths(files));
}

module.exports = { parseUnifiedDiff };
