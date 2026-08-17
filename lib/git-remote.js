"use strict";

// The two operations that speak to a remote: asking what it has, and taking it.
//
// They are apart from ./git-write because everything about running them is different.
// A stage is a few milliseconds against the index; a fetch is a network, a credential
// helper, and an ssh that would very much like to ask for a passphrase. Three things
// follow from that, and all three are here:
//
//   The clock is longer. Thirty seconds is generous for a commit hook and short for a
//   repository being cloned down a hotel connection.
//
//   Nothing may stop to ask. The pane is in raw mode on an alternate screen, so a
//   process that reads the terminal would be typing into a screen the reader cannot
//   see, with no key able to recover. GIT_TERMINAL_PROMPT=0 turns git's own prompt
//   into a failure; a session of its own is what stops ssh from opening /dev/tty
//   behind git's back, which no environment variable can. An askpass helper the
//   reader has configured still works — that is a window, not this terminal.
//
//   A pull merges, and may stop. The pane can draw a conflict and settle one now — see
//   lib/state/views/conflicts — so a branch with commits at both ends is no longer a
//   reason to refuse: git merges what it can, leaves what it cannot between markers,
//   and the reader is put in front of the list of it. What is pinned is how it merges.
//   `pull.rebase=false` because a configured rebase would rewrite the reader's own
//   commits rather than merge them, and a rebase that stops is a state this pane has no
//   list for. `pull.ff=true` because `pull.ff=only` in somebody's config would refuse
//   the merge outright — the same refusal this stopped making.

const gitWrite = require("./git-write");
const { END_OF_OPTIONS } = require("./git");

// Long enough for a real fetch over a slow line, short enough that a pane wedged
// against an unreachable host comes back on its own.
const NETWORK_TIMEOUT_MS = 120_000;

const NETWORK_ENV = {
  // Fail rather than prompt. Without it, git's own username and password questions
  // would be asked of a terminal in raw mode that is drawing something else.
  GIT_TERMINAL_PROMPT: "0",
};

// A session of this process's own. ssh asks for a passphrase by opening the
// controlling terminal directly, which closed stdin does not prevent; a child with no
// controlling terminal has nothing to open, so it fails and says so instead of hanging.
const NETWORK_OPTIONS = {
  timeout: NETWORK_TIMEOUT_MS,
  env: NETWORK_ENV,
  detached: true,
};

/**
 * Ask every remote what it has, and prune what it no longer has.
 *
 * Nothing local moves: a fetch writes the copies under `refs/remotes` and leaves every
 * branch, the index and the working tree exactly where they were. It is the whole of
 * what is needed to answer "is there anything to get" — which is a question the counts
 * beside the branches cannot answer on their own, because they are read from those
 * copies (see ./upstream).
 *
 * `--prune` is what keeps the branch list honest. Without it a branch deleted at the
 * other end months ago is still listed here, and a reader would go looking for work on
 * a branch that no longer exists.
 */
function fetch(repoDir) {
  return gitWrite.run(repoDir, ["fetch", "--all", "--prune"], NETWORK_OPTIONS);
}

/**
 * Bring the branch that is checked out up to what its upstream has.
 *
 * The branch is HEAD's rather than the one under the cursor: `git pull` is a fetch and
 * a merge into the current branch, and moving a branch that is not checked out is a
 * different operation with different ways to go wrong. The prompt names the branch
 * before anything happens — see lib/state/log — so which one it is is never a surprise.
 *
 * `--no-edit` takes the message git wrote for the merge rather than opening an editor
 * over a pane in raw mode. It is the same message `C` commits with when the merge stops
 * halfway, which is what keeps a merge that conflicted and one that did not from being
 * recorded in two different voices.
 *
 * A non-zero exit does not mean it failed: a merge that stopped at a conflict exits
 * non-zero too. What tells them apart is MERGE_HEAD — see lib/run/effects.
 */
function pull(repoDir) {
  return gitWrite.run(
    repoDir,
    ["-c", "pull.rebase=false", "-c", "pull.ff=true", "pull", "--no-edit"],
    NETWORK_OPTIONS
  );
}

/**
 * Send this branch's commits to the remote it follows.
 *
 * Written out in full — the remote, and the local branch beside the name it answers to
 * over there — rather than left to `git push` and whatever `push.default` is set to.
 * `matching` is still in some people's config and pushes every branch whose name the
 * remote also has, which is several branches nobody asked about from one keystroke.
 *
 * Nothing here forces. A push git refuses is a push that would drop somebody else's
 * commits, and the answer to it is to pull and look at what arrived — which is two keys
 * away — rather than to overwrite the other end from a pane built for reading. There is
 * no `--force`, no `--force-with-lease`, and no key that would add one.
 *
 * @param {{remote: string, ref: string, setUpstream: boolean}} target From ./upstream
 * @param {string} branch The local branch being sent
 */
function push(repoDir, target, branch) {
  // The flags come before END_OF_OPTIONS and the names after it: a branch called
  // `--upload-pack=...` is a name the other end can have written, and git push reads
  // that one as what to run there.
  const flags = target.setUpstream ? ["--set-upstream"] : [];
  const refspec = target.setUpstream ? branch : `${branch}:${target.ref}`;

  return gitWrite.run(
    repoDir,
    ["push", ...flags, END_OF_OPTIONS, target.remote, refspec],
    NETWORK_OPTIONS
  );
}

module.exports = {
  NETWORK_TIMEOUT_MS,
  fetch,
  pull,
  push,
};
