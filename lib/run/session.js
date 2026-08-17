"use strict";

// The pane's own lifetime: what draws it, what keeps it up to date with the
// repository, and what takes the terminal back when it ends.
//
// The state itself lives in a one-field box the handlers share, so that a keystroke,
// a resize and a watcher tick are all looking at the same current state rather than
// at whichever one they closed over.

const { drawnAt, reloadedInPlace, toScreenModel } = require("../app-state");
const { renderScreen } = require("../render");
const watch = require("../watch");
const { rescueComments } = require("./effects");
const { handleInput } = require("./input-loop");
const { leaveFullScreen, terminalSize, viewportHeight } = require("./terminal");

const EXIT_FAILURE = 1;
// How long a message keeps the footer before the key list comes back. Long enough
// to read a line, short enough that the keys are never gone for long.
const MESSAGE_TIMEOUT_MS = 4000;

/**
 * What a message leaves behind once it has been on screen long enough.
 *
 * The quit prompt goes with its own message. It is armed by the message the reader
 * has just been shown, and a prompt nobody can see any more must not still be
 * counting the next `q` as the second press.
 */
function expireMessage(state) {
  if (state.message === null || state.message === undefined) {
    return state;
  }
  return { ...state, message: null, pendingQuit: false };
}

/**
 * The poller that keeps the pane up to date with the repository.
 *
 * It is armed and disarmed by the `watch` effect rather than running always: rows
 * rebuilding under a reader who did not ask for it is worse than pressing `r`.
 *
 * `sync` is how the pane tells the watcher that it has just reloaded of its own
 * accord — after an edit, a stage, or a commit. Without it the next tick would see
 * the change the pane itself made and reload again, announcing work already done.
 */
function createWatcher(session, runtime) {
  let timer = null;
  let seen = null;

  const sync = () => {
    if (timer !== null) {
      seen = watch.fingerprint(session.state.repoDir, session.state.notesFile);
    }
  };

  const tick = () => {
    if (!watch.canReload(session.state)) {
      return; // The change keeps; the fingerprint is deliberately not recorded
    }

    const now = watch.fingerprint(session.state.repoDir, session.state.notesFile);
    if (now === null || now === seen) {
      return;
    }

    seen = now;
    session.state = reloadedInPlace(
      session.state,
      "Reloaded — the repository changed",
      viewportHeight(session.state)
    );
    runtime.draw();
  };

  const stop = () => {
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  };

  return {
    sync,
    stop,
    // Exposed so the test can drive a tick rather than wait for one. The interval
    // is the only part not covered by that, and it is one setInterval call.
    tick,
    /**
     * Start or stop the poll.
     *
     * Told what to do rather than reading it off the session: the effect is performed
     * before the new state is put back on the session, so `session.state` here is
     * still the state the key was pressed in.
     */
    follow: (shouldWatch) => {
      if (shouldWatch !== true) {
        stop();
        return;
      }
      if (timer !== null) {
        return;
      }
      // What is on screen is already up to date, so the first tick has a baseline to
      // compare against rather than reloading the moment the watch is turned on
      seen = watch.fingerprint(session.state.repoDir, session.state.notesFile);
      timer = setInterval(tick, watch.WATCH_INTERVAL_MS);
      // A poll is not a reason to keep the pane open
      timer.unref();
    },
  };
}

/** The terminal-facing side of the app: drawing, restoring, and exiting once. */
function createRuntime(session) {
  let restored = false;
  let messageTimer = null;
  // Set once main() has one to give; restore() stops it on the way out
  let watcher = null;

  const stopTimer = () => {
    if (messageTimer !== null) {
      clearTimeout(messageTimer);
      messageTimer = null;
    }
  };

  const restore = () => {
    if (restored) {
      return;
    }
    restored = true;
    stopTimer();
    if (watcher !== null) {
      watcher.stop();
    }
    leaveFullScreen();
  };

  const draw = () => {
    const size = terminalSize();
    // The rows in hand were wrapped to a width, and this is the width they are about
    // to be drawn at. A resize keeps the two the same — but the pane is sized after
    // the process has read its width and before it has begun listening, so the first
    // one can be missed, and a row one column too wide for the row it is drawn into
    // loses its last character rather than moving it. Asking here costs one comparison
    // a frame and closes the question for every path, seen resize or not.
    session.state = drawnAt(session.state, size.columns);
    process.stdout.write(renderScreen(toScreenModel(session.state), size));

    // A message takes rows away from the key list, and on a wide terminal the whole
    // list is one row — so "Staged every change" leaves a footer with no keys on it
    // at all. It gives them back on its own: waiting for a keystroke means waiting
    // for one whose name the reader can no longer see.
    stopTimer();
    if (session.state.message === null || session.state.message === undefined) {
      return;
    }
    messageTimer = setTimeout(() => {
      messageTimer = null;
      session.state = expireMessage(session.state);
      draw();
    }, MESSAGE_TIMEOUT_MS);
    // A footer is not a reason to keep the pane open
    messageTimer.unref();
  };

  return {
    restore,
    draw,
    set watcher(value) {
      watcher = value;
    },
    get watcher() {
      return watcher;
    },
    /**
     * Say something that arrived after the effect that caused it had returned.
     * A child process reports a failure to start on an event, a tick later, by
     * which time the state it belonged to is already on screen.
     */
    report: (message) => {
      session.state = { ...session.state, message };
      draw();
    },
    shutdown: (code) => {
      restore();
      process.exit(code);
    },
  };
}

/** Wire the process's own events to the session: keys, resizes, signals, crashes. */
function installHandlers(session, runtime) {
  process.stdin.on("data", (data) => handleInput(session, runtime, data));

  // Drawing is what follows a width, so a resize has only to ask for a frame: the draw
  // rewraps to whatever the terminal is now — see createRuntime. Rewrapping here as
  // well would be the same question asked twice, and two places to change the answer.
  process.stdout.on("resize", () => runtime.draw());

  process.on("SIGINT", () => runtime.shutdown(0));
  process.on("SIGTERM", () => runtime.shutdown(0));
  process.on("exit", runtime.restore);
  // The last line of defence. A key that throws is already caught in applyKey, so
  // what reaches here is something worse — a frame that cannot be drawn, most likely
  // — and the pane is going down either way. The review does not have to go with it.
  process.on("uncaughtException", (error) => {
    runtime.restore();
    process.stderr.write(
      `herdr-deep-code-reading: unexpected error: ${error.stack}\n` + rescueComments(session.state.comments)
    );
    process.exit(EXIT_FAILURE);
  });
}

module.exports = {
  MESSAGE_TIMEOUT_MS,
  createRuntime,
  createWatcher,
  expireMessage,
  installHandlers,
};
