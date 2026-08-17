"use strict";

// Making a file from the browser.
//
// The one thing this plugin creates, so most of what is worth checking is what it
// refuses to create: a name that would land outside the repository, a name something
// already answers to, and a name that is not one.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const { createState, reduce, toScreenModel } = require("../lib/app-state");
const { performCreate, performEffect } = require("../lib/run/effects");
const { INPUT_CREATE, VIEW_BROWSE, VIEW_READ } = require("../lib/view-names");

const COLUMNS = 120;
const VIEWPORT = 20;
const GIT_IDENTITY = ["-c", "user.email=test@example.com", "-c", "user.name=herdr-deep-code-reading test"];

function run(cwd, args) {
  execFileSync("git", args, { cwd, stdio: "ignore" });
}

/** A repository with a directory in it, so there is somewhere to be standing. */
function makeRepo(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "herdr-deep-code-reading-new-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  run(root, ["init", "-q", "-b", "main"]);
  fs.mkdirSync(path.join(root, "lib"));
  fs.writeFileSync(path.join(root, "lib", "a.js"), "const a = 1;\n");
  fs.writeFileSync(path.join(root, "README.md"), "# readme\n");
  run(root, ["add", "-A"]);
  run(root, [...GIT_IDENTITY, "commit", "-qm", "base"]);

  return root;
}

/** A pane opened on the browser, with its stores kept out of the reader's own. */
function browsing(t, root) {
  const stores = fs.mkdtempSync(path.join(os.tmpdir(), "herdr-deep-code-reading-store-"));
  t.after(() => fs.rmSync(stores, { recursive: true, force: true }));

  const state = createState(root, "files", COLUMNS, {
    bookmarksFile: path.join(stores, "bookmarks.json"),
    viewedFile: path.join(stores, "viewed.json"),
    notesFile: path.join(stores, "notes.json"),
  });
  return { ...state, journalFile: path.join(stores, "journal.json") };
}

/** Press a key and carry out whatever it asked the world for, as the loop does. */
function press(state, key) {
  return performEffect(reduce(state, key, VIEWPORT), null);
}

/** Type a name into the open field. */
function type(state, text) {
  return [...text].reduce((current, char) => reduce(current, char, VIEWPORT), state);
}

/** The whole gesture: open the field, name the file, accept. */
function create(state, name) {
  return press(type(reduce(state, "a", VIEWPORT), name), "enter");
}

// --- naming it -------------------------------------------------------------------------

test("a opens a field that says what it is for", (t) => {
  // Arrange
  const state = browsing(t, makeRepo(t));

  // Act
  const asked = reduce(state, "a", VIEWPORT);

  // Assert
  assert.strictEqual(asked.input.kind, INPUT_CREATE);
  assert.strictEqual(asked.input.text, "");
  assert.match(toScreenModel(asked).help, /new empty file/);
  // The field names itself rather than borrowing the comment's label
  assert.doesNotMatch(toScreenModel(asked).help, /undefined/);
});

test("naming nothing creates nothing", (t) => {
  // Arrange
  const state = browsing(t, makeRepo(t));

  // Act
  const asked = press(reduce(state, "a", VIEWPORT), "enter");

  // Assert
  assert.strictEqual(asked.message, "Nothing created: no name");
  assert.strictEqual(asked.effect, null);
  assert.strictEqual(asked.input, null);
});

test("a name that ends in a slash is a directory, and says so", (t) => {
  // Arrange
  const state = browsing(t, makeRepo(t));

  // Act
  const asked = create(state, "docs/");

  // Assert
  assert.match(asked.message, /names a directory/);
  assert.strictEqual(asked.effect, null);
});

test("Esc leaves the field with nothing made", (t) => {
  // Arrange
  const root = makeRepo(t);
  const state = browsing(t, root);

  // Act
  const away = reduce(type(reduce(state, "a", VIEWPORT), "notes.md"), "escape", VIEWPORT);

  // Assert
  assert.strictEqual(away.input, null);
  assert.strictEqual(away.view, VIEW_BROWSE);
  assert.strictEqual(fs.existsSync(path.join(root, "notes.md")), false);
});

// --- making it -------------------------------------------------------------------------

test("the file is made empty, and opened where E can reach it", (t) => {
  // Arrange
  const root = makeRepo(t);
  const state = browsing(t, root);

  // Act
  const made = create(state, "notes.md");

  // Assert
  assert.strictEqual(made.message, "Created notes.md");
  assert.strictEqual(fs.readFileSync(path.join(root, "notes.md"), "utf8"), "");
  assert.strictEqual(made.view, VIEW_READ);
  assert.strictEqual(made.openPath, "notes.md");
  assert.deepStrictEqual(made.rows, [{ kind: "note", text: "Empty file" }]);
  assert.deepStrictEqual(reduce(made, "E", VIEWPORT).effect, {
    type: "edit",
    path: "notes.md",
    line: null,
  });
});

test("the browser behind it is standing on the file that was just made", (t) => {
  // Arrange
  const root = makeRepo(t);
  const state = browsing(t, root);

  // Act: back out of the reader the way Esc does
  const made = create(state, "notes.md");
  const back = reduce(made, "escape", VIEWPORT);

  // Assert
  assert.strictEqual(back.view, VIEW_BROWSE);
  assert.strictEqual(back.browse.entries[back.browse.index].path, "notes.md");
});

test("it lands under the directory the browser is showing", (t) => {
  // Arrange: stepped into lib/
  const root = makeRepo(t);
  const inLib = reduce(browsing(t, root), "l", VIEWPORT);
  assert.strictEqual(inLib.browse.dir, "lib");

  // Act
  const made = create(inLib, "b.js");

  // Assert
  assert.strictEqual(made.openPath, "lib/b.js");
  assert.strictEqual(fs.existsSync(path.join(root, "lib", "b.js")), true);
});

test("a name with directories in it makes them", (t) => {
  // Arrange: a directory with nothing in it never appears in this browser, so "go
  // there first" is advice a reader could not take
  const root = makeRepo(t);
  const state = browsing(t, root);

  // Act
  const made = create(state, "docs/guides/first.md");

  // Assert
  assert.strictEqual(made.message, "Created docs/guides/first.md");
  assert.strictEqual(fs.existsSync(path.join(root, "docs", "guides", "first.md")), true);
});

test("a filter narrowing the listing is dropped, so the new file is really there", (t) => {
  // Arrange: the listing narrowed to something the new name will not match
  const root = makeRepo(t);
  const filtered = reduce(type(reduce(browsing(t, root), "f", VIEWPORT), "READ"), "enter", VIEWPORT);
  assert.strictEqual(filtered.browse.filter, "READ");
  assert.deepStrictEqual(
    filtered.browse.entries.map((entry) => entry.name),
    ["README.md"]
  );

  // Act
  const made = create(filtered, "notes.md");
  const back = reduce(made, "escape", VIEWPORT);

  // Assert: a filter that hid what was just made would be a listing that lies
  assert.strictEqual(back.browse.filter, "");
  assert.strictEqual(back.browse.entries[back.browse.index].path, "notes.md");
});

test("what was made is in the browser's listing afterwards", (t) => {
  // Arrange: the listing comes from git, and the pane read it before the file existed
  const root = makeRepo(t);
  const state = browsing(t, root);

  // Act
  const made = create(state, "notes.md");

  // Assert
  assert.ok(made.repoPaths.includes("notes.md"), "the path list was not read again");
});

test("making a file is remembered as reading one", (t) => {
  // Arrange
  const root = makeRepo(t);
  const state = browsing(t, root);

  // Act
  const made = create(state, "notes.md");

  // Assert: written to the journal rather than left on the state to be lost
  assert.ok(
    made.journal.some((entry) => entry.path === "notes.md"),
    "the file it opened was not recorded"
  );
  assert.strictEqual(made.effect, null, "the journal write was left for the next key");
  const onDisk = JSON.parse(fs.readFileSync(state.journalFile, "utf8"))[root];
  assert.deepStrictEqual(
    onDisk.map((entry) => entry.path),
    ["notes.md"],
    "the journal on disk does not say what the journal in hand does"
  );
});

// --- refusing to make it ----------------------------------------------------------------

test("a name something already answers to is refused, file or directory", (t) => {
  // Arrange
  const root = makeRepo(t);
  const state = browsing(t, root);

  // Act & Assert
  assert.strictEqual(performCreate(state, { path: "README.md" }).message, "README.md already exists");
  assert.strictEqual(performCreate(state, { path: "lib" }).message, "lib already exists");
  // And the one that was there is untouched
  assert.strictEqual(fs.readFileSync(path.join(root, "README.md"), "utf8"), "# readme\n");
});

test("a name that climbs out of the repository is refused", (t) => {
  // Arrange
  const root = makeRepo(t);
  const state = browsing(t, root);

  // Act & Assert
  for (const name of ["../escaped.txt", "lib/../../escaped.txt"]) {
    assert.match(performCreate(state, { path: name }).message, /not a name inside the repository/);
  }
  assert.strictEqual(fs.existsSync(path.join(root, "..", "escaped.txt")), false);
});

test("an absolute path is not a name inside the repository", (t) => {
  const state = browsing(t, makeRepo(t));

  assert.match(
    performCreate(state, { path: path.join(os.tmpdir(), "escaped.txt") }).message,
    /not a name inside the repository/
  );
});

test("a directory that is a symlink out of the repository is refused", (t) => {
  // Arrange: git tracks symlinks, so a repository can carry one — and the name using
  // it has no `..` in it and nothing else wrong with it either
  const root = makeRepo(t);
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "herdr-deep-code-reading-outside-"));
  t.after(() => fs.rmSync(outside, { recursive: true, force: true }));
  fs.symlinkSync(outside, path.join(root, "elsewhere"));
  const state = browsing(t, root);

  // Act
  const refused = performCreate(state, { path: "elsewhere/escaped.txt" });

  // Assert
  assert.match(refused.message, /outside the repository/);
  assert.strictEqual(fs.existsSync(path.join(outside, "escaped.txt")), false);
});

test("a name that cannot be made leaves no directories behind for it", (t) => {
  // Arrange: a file where a directory would have to be
  const root = makeRepo(t);
  const state = browsing(t, root);

  // Act
  const refused = performCreate(state, { path: "README.md/deeper/x.txt" });

  // Assert
  assert.match(refused.message, /Could not create/);
  assert.strictEqual(fs.existsSync(path.join(root, "README.md", "deeper")), false);
});

test("a repository that is not there is not written to", () => {
  const state = { repoDir: path.join(os.tmpdir(), "herdr-deep-code-reading-nowhere"), browse: null };

  assert.match(performCreate(state, { path: "x.txt" }).message, /Cannot read/);
});
