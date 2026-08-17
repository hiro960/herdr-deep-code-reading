"use strict";

// Settling a merge: taking one side of a file, saying a file is done, and finishing or
// undoing the whole thing.
//
// Every one of these is git's own command. Nothing here opens a file, and nothing here
// writes one — which is the same promise the rest of the plugin makes, and it is worth
// more here than anywhere else: the reader is standing in a half-merged working tree,
// and a tool that wrote its own idea of the result into it would be the last thing that
// touched their work before they lost track of what was theirs.
//
// That is also why there is no key for taking one side of one hunk. Choosing half of a
// file is writing a file that neither side wrote, and there is only one editor allowed
// to do that here: the reader's own, which `E` hands the file to. What is offered
// instead is the choice git can make on its own — all of ours, all of theirs — and the
// mark that says a file the reader edited by hand is finished.

const gitWrite = require("./git-write");
const { OURS, sideExists } = require("./merge");

/**
 * Take one side of a conflicted file, whole.
 *
 * Which git command that is depends on what the two sides are, and the status letters
 * already say: `UD` is a file this branch modified and the other deleted, so taking
 * theirs is a deletion rather than a checkout. Asking git for a version that is not
 * there answers with an error, and the error is written in the reader's own language —
 * so the decision is made from the letters rather than from what git says about it.
 *
 * `rm -f` rather than `rm`: git refuses to remove a file whose contents differ from
 * what it has recorded, which is every conflicted file by definition.
 *
 * @param {string} code The two status letters for this path — see lib/merge
 * @param {string} side OURS or THEIRS
 */
function takeSide(repoDir, filePath, code, side) {
  if (!sideExists(code, side)) {
    // The side chosen has no version of this file: choosing it means the file goes
    return gitWrite.run(repoDir, ["rm", "-f", "--", filePath]);
  }

  const taken = gitWrite.run(repoDir, [
    "checkout",
    side === OURS ? "--ours" : "--theirs",
    "--",
    filePath,
  ]);
  if (!taken.ok) {
    return taken;
  }

  // A checkout writes the file and leaves the index still holding both sides. The add
  // is what tells git the question has been answered.
  return gitWrite.run(repoDir, ["add", "--", filePath]);
}

/**
 * Say a file is settled.
 * The one operation here that follows the reader's own editing rather than replacing
 * it: they have opened the file, chosen what it should say, and this records that.
 */
function markResolved(repoDir, paths) {
  const list = Array.isArray(paths) ? paths : [paths];
  return gitWrite.run(repoDir, ["add", "--", ...list]);
}

/**
 * Finish the merge with the message git already wrote.
 *
 * `--no-edit` takes MERGE_MSG as it stands, which names what was merged and lists what
 * conflicted. A merge commit's message is git's to write — the reader has spent their
 * attention on the files, and asking them to also compose a sentence about it is asking
 * for the sentence git had already written.
 *
 * git refuses while anything is still unmerged, and says so; that refusal is the last
 * guard on this and it is a better one than anything here could add.
 */
function commitMerge(repoDir) {
  return gitWrite.run(repoDir, ["commit", "--no-edit"]);
}

/**
 * Put the repository back where it was before the merge began.
 * Everything resolved so far goes with it, which is why the key that asks for this
 * asks twice — see lib/state/views/conflicts.
 */
function abortMerge(repoDir) {
  return gitWrite.run(repoDir, ["merge", "--abort"]);
}

module.exports = {
  abortMerge,
  commitMerge,
  markResolved,
  takeSide,
};
