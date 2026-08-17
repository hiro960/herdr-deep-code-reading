"use strict";

// A ref is a name the repository chose, and a repository is not always a friendly one.
//
// `git tag` refuses to make a name that begins with a dash, but nothing stops the other
// end writing `refs/tags/--output=<path>` by hand, and a clone brings the tag along
// verbatim — it lands in the tag list beside every other name to go to. Passed to
// `git log` as a bare argument it is not a name at all: `--output` says where git should
// write, so narrowing the graph to that row would overwrite a file of the reader's with
// a log of the repository they had only opened to read.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const { graphLogArgs, loadGraph } = require("../lib/graph");
const { branchAt, branchRows, loadBranches } = require("../lib/refs");

const GIT_IDENTITY = ["-c", "user.email=test@example.com", "-c", "user.name=herdr-deep-code-reading test"];

function run(cwd, args) {
  execFileSync("git", args, { cwd, stdio: "ignore" });
}

/**
 * A repository carrying a tag whose name reads as an option, and the path it names.
 * Written with `update-ref` because that is how the other end would have written it:
 * `git tag` will not make this name, and `git clone` does not check the ones it fetches.
 */
function makeRepo(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "herdr-deep-code-reading-hostile-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  run(root, ["init", "-q", "."]);
  fs.writeFileSync(path.join(root, "a.txt"), "one\n");
  run(root, ["add", "a.txt"]);
  run(root, [...GIT_IDENTITY, "commit", "-q", "-m", "first"]);

  const target = path.join(root, "written-by-git.txt");
  run(root, ["update-ref", `refs/tags/--output=${target}`, "HEAD"]);

  return { root, target };
}

test("a ref is put past the options, so that its name cannot be one", () => {
  const args = graphLogArgs({ ref: "--output=/tmp/anywhere" });

  // The `--` keeps it from being read as a path; `--end-of-options` keeps it from
  // being read as an option. Both sit around the name, which is what it is.
  assert.deepStrictEqual(args.slice(-3), ["--end-of-options", "--output=/tmp/anywhere", "--"]);
});

test("a tag named like an option is still a row a reader can land on", (t) => {
  const { root, target } = makeRepo(t);

  const rows = branchRows(loadBranches(root).branches);
  const index = rows.findIndex((row) => row.kind === "branch" && row.branch.kind === "tag");
  const tag = branchAt(rows, index);

  assert.strictEqual(tag.name, `--output=${target}`);
});

test("narrowing the graph to it reads the tag rather than writing the file", (t) => {
  const { root, target } = makeRepo(t);
  const rows = branchRows(loadBranches(root).branches);
  const index = rows.findIndex((row) => row.kind === "branch" && row.branch.kind === "tag");

  const graph = loadGraph(root, { ref: branchAt(rows, index).name });

  assert.strictEqual(graph.ok, true);
  // The tag points at the one commit there is, so the graph has it
  assert.strictEqual(graph.rows.filter((row) => row.commit !== null).length, 1);
  assert.strictEqual(fs.existsSync(target), false);
});
