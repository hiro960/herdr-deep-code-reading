"use strict";

// Who last touched each line, drawn down the left of a file being read.
//
// The commit list answers "what has happened here" one commit at a time. Blame
// answers a different shape of the same question: the whole file at once, every line
// labelled with the change it came from. Neither replaces the other — `H` on a marked
// run gives a line's entire history, this gives every line's last one — and reading
// unfamiliar code wants both.
//
// `git blame --porcelain` is the only output worth parsing. The human-readable form
// puts the author's name in the middle of the line, unquoted, so a name with a space
// or a bracket in it cannot be told from the rest of the row. The porcelain form is
// one header line per run of lines followed by named fields, and it only sends a
// commit's details the first time that commit appears — so the details are kept by
// sha and looked up for the runs that follow.

const { runGit } = require("./git");

// `abc1234 2026-08-15 ` — a short sha, a date, and the space that separates the
// column from the line it labels. Wide enough to be read, narrow enough that a file
// is still readable beside it.
const BLAME_WIDTH = 19;
const SHORT_SHA_LENGTH = 7;

const SECONDS_PER_MINUTE = 60;
const MILLISECONDS_PER_SECOND = 1000;

// `<sha> <original line> <final line> [<lines in this run>]`
const HEADER = /^([0-9a-f]{7,40}) (\d+) (\d+)(?: (\d+))?$/;

/**
 * The date a commit was authored, in the author's own timezone.
 *
 * git reports the time as a Unix timestamp and the zone separately, so the zone has
 * to be applied by hand. Reading in UTC would put a commit made on a Tokyo evening
 * on the day before, which is not the day its author would name.
 *
 * @param {string} time Seconds since the epoch, as git wrote them
 * @param {string} zone A `+0900`-shaped offset
 * @returns {string} `YYYY-MM-DD`, or an empty string when either is unreadable
 */
function dateOf(time, zone) {
  // An empty string is Number 0, which would date every unlabelled commit to 1970
  const seconds = time === undefined || time === "" ? NaN : Number(time);
  if (!Number.isFinite(seconds)) {
    return "";
  }

  const match = /^([+-])(\d{2})(\d{2})$/.exec(zone || "");
  const offset = match === null
    ? 0
    : (match[1] === "-" ? -1 : 1) * (Number(match[2]) * 60 + Number(match[3])) * SECONDS_PER_MINUTE;

  return new Date((seconds + offset) * MILLISECONDS_PER_SECOND).toISOString().slice(0, 10);
}

/** What one line's label reads, padded nowhere — the renderer owns the column. */
function labelFor(commit) {
  return `${commit.sha.slice(0, SHORT_SHA_LENGTH)} ${commit.date}`;
}

// What a sha may be made of, and no longer than one is. The label is built by labelFor
// and would be a sha whatever this said — but it is read back to be handed to git, and
// a value from a repository somebody else wrote is checked before it becomes an
// argument, not because this one can go wrong but because that is the rule here.
const SHA = /^[0-9a-f]{7,40}$/;

/**
 * The commit a label names: the sha it opens with, or null where there is none.
 * The blame column says which commit a line came from, and this is how the key that
 * opens that commit asks the row what it is looking at.
 */
function shaOfLabel(label) {
  const sha = String(label === null || label === undefined ? "" : label).split(" ")[0];
  return SHA.test(sha) ? sha : null;
}

/**
 * Read `git blame --porcelain` into a label per line.
 *
 * @returns {Map<number, string>} Final line number to `<short sha> <date>`
 */
function parseBlame(stdout) {
  const labels = new Map();
  if (!stdout) {
    return labels;
  }

  // Commit details arrive once, with the first run of lines that commit produced.
  // Every later run names the sha alone.
  const commits = new Map();
  let current = null;
  let line = 0;

  for (const text of stdout.split("\n")) {
    const header = HEADER.exec(text);
    if (header !== null) {
      const [, sha, , finalLine] = header;
      line = Number(finalLine);
      current = commits.get(sha);
      if (current === undefined) {
        current = { sha, date: "", author: "" };
        commits.set(sha, current);
      }
      continue;
    }

    if (current === null) {
      continue; // Output before any header; nothing to attach it to
    }

    if (text.startsWith("author-time ")) {
      current.time = text.slice("author-time ".length);
      continue;
    }
    if (text.startsWith("author-tz ")) {
      current.zone = text.slice("author-tz ".length);
      continue;
    }
    if (text.startsWith("author ")) {
      current.author = text.slice("author ".length);
      continue;
    }
    // A tab opens the line's own contents, which closes the run's header block.
    // By here the commit has whatever fields it was going to be given.
    if (text.startsWith("\t")) {
      if (current.date === "") {
        current.date = dateOf(current.time, current.zone);
      }
      labels.set(line, labelFor(current));
      current = null;
    }
  }

  return labels;
}

/**
 * Blame one file.
 *
 * A file git has never heard of — untracked, or gone — has no blame, and that is an
 * ordinary answer rather than a failure: the reader asked a question about history
 * of something with none.
 *
 * @returns {{ok: true, labels: Map<number, string>}|{ok: false, error: string}}
 */
function loadBlame(repoDir, filePath) {
  let result;
  try {
    result = runGit(repoDir, ["blame", "--porcelain", "--", filePath]);
  } catch (error) {
    return { ok: false, error: error.message };
  }

  if (result.status !== 0) {
    const detail = (result.stderr || "").trim();
    return { ok: false, error: detail || `exit code ${result.status}` };
  }

  return { ok: true, labels: parseBlame(result.stdout) };
}

module.exports = { BLAME_WIDTH, dateOf, labelFor, loadBlame, parseBlame, shaOfLabel };
