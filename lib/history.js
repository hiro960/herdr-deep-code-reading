"use strict";

// Reading the repository's past: which commits there are, and what each one did.
//
// The three diffs the pane opened with — the working tree, the index, the branch —
// all answer "what is changing now". Deep reading asks the other question: why is
// this line the way it is, and the answer is always in a commit. This module lists
// them; ./git turns a chosen one into a diff, through the same parser and the same
// rows every other diff goes through.
//
// Three lists, one shape. The whole repository, one file's history, and the history
// of a run of lines are the same question asked at three widths, so they differ only
// in the arguments handed to `git log`.

const { END_OF_OPTIONS, hasCommits, runGit } = require("./git");
const { parseParents } = require("./graph");

const NUL = "\u0000";
// A field separator no commit message contains. `git log -z` already separates one
// commit from the next; this separates the fields inside one.
const UNIT = "\u001f";

// %x1f is how git is asked to write the separator UNIT reads back. %P says whether a
// commit is a merge, which decides what its diff is against — see lib/git.js.
const COMMIT_FORMAT = "%H%x1f%h%x1f%P%x1f%ad%x1f%an%x1f%s";
const COMMIT_FIELDS = 6;

// A ceiling on how far back a list goes. Long enough to cover any reading session,
// short enough that opening the list on a repository with fifty thousand commits is
// still instant.
const MAX_COMMITS = 500;

const NOTE_NO_COMMITS = "No commits here";

/**
 * Read `git log -z` output written in COMMIT_FORMAT.
 * A record with the wrong number of fields is skipped rather than guessed at.
 * @returns {Array<{sha, shortSha, date, author, subject}>}
 */
function parseCommits(stdout) {
  if (!stdout) {
    return [];
  }

  const commits = [];

  for (const record of stdout.split(NUL)) {
    const trimmed = record.replace(/^\n+/, "");
    if (trimmed === "") {
      continue;
    }

    const fields = trimmed.split(UNIT);
    if (fields.length < COMMIT_FIELDS) {
      continue;
    }

    const [sha, shortSha, parents, date, author, ...subject] = fields;
    commits.push({
      sha,
      shortSha,
      parents: parseParents(parents),
      date,
      author,
      // A subject holding the separator would have split into more fields than
      // there are; joining them back is truer than dropping the commit
      subject: subject.join(UNIT),
    });
  }

  return commits;
}

/** The arguments common to every one of the three lists. */
function logOptions() {
  return ["--max-count=" + MAX_COMMITS, "--date=short", `--format=${COMMIT_FORMAT}`, "-z"];
}

/**
 * The git arguments for one of the lists.
 *
 * @param {{path?: string, start?: number, end?: number, text?: string, regex?: boolean}}
 *   [scope] Nothing for the whole repository, a path for one file, a path and a line
 *   range for a run of lines, or a text to search the history itself for
 */
function logArgs(scope) {
  if (scope && scope.text) {
    // The pickaxe. -S counts how many times the string appears in a commit's before
    // and after, and lists the commit only when the two differ — which is the
    // question "when did this arrive, and when did it go" rather than "which commits
    // mention it", and it is why grepping the history with -G would answer differently.
    // A path narrows it where the reader had one open.
    const find = scope.regex === true ? `-G${scope.text}` : `-S${scope.text}`;
    const within = scope.path ? ["--", scope.path] : [];
    return ["log", find, ...logOptions(), ...within];
  }

  if (!scope || !scope.path) {
    return ["log", ...logOptions()];
  }

  if (Number.isInteger(scope.start) && Number.isInteger(scope.end)) {
    // -L carries its own path and cannot be combined with --follow. -s drops the
    // patch each entry would otherwise bring: this is a list to choose from, and
    // choosing one opens its diff in the pane the same as any other.
    return ["log", "-L", `${scope.start},${scope.end}:${scope.path}`, "-s", ...logOptions()];
  }

  // --follow tracks the file across renames, which is exactly what a reader asking
  // for a file's history wants and what plain `log -- path` stops short of.
  return ["log", ...logOptions(), "--follow", "--", scope.path];
}

/**
 * What the header calls a list, given what it is a history of.
 */
function historyTitle(scope, count) {
  if (scope && scope.text) {
    const kind = scope.regex === true ? "changed matching" : "changed";
    const within = scope.path ? ` in ${scope.path}` : "";
    return `${kind}: ${scope.text}${within}  (${count})`;
  }
  if (!scope || !scope.path) {
    return `commits  (${count})`;
  }
  if (Number.isInteger(scope.start) && Number.isInteger(scope.end)) {
    const range = scope.start === scope.end ? scope.start : `${scope.start}-${scope.end}`;
    return `history: ${scope.path}:${range}  (${count})`;
  }
  return `history: ${scope.path}  (${count})`;
}

/**
 * List commits.
 * @returns {{ok: true, commits: Array<object>}|{ok: false, error: string}}
 */
function loadCommits(repoDir, scope) {
  let result;
  try {
    result = runGit(repoDir, logArgs(scope));
  } catch (error) {
    return { ok: false, error: error.message };
  }

  if (result.status !== 0) {
    // `git log` refuses outright in a repository with no commits — "your current
    // branch does not have any commits yet" — and that is a state rather than a
    // failure. A pane opened on a fresh repository should say the history is empty,
    // which is true, instead of reporting an error the reader can do nothing about.
    if (!hasCommits(repoDir)) {
      return { ok: true, commits: [] };
    }
    const detail = (result.stderr || "").trim();
    return { ok: false, error: detail || `exit code ${result.status}` };
  }

  return { ok: true, commits: parseCommits(result.stdout) };
}

/**
 * One commit, by the sha something on screen named.
 *
 * The blame column carries a short sha and nothing else, and every transition that
 * opens a commit wants the whole of one — its parents, so a merge is diffed against the
 * first of them, and its subject, so the header can say what was opened. So the sha is
 * taken back to git for the rest.
 *
 * `-1` comes after the shared options because the last `--max-count` git is given wins.
 * The sha goes after END_OF_OPTIONS and before `--`: it was parsed out of a repository
 * somebody else wrote, and a ref is read as a name here, never as an option.
 *
 * @returns {{ok: true, commit: object}|{ok: false, error: string}}
 */
function loadCommit(repoDir, sha) {
  let result;
  try {
    result = runGit(repoDir, ["log", ...logOptions(), "-1", END_OF_OPTIONS, sha, "--"]);
  } catch (error) {
    return { ok: false, error: error.message };
  }

  if (result.status !== 0) {
    const detail = (result.stderr || "").trim();
    return { ok: false, error: detail || `exit code ${result.status}` };
  }

  const commits = parseCommits(result.stdout);
  return commits.length === 0 ? { ok: false, error: "no such commit" } : { ok: true, commit: commits[0] };
}

/**
 * Commits as the rows of a list to choose from.
 *
 * They travel through the same view, movement keys and cursor as a search hit, so
 * they wear the same shape. `label` is what the location column shows instead of a
 * path and a line — a commit is not at a line of anything — and `isCommit` is what
 * tells the jump to open a diff rather than a file.
 */
function commitHits(commits) {
  return commits.map((commit) => ({
    path: null,
    line: null,
    label: `${commit.shortSha}  ${commit.date}`,
    text: `${commit.subject}   — ${commit.author}`,
    isCommit: true,
    commit,
  }));
}

/** Rows for a commit list, which says so when there are none. */
function commitRows(hits) {
  if (hits.length === 0) {
    return [{ kind: "note", text: NOTE_NO_COMMITS }];
  }
  return hits.map((hit) => ({ kind: "hit", hit }));
}

module.exports = {
  MAX_COMMITS,
  NOTE_NO_COMMITS,
  commitHits,
  commitRows,
  historyTitle,
  loadCommit,
  loadCommits,
  logArgs,
  parseCommits,
};
