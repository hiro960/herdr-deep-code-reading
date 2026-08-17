#!/usr/bin/env node
"use strict";

// The way in for anything that is not the reader.
//
// An agent in another Herdr pane has just been asked about a line, or handed a review
// to answer. This is how it answers: one command per note, no socket, no protocol, no
// library to install. The pane notices the file changed and shows what was written
// beside the line it is about.
//
// Every path is given explicitly rather than discovered. The agent's shell is not a
// plugin process and has none of HERDR_PLUGIN_STATE_DIR, so the pane that asks the
// question writes the whole invocation into the question — see lib/state/views/ask.js.
//
//   node bin/note.js --store <file> --repo <dir> --file <path> --line <n> [--from <who>] <text>
//   node bin/note.js --store <file> --repo <dir> --file <path> --line <n> [--from <who>] -
//   node bin/note.js --store <file> --repo <dir> --clear
//
// The text is the arguments, joined, so nothing has to be quoted — which is the part of
// a shell command a language model gets right least reliably. A `-` in its place reads
// the text from stdin instead, because an answer worth reading is often a paragraph and
// a command line is one line by nature.
//
// It writes one JSON file and exits. Nothing here reads the repository, and nothing
// here can change it.

const fs = require("node:fs");

const { addNote, loadNotes, saveNotes } = require("../lib/notes");

const EXIT_FAILURE = 1;
const FLAGS = new Set(["--store", "--repo", "--file", "--line", "--from"]);
// Where a longer answer comes from, spelled the way every other command spells it
const STDIN = "-";
const STDIN_FD = 0;

function fail(message) {
  process.stderr.write(`herdr-deep-code-reading note: ${message}\n`);
  process.exit(EXIT_FAILURE);
}

/**
 * Split the arguments into named values and whatever is left.
 * The text is everything that was not claimed by a flag, joined — so a note can be
 * written without quoting, which is what a shell command written by a language model
 * gets right most reliably.
 */
function parseArgs(argv) {
  const named = {};
  const rest = [];
  let at = 0;

  while (at < argv.length) {
    const arg = argv[at];

    if (arg === "--clear") {
      named.clear = true;
      at += 1;
      continue;
    }
    if (FLAGS.has(arg)) {
      named[arg.slice(2)] = argv[at + 1];
      at += 2;
      continue;
    }
    rest.push(arg);
    at += 1;
  }

  return { named, text: rest.join(" ").trim() };
}

/**
 * Everything on stdin, or nothing when there is no pipe to read.
 *
 * A terminal is checked for first: a `-` typed by hand with nothing piped in would
 * otherwise sit waiting for input that is never coming, and an agent that got the
 * command slightly wrong would hang rather than fail.
 */
function readStdin() {
  if (process.stdin.isTTY) {
    return "";
  }
  try {
    return fs.readFileSync(STDIN_FD, "utf8");
  } catch {
    return "";
  }
}

function main(argv) {
  const { named, text: given } = parseArgs(argv);
  // The arguments are the note, unless they are the one that means "it is on stdin"
  const text = given === STDIN ? readStdin().trim() : given;

  if (!named.store || !named.repo) {
    fail("--store and --repo are both needed");
    return;
  }

  if (named.clear === true) {
    const cleared = saveNotes(named.store, named.repo, []);
    if (!cleared.ok) {
      fail(cleared.error);
      return;
    }
    process.stdout.write("notes cleared\n");
    return;
  }

  const line = Number(named.line);
  if (!named.file || !Number.isInteger(line) || line < 1) {
    fail("--file and a --line of 1 or more are both needed");
    return;
  }
  if (text === "") {
    fail("there is no note to write");
    return;
  }

  const notes = addNote(loadNotes(named.store, named.repo), {
    path: named.file,
    line,
    text,
    from: named.from || "agent",
  });

  const written = saveNotes(named.store, named.repo, notes);
  if (!written.ok) {
    fail(written.error);
    return;
  }

  process.stdout.write(`noted ${named.file}:${line}\n`);
}

if (require.main === module) {
  main(process.argv.slice(2));
}

module.exports = {  };
