"use strict";

// What the linter checks.
//
// Correctness only: unused variables, shadowed bindings, accidental globals, the
// mistakes that read as working code. Nothing here has an opinion about layout —
// this project has a voice, and a formatter would rewrite it into a different one.

const js = require("@eslint/js");
const globals = require("globals");

module.exports = [
  {
    ignores: ["node_modules/**"],
  },
  js.configs.recommended,
  {
    files: ["**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      // The plugin runs on Node and is written in CommonJS, which is what lets it
      // ship without a build step
      sourceType: "commonjs",
      globals: globals.node,
    },
    linterOptions: {
      // A rule turned off for a line that no longer needs it is a comment that has
      // stopped being true
      reportUnusedDisableDirectives: "error",
    },
    rules: {
      // Off, deliberately. This is a terminal application: it strips the control
      // characters out of a line before drawing it, and its tests take the escape
      // sequences back out of a frame to measure how wide it came out. A control
      // character in a regular expression here is the tool for the job rather than a
      // typo — see lib/text.js and test/render.test.js.
      "no-control-regex": "off",
      // An unused require is a dependency the file does not have. The argument
      // exception covers a callback that must accept a parameter it ignores.
      "no-unused-vars": ["error", { args: "after-used", argsIgnorePattern: "^_" }],
      // A shadowed name is how an edit to an inner scope silently stops affecting the
      // outer one
      "no-shadow": "error",
      // Immutability is the house rule; reassigning a binding is not always a
      // mutation, but a binding that never needs to change should say so
      "prefer-const": "error",
      "no-var": "error",
      // Debug output would be written into a terminal this owns in raw mode
      "no-console": "error",
      "eqeqeq": ["error", "smart"],
      "no-param-reassign": "error",
      "no-return-await": "error",
      "no-throw-literal": "error",
    },
  },
];
