"use strict";

// A thin wrapper around git: fetching diffs and resolving what to review.
// Parsing belongs to diff-parser, rendering to render.

const { spawnSync } = require("node:child_process");

const { parseUnifiedDiff } = require("./diff-parser");
const { diffFlags } = require("./diff-options");
const { isUntracked, parseStatus, statusLabel } = require("./status");
const { untrackedFileDiff } = require("./untracked");

const MAX_BUFFER_BYTES = 64 * 1024 * 1024;
const DEFAULT_BRANCH_FALLBACKS = ["main", "master"];
const NUL = "\u0000"; // ASCII NUL, the -z record separator
// The mode that shows one commit rather than a range of the working tree
const COMMIT_MODE = "commit";

// core.quotePath is on by default, which makes `git diff` print a non-ASCII path as
// an escaped C string — `"a/\346\227\245..."` rather than `a/日本語.txt`. The -z
// readers (`status`, `ls-files`, `grep`) never quote, so leaving it on would have the
// diff key its files by a name nothing else in the repository answers to. Turning it
// off here covers every subcommand at once.
const NO_QUOTE_PATH = ["-c", "core.quotePath=false"];

// What separates the options from the names of things. A ref is the repository's name
// for something rather than the reader's, and a repository can carry one that reads as
// an option: `refs/tags/--output=<path>` cannot be made with `git tag`, but it can be
// written by hand at the other end and a clone brings it along verbatim. Passed bare,
// `git log` and `git diff` would read `--output` as where to write and overwrite a file
// of the reader's. After this, everything is a name. (git 2.24 and later.)
const END_OF_OPTIONS = "--end-of-options";

/**
 * Run git synchronously. Throws only when the process itself fails to start.
 *
 * @param {{env?: object}} [options] Variables to add to git's environment. Added to
 *   this process's own rather than replacing it: git needs PATH to find its
 *   subcommands and HOME to find its configuration, and a call handed a bare pair
 *   would be a git that cannot read the repository's own settings. One caller wants
 *   this — the one that reads a sentence git wrote rather than a field, and has to
 *   pin the language it is written in (see ./upstream).
 */
function runGit(repoDir, args, options) {
  const added = options === undefined || options === null ? null : options.env;
  const result = spawnSync("git", [...NO_QUOTE_PATH, ...args], {
    cwd: repoDir,
    encoding: "utf8",
    maxBuffer: MAX_BUFFER_BYTES,
    ...(added === null || added === undefined ? {} : { env: { ...process.env, ...added } }),
  });

  if (result.error) {
    throw new Error(`could not start git: ${result.error.message}`);
  }

  return {
    stdout: result.stdout || "",
    stderr: result.stderr || "",
    status: result.status === null ? 1 : result.status,
  };
}

function runGitOrThrow(repoDir, args) {
  const result = runGit(repoDir, args);
  if (result.status !== 0) {
    const detail = result.stderr.trim() || `exit code ${result.status}`;
    throw new Error(`git ${args.join(" ")} failed: ${detail}`);
  }
  return result.stdout;
}

/** Return the repository root containing the given directory, or null. */
function resolveRepoRoot(dir) {
  const result = runGit(dir, ["rev-parse", "--show-toplevel"]);
  if (result.status !== 0) {
    return null;
  }
  return result.stdout.trim() || null;
}

/** Whether HEAD exists (false in a repository with no commits). */
function hasCommits(repoDir) {
  return runGit(repoDir, ["rev-parse", "--verify", "--quiet", "HEAD"]).status === 0;
}

/** Whether a name resolves to a commit in this repository. */
function refExists(repoDir, ref) {
  const args = ["rev-parse", "--verify", "--quiet", END_OF_OPTIONS, ref];
  return runGit(repoDir, args).status === 0;
}

/**
 * Resolve the default branch: origin/HEAD, then main, then master.
 *
 * `origin/HEAD` names a remote-tracking branch. The local branch of the same name is
 * the better base when it exists — it is what the reviewer is working from — but a
 * single-branch clone or a detached CI checkout may not have one, and diffing against
 * a ref that does not exist fails outright. So the stripped name is only used once it
 * is known to resolve.
 *
 * @returns {string|null} null when nothing resolves
 */
function resolveDefaultBranch(repoDir) {
  const head = runGit(repoDir, [
    "symbolic-ref",
    "--quiet",
    "--short",
    "refs/remotes/origin/HEAD",
  ]);
  if (head.status === 0) {
    const remoteRef = head.stdout.trim();
    if (remoteRef) {
      const local = remoteRef.replace(/^origin\//, "");
      return local !== remoteRef && refExists(repoDir, local) ? local : remoteRef;
    }
  }

  for (const candidate of DEFAULT_BRANCH_FALLBACKS) {
    if (refExists(repoDir, candidate)) {
      return candidate;
    }
  }

  return null;
}

function currentBranch(repoDir) {
  const result = runGit(repoDir, ["rev-parse", "--abbrev-ref", "HEAD"]);
  return result.status === 0 ? result.stdout.trim() : "HEAD";
}

/**
 * How one commit is diffed.
 *
 * diff-tree rather than `show`: `show` prints a commit header the diff parser has no
 * shape for, and --no-commit-id drops the one line diff-tree would otherwise put above
 * the patch.
 *
 * A merge is the case worth spelling out. Asked for a merge on its own, git prints
 * nothing at all — the commit agrees with one parent or the other about every line, so
 * there is no single diff to show — and a reader who opened it would be told the merge
 * changed nothing. It is diffed against its first parent instead, which is what the
 * branch the merge was made on saw arrive: everything the other side brought with it.
 *
 * A root commit has no parent to be compared against, and --root is what gives it a
 * diff at all.
 */
function commitDiffArgs(commit) {
  const parents = commit.parents || [];

  if (parents.length > 1) {
    return ["diff-tree", "-p", "--no-commit-id", parents[0], commit.sha];
  }
  return ["diff-tree", "-p", "--root", "--no-commit-id", commit.sha];
}

/**
 * Build the git diff arguments and the screen title for a mode.
 *
 * @param {object} [commit] For the `commit` mode: the commit being shown
 */
function buildDiffCommand(repoDir, mode, commit) {
  if (mode === COMMIT_MODE) {
    if (!commit || !commit.sha) {
      throw new Error("no commit to show");
    }
    return { args: commitDiffArgs(commit), title: `${commit.shortSha} ${commit.subject}` };
  }

  if (mode === "staged") {
    return { args: ["diff", "--cached"], title: "Staged changes" };
  }

  if (mode === "branch") {
    const base = resolveDefaultBranch(repoDir);
    if (base === null) {
      throw new Error(
        "could not resolve a default branch (none of origin/HEAD, main, or master were found)"
      );
    }
    return {
      // The base is a name out of the repository too — origin/HEAD points wherever the
      // other end says — so it is put past the options the same way a ref is
      args: ["diff", END_OF_OPTIONS, `${base}...HEAD`],
      title: `${base}...${currentBranch(repoDir)}`,
    };
  }

  if (mode === "review") {
    if (!hasCommits(repoDir)) {
      return { args: ["diff", "--cached"], title: "Staged changes (no commits yet)" };
    }
    return { args: ["diff", "HEAD"], title: "Working tree vs HEAD" };
  }

  throw new Error(`unknown mode: ${mode}`);
}

/**
 * Insert the shared diff options after the subcommand.
 *
 * The first three never change: colour is this plugin's job, an external differ would
 * answer in a shape the parser has no reading for, and renames are always worth
 * detecting. What follows them is what the reader has asked for — see lib/diff-options.
 */
function withDiffOptions(args, options) {
  const [subcommand, ...rest] = args;
  return [
    subcommand,
    "--no-color",
    "--no-ext-diff",
    "--find-renames",
    ...diffFlags(options),
    ...rest,
  ];
}

/**
 * Working-tree status, one entry per changed or untracked path.
 *
 * `--untracked-files=all` matters: by default git collapses an untracked directory
 * into a single `dir/` entry, which hides every file inside it and cannot be diffed.
 */
function loadStatus(repoDir) {
  const result = runGit(repoDir, [
    "status",
    "--porcelain=v1",
    "-z",
    "--untracked-files=all",
  ]);
  if (result.status !== 0) {
    return [];
  }
  return parseStatus(result.stdout);
}

/**
 * Every file the browser may show, repository-relative.
 * `ls-files` covers tracked and untracked files and already leaves out `.git` and
 * everything `.gitignore` names, so no filesystem walk or filtering is needed.
 */
function listRepoPaths(repoDir) {
  const result = runGit(repoDir, [
    "ls-files",
    "--cached",
    "--others",
    "--exclude-standard",
    "-z",
  ]);
  if (result.status !== 0) {
    return [];
  }
  return result.stdout.split(NUL).filter((entry) => entry.length > 0);
}

/** Whether git tracks a path. */
function isTracked(repoDir, filePath) {
  const result = runGit(repoDir, ["ls-files", "--error-unmatch", "--", filePath]);
  return result.status === 0;
}

/**
 * The diff of one file, for reading it beside its own history.
 * An untracked file has no diff for git to report, so it is built from the file
 * itself — see ./untracked.
 * @returns {object|null} A parsed file, or null when it has no changes
 */
function loadFileDiff(repoDir, mode, filePath, commit) {
  const { args } = buildDiffCommand(repoDir, mode, commit);
  const stdout = runGitOrThrow(repoDir, [...withDiffOptions(args), "--", filePath]);

  const [file] = parseUnifiedDiff(stdout);
  if (file !== undefined) {
    return file;
  }

  // No diff can mean two very different things: a tracked file that simply has no
  // changes, or an untracked file git was never asked about. Only the second one is
  // read as an addition; the first would otherwise read as entirely added.
  return isTracked(repoDir, filePath) ? null : untrackedFileDiff(repoDir, filePath);
}

/** Path a diff entry is keyed by. */
function diffPath(file) {
  return file.newPath || file.oldPath || null;
}

/** Attach the two-letter git status to each diff entry. */
function attachStatus(files, entries) {
  const labels = new Map(entries.map((entry) => [entry.path, statusLabel(entry)]));
  return files.map((file) => ({ ...file, gitStatus: labels.get(diffPath(file)) || null }));
}

/**
 * Load the diff for a mode.
 *
 * The review mode also lists untracked files, which `git diff` never reports. They
 * are read rather than diffed: one process per new file is what made opening a
 * repository with a few hundred of them take seconds, and staging reloads.
 *
 * @returns {{title: string, files: Array<object>, branch: string}}
 */
/**
 * One commit's diff, without asking which branch is checked out.
 *
 * The log loads this every time the cursor steps to another commit, and the branch is
 * a fact about the working tree rather than about a commit that landed last year — so
 * asking for it here would be a second process per keypress for an answer the caller
 * throws away. `loadDiff` still reports it, for the reload that does want it.
 *
 * @param {object} commit A commit from ../graph or ../history
 * @returns {{title: string, files: Array<object>}}
 */
function loadCommitDiff(repoDir, commit, options) {
  const { args, title } = buildDiffCommand(repoDir, COMMIT_MODE, commit);
  const stdout = runGitOrThrow(repoDir, withDiffOptions(args, options));
  // A commit that landed last year has nothing to do with what `git status` says
  // about the working tree now, and labelling its files with today's letters would
  // claim a historical file is staged. So no status is attached here.
  return { title, files: parseUnifiedDiff(stdout) };
}

function loadDiff(repoDir, mode, commit, options) {
  if (mode === COMMIT_MODE) {
    return { ...loadCommitDiff(repoDir, commit, options), branch: currentBranch(repoDir) };
  }

  const { args, title } = buildDiffCommand(repoDir, mode, commit);
  const stdout = runGitOrThrow(repoDir, withDiffOptions(args, options));
  const tracked = parseUnifiedDiff(stdout);
  const branch = currentBranch(repoDir);

  const entries = loadStatus(repoDir);

  if (mode !== "review") {
    return { title, files: attachStatus(tracked, entries), branch };
  }

  const untracked = entries
    .filter(isUntracked)
    .map((entry) => untrackedFileDiff(repoDir, entry.path));

  return { title, files: attachStatus([...tracked, ...untracked], entries), branch };
}

module.exports = {
  COMMIT_MODE,
  END_OF_OPTIONS,
  loadCommitDiff,
  currentBranch,
  diffPath,
  hasCommits,
  loadDiff,
  loadFileDiff,
  listRepoPaths,
  loadStatus,
  resolveDefaultBranch,
  resolveRepoRoot,
  runGit,
  untrackedFileDiff,
};
