# Changelog

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the
versions follow [semantic versioning](https://semver.org/spec/v2.0.0.html).

## 1.0.0

The first release. Everything here is what the plugin is, rather than what changed in
it — later entries will be the other way round.

### Reading a file

- A file browser over `git ls-files`, with a preview column, a name filter, and a
  search through the contents of every file — literal by default, a regular expression
  on `Ctrl+R`. `a` makes a new empty file at a name you type, directories and all;
  what goes in it is your editor's business.
- A reading view for any file, where the comment keys work exactly as they do on a
  diff, so any line of any file can be a note to an agent.
- `Enter` follows the name under the cursor to where it is defined, and `R` lists
  everywhere it is not — the calls, the imports, the mentions. `o` lists what a file
  declares, `i` what it reaches for and what reaches for it. A jump leaves the line a
  third of the way down the body, so the thing jumped to can be read where it lands.
- `K` shows what the name under the cursor is — twelve lines of its definition, in
  place of the body, without going there. `Esc` puts it away and takes nothing else
  with it.
- One row under the header holds the thing the cursor is inside: the enclosing
  function when a file is being read, the hunk heading when a diff is.
- Outlines, definition jumps and uses lists for JavaScript, TypeScript, Dart, Java,
  Kotlin, C#, Swift, C, C++, Go, Rust, PHP, Python, Ruby, Lua, shell, SQL, Markdown,
  HTML, CSS with Sass and Less, Vue, TOML and YAML. A file in any other language still
  gets its comments, strings and numbers coloured, and `o` says the language has no
  patterns rather than that the file declares nothing.
- Bookmarks (`m`, `'`) that outlive the pane, stored under `$HERDR_PLUGIN_STATE_DIR`
  and keyed by repository. A bookmark records the line's text as well as its number,
  so it survives the file growing a header.
- Long lines wrap rather than being cut, measured in terminal cells so full-width text
  breaks in the right place, and the frame leaves the last column alone so that
  nothing wrapped is lost to a host that is a column out.

### Reading a diff

- Three diffs, each opened from a Herdr action: the working tree against `HEAD`, the
  staged changes, and the whole branch against the default branch. `D` loads the
  working tree's diff from anywhere, and `Ctrl+O` gives back the one it was pressed
  from.
- Side-by-side or unified, chosen by the terminal's width and overruled by `t`.
- The words that changed within a changed line are picked out, by walking in from both
  ends until the two lines stop agreeing — git's own `contrib/diff-highlight` method,
  which never claims a word changed when it did not. A line rewritten end to end is
  left alone.
- `+` and `-` ask git for more of the file around each change, or less: no context,
  three lines, six, twelve, twenty-five, fifty, the whole file. `=` turns on `-w` and
  stops counting whitespace as a change. Both are named in the header while set.
- `V` marks a file read, and unread again. The mark records the file's own diff, so an
  agent touching the file afterwards makes it unread. The header counts them.

### The history

- `L` opens the commit graph, drawn by `git log --all --graph` and coloured one colour
  per lane, with the branch list beside it and the chosen commit's files and diff
  below. `a` narrows to the branch you are on, `f` follows the trunk one merge at a
  time, `A` narrows to one author, and `V` marks a commit read.
- Each local branch carries how far it has drifted from the one it follows — `↓3`
  waiting, `↑2` not sent, `gone` for an upstream deleted at the other end — and the
  header dates the answer, because those counts are read from a copy only a fetch
  updates.
- `H` on a file lists the commits that touched it; `v` then `H` narrows that to the
  marked lines, which is `git log -L`.
- `B` labels every line with the commit it came from, and `C` opens that commit.
- `#` finds the commits where a string arrived or went — git's pickaxe, which is
  deliberately not the commits that mention it.
- `J` lists where the reading has been: every file opened from the browser or named by
  path, and every commit opened from the log or a history list, oldest first, kept per
  repository across panes.

### Working with an agent

- `c` writes a comment on a line or a marked run, anchored to the verbatim lines it
  points at rather than to line numbers, which rot. `"` lists every comment written so
  far.
- `@` asks an agent about the line or the marked run instead, and hands it the exact
  command to answer with — every path absolute, nothing to discover, no quoting around
  the text.
- `S` opens the list with everything chosen, `space` leaves one out, and `Enter` sends
  what is left as one markdown message: the comments as things to change, the
  questions as things to answer. Any pane in the workspace carrying an agent is a
  candidate; several open a picker; none writes the batch to a file and says where.
  The batch is pasted and never submitted — you read it and press Enter yourself.
- `bin/note.js` is the way back in: one command, one note, no socket and no protocol.
  An answer longer than a line comes in on stdin. It lands beside the line it is about,
  marked `◆`, and `K` reads it out where it sits. `&` lists every answer there is.
- `W` watches the repository and reloads the pane when it moves, keeping the reader
  where they were — and catches up before it starts, so an answer written while it was
  off is on screen the moment it is turned on. Sending a question turns it on.
- `X` writes the session out as one markdown file: the commits opened and which were
  read through, the files opened, every question with whatever came back, and the
  comments as they were written.

### Changing the repository

Only through git, and only these:

- Staging (`space`, `A`), unstaging, and committing (`C`, in as many lines as the
  message needs).
- `F` fetches every remote and prunes what they no longer have, which moves nothing
  local. `p` pulls onto the branch already checked out and `P` pushes that branch's own
  commits, each after naming what it is about to do and waiting for a second press.
  Nothing forces.
- A merge that stops has a screen of its own: each file and which of the seven kinds of
  conflict it is, the two versions drawn apart in the file itself, `o` and `t` to take
  one side whole, `space` to say one you edited by hand is done, `C` to commit with the
  message git wrote, and `!` to undo the whole thing. `M` opens it from anywhere and
  every header says so while it lasts.
- Nothing else writes a file of yours. `E` hands one to `$VISUAL` or `$EDITOR` at the
  line under the cursor, the way yazi does, and steps aside; `a` creates a file and
  creates it empty.

### Around the edges

- `P` opens a file by part of its path, or a definition by `@name`. `|` opens a second
  pane of the plugin beside this one, at the place under the cursor. `O` shows what the
  view points at in the desktop's file manager.
- `?` lists every key the view binds. The footer has four rows at most, names every key
  the view binds and only the keys that do something there, and says `… ? keys` when
  the list outgrows the rows.
- `Q` quits, shifted so that it is not pressed by accident, and asks first when there
  are unsent comments. `Ctrl+C` quits from anywhere. Unsent comments are written to
  `$HERDR_PLUGIN_STATE_DIR` if the pane ever crashes.
- Nothing a repository names can repaint the terminal: file names, commit subjects,
  authors and an agent's label are stripped of control characters, seven-bit and eight,
  before they are drawn.
- What the plugin writes of its own — bookmarks, read marks, notes, the reading record
  — is written private, and the reply command a question carries is quoted for a shell.

### Configuration

- `config.toml` in the directory Herdr gives the plugin, read as a flat list of
  `key = value` lines, and overruled by the environment.
- Four palettes: `catppuccin-mocha` and `classic` for dark terminals, `catppuccin-latte`
  and `classic-light` for light ones. A light palette is never chosen for you.
- The row under the cursor is drawn as a band of colour across its whole width, with an
  added or removed line keeping its own hue under it. `cursorline = false` turns it off,
  and `worddiff = false` turns off the word highlighting.
- `j`/`k` always move the cursor down the lines and `n`/`p` always move the file list.
  Neither takes a turn at being the other.

### Not offered, deliberately

Hunk-level staging and hunk-level conflict resolution, force-push of any kind, amend,
revert, discard, checkout, branch, rebase, cherry-pick, stash, mouse support, comment
persistence across sessions, and Windows — the manifest declares macOS and Linux.
