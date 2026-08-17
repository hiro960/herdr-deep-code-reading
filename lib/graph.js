"use strict";

// The commit graph, as git draws it.
//
// The three lists in ./history answer "what happened to this", one file or one run of
// lines at a time. This answers the question a reader asks before any of those: what
// shape is this repository in — which branches there are, where they left the trunk,
// and where they came back.
//
// git draws the graph. `git log --graph` has solved lane allocation, crossings and
// merge edges for twenty years, and a hand-rolled allocator here would be several
// hundred subtle lines to arrive at the same picture. This module reads what git drew:
// the plugin's own line, "git computes the diffs; this plugin parses, renders, and
// routes them", applies to the graph as much as to a patch.
//
// Two kinds of line come back. A line carrying the record separator is a commit, and
// the graph in front of it is that commit's row. A line without one is an edge — the
// `|\` and `|/` that carry a lane past a merge — and belongs to no commit at all,
// which is why the cursor never lands on one.

const { END_OF_OPTIONS, hasCommits, runGit } = require("./git");

// The separator that starts a commit's fields, chosen because no graph line can hold
// one: git draws edges out of `*`, `|`, `/`, `\`, `_` and spaces.
const RECORD = "\u001e";
// And the one between the fields inside a record.
const UNIT = "\u001f";

// %x1e and %x1f are how git is asked to write the two separators read back above.
// %P is what says whether a commit is a merge, which decides what its diff is against
// — see lib/git.js.
const GRAPH_FORMAT = "%x1e%H%x1f%h%x1f%P%x1f%ad%x1f%an%x1f%D%x1f%s";
const COMMIT_FIELDS = 7;

// A ceiling on how far back the graph goes. Long enough to cover any reading session,
// short enough that opening the log on a repository with fifty thousand commits is
// still instant.
const MAX_COMMITS = 500;

// What a name pointing at a commit is. The branch HEAD is on is told apart from the
// rest because it is the one the reader is standing on.
const KIND_HEAD = "head";
const KIND_LOCAL = "local";
const KIND_REMOTE = "remote";
const KIND_TAG = "tag";

const TAG_PREFIX = "tag: ";
const HEAD_ARROW = "HEAD -> ";
const HEAD_NAME = "HEAD";
// %D writes its names separated by this, and nothing else in it is spelled that way
const DECORATION_SEPARATOR = ", ";

// Columns git spends on one lane: the lane's own character and the space after it.
const LANE_WIDTH = 2;
// One column between the graph and the commit beside it, so a `*` never touches a sha
const GRAPH_MARGIN = 1;

const TRAILING_SPACE = /\s+$/;

/**
 * What one name in a commit's decoration is.
 *
 * A remote is recognised by a remote of that name existing, not by the name looking
 * like one: a local branch may be called `origin/thing`, and colouring it as a remote
 * would put it under the wrong heading in the branch list as well as the wrong colour.
 */
function refOf(entry, remotes) {
  if (entry.startsWith(TAG_PREFIX)) {
    return { name: entry.slice(TAG_PREFIX.length), kind: KIND_TAG };
  }
  if (entry.startsWith(HEAD_ARROW)) {
    return { name: entry.slice(HEAD_ARROW.length), kind: KIND_HEAD };
  }
  // A detached HEAD decorates as `HEAD` alone, with no branch behind the arrow
  if (entry === HEAD_NAME) {
    return { name: HEAD_NAME, kind: KIND_HEAD };
  }

  const isRemote = remotes.some((remote) => entry.startsWith(`${remote}/`));
  return { name: entry, kind: isRemote ? KIND_REMOTE : KIND_LOCAL };
}

/**
 * Read what `%D` wrote: every name pointing at one commit.
 *
 * git separates them with a comma and a space. A ref name may itself contain a comma —
 * git allows it — but not a comma followed by a space, so splitting on the pair is
 * exact rather than nearly right.
 *
 * @param {string} [decoration] The `%D` field; empty for a commit nothing points at
 * @param {Array<string>} [remotes] Remote names, from `git remote`
 * @returns {Array<{name: string, kind: string}>}
 */
function parseRefs(decoration, remotes) {
  if (!decoration) {
    return [];
  }

  return decoration
    .split(DECORATION_SEPARATOR)
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "")
    .map((entry) => refOf(entry, remotes || []));
}

/**
 * The shas `%P` wrote: none for a root commit, one for an ordinary one, several for a
 * merge. What a commit's diff is against depends on which of the three it is.
 * @returns {Array<string>}
 */
function parseParents(field) {
  if (!field) {
    return [];
  }
  return field.split(" ").filter((sha) => sha !== "");
}

/**
 * One commit's fields, or null when the record is not one git wrote.
 * A record with the wrong number of fields is skipped rather than guessed at.
 */
function parseCommitRecord(record, remotes) {
  const fields = record.split(UNIT);
  if (fields.length < COMMIT_FIELDS) {
    return null;
  }

  const [sha, shortSha, parents, date, author, decoration, ...subject] = fields;
  return {
    sha,
    shortSha,
    parents: parseParents(parents),
    date,
    author,
    refs: parseRefs(decoration, remotes),
    // A subject holding the separator split into more fields than there are; joining
    // them back is truer than dropping the commit
    subject: subject.join(UNIT),
  };
}

/**
 * Read `git log --graph` output written in GRAPH_FORMAT.
 *
 * Trailing spaces go: git pads every graph line to the width of the widest lane it is
 * currently drawing, and the renderer pads to its own column instead.
 *
 * @returns {Array<{graph: string, commit: object|null}>} commit is null on an edge row
 */
function parseGraphLog(stdout, remotes) {
  if (!stdout) {
    return [];
  }

  const rows = [];

  for (const line of stdout.split("\n")) {
    const at = line.indexOf(RECORD);

    if (at === -1) {
      const graph = line.replace(TRAILING_SPACE, "");
      // The blank line that ends the output is not an edge
      if (graph !== "") {
        rows.push({ graph, commit: null });
      }
      continue;
    }

    const commit = parseCommitRecord(line.slice(at + RECORD.length), remotes);
    if (commit === null) {
      continue;
    }
    rows.push({ graph: line.slice(0, at).replace(TRAILING_SPACE, ""), commit });
  }

  return rows;
}

/**
 * Columns the graph column takes: as wide as its widest row, plus a margin.
 * Every row is drawn into the same width, which is what keeps a lane a straight line
 * down the screen rather than a staircase.
 */
function graphWidth(rows) {
  let widest = 0;
  for (const row of rows) {
    if (row.graph.length > widest) {
      widest = row.graph.length;
    }
  }
  return widest + GRAPH_MARGIN;
}

/**
 * Which lane a character of the graph belongs to.
 * git draws a lane as one character and a space, so the pair is the unit — and the
 * lane number is what picks the colour, so a branch keeps one colour all the way down.
 */
function laneOfColumn(index) {
  return Math.floor(index / LANE_WIDTH);
}

/**
 * The git arguments for a graph log.
 *
 * `--graph` implies `--topo-order`, which is the order a graph has to be drawn in and
 * the one SourceTree calls parent-child: a commit is never drawn above its own parent.
 *
 * @param {{ref?: string, firstParent?: boolean, author?: string}} [scope] A ref to
 *   narrow to; every branch without one. `firstParent` asks for the trunk: what landed
 *   on this branch, in the order it landed, a merge to a row. `author` asks for one
 *   person's commits.
 */
function graphLogArgs(scope) {
  const base = [
    "log",
    "--graph",
    `--max-count=${MAX_COMMITS}`,
    "--date=short",
    `--format=${GRAPH_FORMAT}`,
  ];
  // A merge is a branch somebody else finished. Following only its first parent lists
  // the merge and not the eight commits that arrived through it, which is the shape a
  // reader working through what has landed is reading.
  const trunk = scope && scope.firstParent === true ? ["--first-parent"] : [];
  // Whose work to read. git matches the pattern against the author's name and address
  // both, and matches loosely — a surname finds them, and so does half of one.
  const by = scope && scope.author ? [`--author=${scope.author}`] : [];
  const scoped = [...base, ...trunk, ...by];

  if (!scope || !scope.ref) {
    return [...scoped, "--all"];
  }

  // The trailing `--` is what keeps a branch named like a file from being read as one,
  // and `--end-of-options` is what keeps it from being read as an option. A name here
  // is the repository's, not the reader's: `git tag` refuses to make one that begins
  // with a dash, but nothing stops the other end writing `refs/tags/--output=<path>`
  // by hand, and a clone brings the tag along verbatim. `git log` reads `--output` as
  // where to write, so narrowing to that row would overwrite a file of the reader's
  // with a log of the repository they were only reading.
  return [...scoped, END_OF_OPTIONS, scope.ref, "--"];
}

/** The remotes this repository has, for telling a remote-tracking branch from a local one. */
function remoteNames(repoDir) {
  const result = runGit(repoDir, ["remote"]);
  if (result.status !== 0) {
    return [];
  }
  return result.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
}

/**
 * Read the graph.
 * @returns {{ok: true, rows: Array<object>}|{ok: false, error: string}}
 */
function loadGraph(repoDir, scope) {
  let result;
  try {
    result = runGit(repoDir, graphLogArgs(scope));
  } catch (error) {
    return { ok: false, error: error.message };
  }

  if (result.status !== 0) {
    // A repository with no commits has no graph, which is a state rather than a
    // failure — the same distinction ./history draws for the same reason.
    if (!hasCommits(repoDir)) {
      return { ok: true, rows: [] };
    }
    const detail = (result.stderr || "").trim();
    return { ok: false, error: detail || `exit code ${result.status}` };
  }

  return { ok: true, rows: parseGraphLog(result.stdout, remoteNames(repoDir)) };
}

module.exports = {
  KIND_HEAD,
  KIND_LOCAL,
  KIND_REMOTE,
  KIND_TAG,
  graphLogArgs,
  graphWidth,
  laneOfColumn,
  loadGraph,
  remoteNames,
  parseGraphLog,
  parseParents,
  parseRefs,
};
