#!/bin/sh
# The repository the demo is recorded against.
#
# Built from nothing every time, so what the recording shows does not depend on the
# machine it was recorded on. Meant to be sourced rather than run: it leaves the shell
# standing inside the repository it made.
#
#   . docs/demo-repo.sh
#
# It also puts a stub herdr on HERDR_BIN_PATH. The recording presses S, which asks
# herdr which agents are running and pastes the review into one of them — and a
# recording is not allowed to reach into whatever session happens to be open on the
# machine making it. The stub answers with one agent and swallows the paste. What ends
# up on screen is the message a real run prints, because it is the same code path.

DEMO_STUB_DIR=$(mktemp -d)
DEMO_REPO_DIR=$(mktemp -d)

cat > "$DEMO_STUB_DIR/herdr" <<'STUB'
#!/bin/sh
if [ "$1 $2" = "agent list" ]; then
  printf '%s' '{"result":{"agents":[{"agent":"claude","pane_id":"w1:p2","agent_status":"idle","workspace_id":"w1","terminal_title_stripped":"greet.js"}]}}'
fi
exit 0
STUB
chmod +x "$DEMO_STUB_DIR/herdr"

export HERDR_BIN_PATH="$DEMO_STUB_DIR/herdr"
# The recording's own environment must not narrow the agent list, and must not be
# taken for a plugin directory holding somebody's settings
unset HERDR_WORKSPACE_ID HERDR_PANE_ID HERDR_PLUGIN_CONFIG_DIR HERDR_PLUGIN_STATE_DIR
unset HERDR_DEEP_CODE_READING_THEME HERDR_DEEP_CODE_READING_LAYOUT
unset HERDR_DEEP_CODE_READING_CURSORLINE

cd "$DEMO_REPO_DIR" || return 1

git init -q
git config user.email demo@example.com
git config user.name "Demo"
git config commit.gpgsign false

cat > greet.js <<'BEFORE'
"use strict";

// Greeting one person, and greeting a list of them.

const DEFAULT_GREETING = "Hello";
const MAX_NAME_LENGTH = 64;

function isName(value) {
  return typeof value === "string" && value.length > 0;
}

function greet(name) {
  if (!isName(name)) {
    throw new Error("greet needs a name");
  }
  return DEFAULT_GREETING + ", " + name + "!";
}

function greetAll(names) {
  const out = [];
  for (let i = 0; i < names.length; i++) {
    out.push(greet(names[i]));
  }
  return out;
}

module.exports = { greet, greetAll, isName };
BEFORE

cat > roster.js <<'BEFORE'
"use strict";

const { greetAll } = require("./greet");

function roster(people) {
  return greetAll(people.map((person) => person.name)).join("\n");
}

module.exports = { roster };
BEFORE

git add -A
git commit -qm "feat: greet a list of people"

# The change the recording reviews.
cat > greet.js <<'AFTER'
"use strict";

// Greeting one person, and greeting a list of them.

const DEFAULT_GREETING = "Hello";
const MAX_NAME_LENGTH = 64;

function isName(value) {
  return typeof value === "string" && value.length > 0 && value.length <= MAX_NAME_LENGTH;
}

/**
 * Greet one person.
 * @param {string} name Who to greet
 * @param {string} [greeting] What to say instead of "Hello"
 */
function greet(name, greeting) {
  if (!isName(name)) {
    throw new Error(`greet needs a name, not ${typeof name}`);
  }
  const opening = greeting === undefined ? DEFAULT_GREETING : greeting;
  return `${opening}, ${name}!`;
}

function greetAll(names, greeting) {
  return names.map((name) => greet(name, greeting));
}

module.exports = { greet, greetAll, isName };
AFTER

cat > roster.js <<'AFTER'
"use strict";

const { greetAll } = require("./greet");

function roster(people, greeting) {
  return greetAll(people.map((person) => person.name), greeting).join("\n");
}

module.exports = { roster };
AFTER
