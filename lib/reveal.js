"use strict";

// Handing a path to the desktop's own file manager.
//
// The first thing this plugin does that is neither git nor the terminal. It still
// writes nothing: the file manager is asked to show something, and what happens next
// belongs to the desktop rather than here.
//
// Deciding what to run is separated from running it so the decision can be tested
// on every platform from any of them.

const DARWIN = "darwin";
const LINUX = "linux";

// macOS opens a directory and reveals a file; the difference is what a reader means
// by each. Asking Finder to reveal a directory would show its parent with the
// directory selected, which is not what "open this folder" means.
const MACOS_OPENER = "open";
const MACOS_REVEAL_FLAG = "-R";

// xdg-open has no reveal, so a file is shown by opening the directory holding it.
// Opening the file itself would launch an editor, which is not what was asked for.
const LINUX_OPENER = "xdg-open";

/** The directory a path is shown from when only a directory can be opened. */
function containingDirectory(target) {
  const slash = target.lastIndexOf("/");
  return slash <= 0 ? "." : target.slice(0, slash);
}

/**
 * What to run to show a path in the desktop's file manager.
 *
 * @param {string} platform A value of process.platform
 * @param {string} target Absolute path, already proved to be inside the repository
 * @param {boolean} isDirectory Whether the target is a directory
 * @returns {{command: string, args: Array<string>}|null} null where there is no
 *   file manager this knows how to ask
 */
function revealCommand(platform, target, isDirectory) {
  if (platform === DARWIN) {
    return isDirectory
      ? { command: MACOS_OPENER, args: [target] }
      : { command: MACOS_OPENER, args: [MACOS_REVEAL_FLAG, target] };
  }

  if (platform === LINUX) {
    return {
      command: LINUX_OPENER,
      args: [isDirectory ? target : containingDirectory(target)],
    };
  }

  return null;
}

/** What to tell a reader whose desktop this does not know how to ask. */
function unsupportedMessage(platform) {
  return `No file manager to open on ${platform}`;
}

module.exports = {
  DARWIN,
  LINUX,
  containingDirectory,
  revealCommand,
  unsupportedMessage,
};
