"use strict";

// How far a branch has drifted from the branch it follows.
//
// ./refs reads what branches a repository has; this reads the one thing about a branch
// that cannot be seen by looking at it. Ahead is what was written here and has not gone
// out. Behind is what has arrived and has not been read.
//
// Behind is answered from the remote-tracking ref, which is a copy: it says what the
// other end had the last time this repository asked, and nothing at all about what it
// has now. That is why the answer is dated. A count without its age reads as news when
// it is a memory, so the age of the last fetch is read beside it and shown beside it —
// see fetchAge, and `F` in the log, which is how the question is asked again.
//
// One `for-each-ref` answers for every branch at once, which is the same shape ./refs
// and ./graph are in: one process, and the parsing here.

const fs = require("node:fs");
const path = require("node:path");

const { runGit } = require("./git");

const UNIT = "\u001f";
const TRACK_FIELDS = 3;

// %(upstream:track) is the field that counts, and it is the field git writes in the
// reader's own language — `[ahead 1]` becomes something else entirely under a
// translated git. LOCALE_C below is what keeps the words the ones read for here.
const TRACK_FORMAT = `%(refname:short)${UNIT}%(upstream:short)${UNIT}%(upstream:track)`;

// Local branches only. A remote-tracking ref follows nothing itself, and a tag is not
// a place work arrives at.
const HEADS_PREFIX = "refs/heads/";

// git writes `[ahead 1, behind 2]`, `[gone]`, or nothing at all — translated, when it
// has been asked in a language it has. This is the one call that reads git's prose
// rather than its data, so it is the one call that pins the language down.
const LOCALE_C = { LC_ALL: "C", LANG: "C" };

// Read out of that field rather than matched against the whole of it: the brackets are
// git's and a later git may drop them, and the two counts appear together, apart, or
// not at all.
const AHEAD = /ahead (\d+)/;
const BEHIND = /behind (\d+)/;
const GONE = /gone/;

// What the branch list puts beside a name. Arrows, because two numbers beside a branch
// have to say which way each of them goes and there is no room for the words.
const AHEAD_MARK = "↑";
const BEHIND_MARK = "↓";
// An upstream that has been deleted at the other end. The word rather than a mark: it
// is rare enough that a reader meeting it should not have to work out what it means.
const GONE_LABEL = "gone";

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
// Under a minute, a number of seconds is noise: the fetch is what just happened.
const JUST_NOW_MS = MINUTE_MS;

/**
 * Read one `%(upstream:track)` field.
 * @returns {{ahead: number, behind: number, gone: boolean}}
 */
function parseTrack(field) {
  if (!field) {
    return { ahead: 0, behind: 0, gone: false };
  }

  const ahead = AHEAD.exec(field);
  const behind = BEHIND.exec(field);

  return {
    ahead: ahead === null ? 0 : Number(ahead[1]),
    behind: behind === null ? 0 : Number(behind[1]),
    // The upstream this branch names is not there any more — someone deleted the
    // branch at the other end and a fetch pruned the copy of it
    gone: GONE.test(field),
  };
}

/**
 * Read `git for-each-ref` output written in TRACK_FORMAT.
 * A line with the wrong number of fields is skipped rather than guessed at, the way
 * ./refs and ./graph skip theirs.
 * @returns {Array<{name: string, upstream: string, ahead: number, behind: number, gone: boolean}>}
 */
function parseTrackingLines(stdout) {
  if (!stdout) {
    return [];
  }

  const tracking = [];

  for (const record of stdout.split("\n")) {
    if (record === "") {
      continue;
    }

    const fields = record.split(UNIT);
    if (fields.length < TRACK_FIELDS) {
      continue;
    }

    const [name, upstream, track] = fields;
    // A branch following nothing is not listed: there is no drift to report, and the
    // list is looked up by name
    if (upstream === "") {
      continue;
    }

    tracking.push({ name, upstream, ...parseTrack(track) });
  }

  return tracking;
}

/**
 * What every local branch follows, and how far it has drifted from it.
 *
 * A failure here is an empty list rather than an error: the branch list is worth
 * drawing without the counts, and a repository with no remote at all is the ordinary
 * case rather than a broken one.
 *
 * @returns {Array<object>} One entry per branch that follows something
 */
function loadTracking(repoDir) {
  let result;
  try {
    result = runGit(repoDir, ["for-each-ref", `--format=${TRACK_FORMAT}`, HEADS_PREFIX], {
      env: LOCALE_C,
    });
  } catch {
    return [];
  }

  return result.status === 0 ? parseTrackingLines(result.stdout) : [];
}

/**
 * What goes beside a branch's name in the list: `↑2↓3`, `↓3`, `gone`, or nothing.
 * Nothing when a branch is level with what it follows, because a list where every row
 * carries a mark is a list where no mark is worth looking at.
 */
function trackingLabel(track) {
  if (track === null || track === undefined) {
    return "";
  }
  if (track.gone) {
    return GONE_LABEL;
  }

  const ahead = track.ahead > 0 ? `${AHEAD_MARK}${track.ahead}` : "";
  const behind = track.behind > 0 ? `${BEHIND_MARK}${track.behind}` : "";

  return `${ahead}${behind}`;
}

/**
 * The same thing as a sentence, for the footer to say after a fetch or a pull.
 * @param {object|null} branch A branch from ./refs, with its tracking attached
 */
function describeTracking(branch) {
  if (branch === null || branch === undefined) {
    return "not on a branch";
  }

  const track = branch.track;
  if (track === null || track === undefined) {
    return `${branch.name} follows no branch`;
  }
  if (track.gone) {
    return `${track.upstream} is gone`;
  }
  if (track.ahead > 0 && track.behind > 0) {
    return `${branch.name} and ${track.upstream} have diverged (${track.ahead} here, ${track.behind} there)`;
  }
  if (track.behind > 0) {
    return `${branch.name} is ${track.behind} behind ${track.upstream}`;
  }
  if (track.ahead > 0) {
    return `${branch.name} is ${track.ahead} ahead of ${track.upstream}`;
  }

  return `${branch.name} is up to date with ${track.upstream}`;
}

/**
 * Split `origin/feat/x` into the remote and the branch on it.
 *
 * At the first slash that a remote actually answers to, rather than at the first slash
 * there is: a branch may be called `feat/x`, and a repository may have a remote called
 * something other than `origin`. An upstream that is a local branch — which git allows —
 * belongs to no remote and answers null.
 *
 * @param {Array<string>} remotes Remote names, from `git remote`
 * @returns {{remote: string, ref: string}|null}
 */
function splitUpstream(upstream, remotes) {
  for (const remote of remotes) {
    const prefix = `${remote}/`;
    if (upstream.startsWith(prefix)) {
      return { remote, ref: upstream.slice(prefix.length) };
    }
  }
  return null;
}

/**
 * Where a branch's commits would go, and whether sending them makes the link.
 *
 * A branch that follows something goes back to exactly that, under the name it has
 * there — the two can differ, and pushing to the wrong one of them would put a branch
 * on the remote nobody asked for.
 *
 * A branch that follows nothing is being sent out for the first time, and so is one
 * whose upstream has been deleted at the other end. Both want the link made as they go,
 * or the next push would ask this same question again. Where they go is `origin` when
 * there is one, and the only remote when there is exactly one; a repository with
 * several and no `origin` is not one this can guess about.
 *
 * @param {object} branch A branch from ./refs, with its tracking attached
 * @param {Array<string>} remotes Remote names, from `git remote`
 * @returns {{remote: string, ref: string, setUpstream: boolean}|null}
 */
function pushTarget(branch, remotes) {
  const track = branch === null || branch === undefined ? null : branch.track;

  if (track !== null && track !== undefined && !track.gone) {
    const found = splitUpstream(track.upstream, remotes);
    return found === null ? null : { ...found, setUpstream: false };
  }

  if (remotes.includes("origin")) {
    return { remote: "origin", ref: branch.name, setUpstream: true };
  }
  if (remotes.length === 1) {
    return { remote: remotes[0], ref: branch.name, setUpstream: true };
  }

  return null;
}

/**
 * When this repository last asked a remote what it had.
 *
 * FETCH_HEAD is written by every fetch, whether or not anything came back, so its
 * mtime is the time of the question rather than of the answer — which is the one worth
 * dating: what matters is how long ago the counts stopped being checked.
 *
 * Asked of git rather than assembled from `repoDir/.git`: a linked worktree and a
 * submodule both keep `.git` as a file pointing elsewhere, and the fetch of a worktree
 * lands in the repository it belongs to.
 *
 * @returns {number|null} Milliseconds since the epoch, or null when nothing has fetched
 */
function lastFetch(repoDir) {
  let result;
  try {
    result = runGit(repoDir, ["rev-parse", "--git-path", "FETCH_HEAD"]);
  } catch {
    return null;
  }

  if (result.status !== 0) {
    return null;
  }

  const relative = result.stdout.trim();
  if (relative === "") {
    return null;
  }

  try {
    // git answers relative to the directory it was run in, which is the repository
    return fs.statSync(path.resolve(repoDir, relative)).mtimeMs;
  } catch {
    // No file: nothing has ever fetched here. A clone does not write one.
    return null;
  }
}

/**
 * How old the counts are, in the words a reader would use.
 *
 * Kept coarse on purpose. The question behind it is "can I trust the arrows", and
 * minutes answer that as well as seconds would while changing far less often.
 *
 * @param {number|null} at When the last fetch was, from lastFetch
 * @param {number} now The clock, passed in so that this stays worth testing
 * @returns {string}
 */
function fetchAge(at, now) {
  if (at === null || at === undefined) {
    return "never fetched";
  }

  const since = Math.max(0, now - at);

  if (since < JUST_NOW_MS) {
    return "fetched just now";
  }
  if (since < HOUR_MS) {
    return `fetched ${Math.floor(since / MINUTE_MS)}m ago`;
  }
  if (since < DAY_MS) {
    return `fetched ${Math.floor(since / HOUR_MS)}h ago`;
  }

  return `fetched ${Math.floor(since / DAY_MS)}d ago`;
}

module.exports = {
  AHEAD_MARK,
  BEHIND_MARK,
  GONE_LABEL,
  describeTracking,
  fetchAge,
  lastFetch,
  loadTracking,
  parseTrack,
  parseTrackingLines,
  pushTarget,
  splitUpstream,
  trackingLabel,
};
