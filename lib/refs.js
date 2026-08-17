"use strict";

// Which branches a repository has, as the list down the left of the log.
//
// ./graph reads the names git hangs off each commit; this reads the names themselves,
// so that a reader can go to a branch rather than only recognise one when the graph
// scrolls past it. `git for-each-ref` answers in one process, sorted, and without the
// porcelain guessing that parsing `git branch` output would need.
//
// Three groups in one list, because that is how a reader holds them: the branches here,
// the branches on the remote, and the tags. The kinds themselves are ./graph's — a
// branch is the same thing whether it is read off a commit or off the ref list.

const { KIND_HEAD, KIND_LOCAL, KIND_REMOTE, KIND_TAG } = require("./graph");
const { runGit } = require("./git");
const { loadTracking } = require("./upstream");

const UNIT = "\u001f";
const REF_FIELDS = 3;

// %(HEAD) is `*` on the branch HEAD is on and a space on every other
const HEAD_MARK = "*";
const REF_FORMAT = `%(refname:short)${UNIT}%(refname)${UNIT}%(HEAD)`;

const HEADS_PREFIX = "refs/heads/";
const REMOTES_PREFIX = "refs/remotes/";
const TAGS_PREFIX = "refs/tags/";

// `refs/remotes/<remote>/HEAD` is a symbolic ref pointing at the remote's default
// branch, not a branch of its own. Listing it puts the same commit on screen twice
// under two names, one of which cannot be checked out.
const REMOTE_HEAD_SUFFIX = "/HEAD";

const HEADING_BRANCHES = "branches";
const HEADING_REMOTES = "remotes";
const HEADING_TAGS = "tags";

const NOTE_NO_BRANCHES = "No branches yet";

// The order the groups are drawn in, and what each is called
const GROUPS = [
  { heading: HEADING_BRANCHES, kinds: [KIND_HEAD, KIND_LOCAL] },
  { heading: HEADING_REMOTES, kinds: [KIND_REMOTE] },
  { heading: HEADING_TAGS, kinds: [KIND_TAG] },
];

/**
 * Which kind of ref a full ref name is, or null when it is neither branch nor tag.
 * `refs/stash` and `refs/notes/*` live in the same namespace and are not places a
 * reader navigates to.
 */
function kindOfRef(ref, isHead) {
  if (ref.startsWith(HEADS_PREFIX)) {
    return isHead ? KIND_HEAD : KIND_LOCAL;
  }
  if (ref.startsWith(REMOTES_PREFIX)) {
    return ref.endsWith(REMOTE_HEAD_SUFFIX) ? null : KIND_REMOTE;
  }
  return ref.startsWith(TAGS_PREFIX) ? KIND_TAG : null;
}

/**
 * Read `git for-each-ref` output written in REF_FORMAT.
 * A line with the wrong number of fields is skipped rather than guessed at.
 * @returns {Array<{name: string, ref: string, kind: string}>}
 */
function parseRefLines(stdout) {
  if (!stdout) {
    return [];
  }

  const branches = [];

  for (const record of stdout.split("\n")) {
    if (record === "") {
      continue;
    }

    const fields = record.split(UNIT);
    if (fields.length < REF_FIELDS) {
      continue;
    }

    const [name, ref, headMark] = fields;
    const kind = kindOfRef(ref, headMark === HEAD_MARK);
    if (kind === null) {
      continue;
    }

    branches.push({ name, ref, kind });
  }

  return branches;
}

/**
 * Branches as the rows of the list they are drawn in.
 *
 * A heading is drawn only for a group that has something under it: an empty
 * "remotes" heading tells the reader nothing they could not see, and costs a row on
 * a column that is already the narrowest on screen.
 *
 * @returns {Array<object>} `heading` rows the cursor skips, `branch` rows it lands on
 */
function branchRows(branches) {
  if (branches.length === 0) {
    return [{ kind: "note", text: NOTE_NO_BRANCHES }];
  }

  const rows = [];

  for (const group of GROUPS) {
    const members = branches.filter((branch) => group.kinds.includes(branch.kind));
    if (members.length === 0) {
      continue;
    }
    rows.push({ kind: "heading", text: group.heading });
    for (const branch of members) {
      rows.push({ kind: "branch", branch });
    }
  }

  return rows;
}

/** The branch a row index points at, or null when it points at a heading or past the end. */
function branchAt(rows, index) {
  const row = rows[index];
  if (row === undefined || row.kind !== "branch") {
    return null;
  }
  return row.branch;
}

/**
 * The row a named ref sits on, so the list opens on the branch already being read.
 * Nothing named lands on the first branch there is, past the heading above it.
 */
function refIndexOf(rows, name) {
  if (name === null || name === undefined) {
    return rows.findIndex((row) => row.kind === "branch");
  }
  return rows.findIndex((row) => row.kind === "branch" && row.branch.name === name);
}

/**
 * Attach what each local branch follows, and how far it has drifted from it.
 *
 * Only a local branch has an upstream: a remote-tracking ref is the copy that is being
 * measured against, and a tag does not move. Everything else carries `track: null`, so
 * that a row can be asked the question whatever kind of ref it holds.
 */
function withTracking(branches, tracking) {
  const byName = new Map(tracking.map((entry) => [entry.name, entry]));

  return branches.map((branch) => {
    if (branch.kind !== KIND_HEAD && branch.kind !== KIND_LOCAL) {
      return { ...branch, track: null };
    }

    const found = byName.get(branch.name);
    if (found === undefined) {
      return { ...branch, track: null };
    }

    const { upstream, ahead, behind, gone } = found;
    return { ...branch, track: { upstream, ahead, behind, gone } };
  });
}

/**
 * Whether this repository has anything a fetch would answer for.
 *
 * A repository with no remote at all is nobody's copy of anything: it has never
 * fetched and never will, and a header saying `never fetched` at it would name a
 * missing thing that is not missing. Asked of the refs rather than of `git remote`
 * because the list is already in hand — a remote-tracking ref, or a branch that
 * follows one, is what makes the question worth asking.
 */
function hasRemoteRefs(branches) {
  return (branches || []).some(
    (branch) =>
      branch.kind === KIND_REMOTE || (branch.track !== null && branch.track !== undefined)
  );
}

/**
 * The branch HEAD is on, out of a list of them.
 * Null on a detached HEAD, which is the state where there is no branch to pull into —
 * see lib/state/log.
 */
function headBranchOf(branches) {
  const found = (branches || []).find((branch) => branch.kind === KIND_HEAD);
  return found === undefined ? null : found;
}

/**
 * Read the repository's branches and tags.
 *
 * Sorted by git rather than here: `refname` puts them in the order they are written,
 * which is the order a reader scanning for one expects.
 *
 * A second process reads what each local branch follows — see ./upstream. It is read
 * here rather than where the list is drawn because both callers of this want it, and
 * because a branch and its distance from the other end are one fact about one branch.
 *
 * @returns {{ok: true, branches: Array<object>}|{ok: false, error: string}}
 */
function loadBranches(repoDir) {
  let result;
  try {
    result = runGit(repoDir, [
      "for-each-ref",
      `--format=${REF_FORMAT}`,
      "--sort=refname",
      HEADS_PREFIX,
      REMOTES_PREFIX,
      TAGS_PREFIX,
    ]);
  } catch (error) {
    return { ok: false, error: error.message };
  }

  if (result.status !== 0) {
    const detail = (result.stderr || "").trim();
    return { ok: false, error: detail || `exit code ${result.status}` };
  }

  return { ok: true, branches: withTracking(parseRefLines(result.stdout), loadTracking(repoDir)) };
}

module.exports = {
  HEADING_BRANCHES,
  HEADING_REMOTES,
  HEADING_TAGS,
  branchAt,
  branchRows,
  hasRemoteRefs,
  headBranchOf,
  loadBranches,
  parseRefLines,
  refIndexOf,
  withTracking,
};
