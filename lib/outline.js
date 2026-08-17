"use strict";

// The definitions a file declares, and the files it reaches for.
//
// This is the same bargain lib/syntax.js makes: a grammar per language is what a
// real answer needs, and with no dependencies allowed the useful 80% is a set of
// patterns applied a line at a time. It will miss a definition written unusually and
// occasionally name one that is not there — which is why nothing here is used to
// decide anything, only to offer the reader somewhere to jump.
//
// Only top-level definitions are collected. An outline that lists every nested
// closure is a second copy of the file, not a way through it.
//
// A document has headings where code has definitions, and they are not something a
// line answers on its own: a `#` inside a fenced block is that language's comment.
// Markdown is read by ./markdown, which knows where the fences are.

const { headingAt, markdownHeadings } = require("./markdown");
const { MARKDOWN, detectLanguage } = require("./syntax");

// The shape a JavaScript file declares things in, which a TypeScript file shares.
// A binding may carry a type annotation, so the `=` a declaration is recognised by
// has to be reachable past one.
const JAVASCRIPT_DEFINITIONS = [
  /^(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/,
  /^(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/,
  /^(?:export\s+)?(?:declare\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*[:=]/,
  // A method of an object literal or a class body, indented by exactly two spaces.
  // The visibility words are TypeScript's; JavaScript never writes them, so sharing
  // the pattern costs nothing and saves keeping two copies in step.
  //
  // The C patterns tell a definition from a control statement by the return type in
  // front of it. A method has none, so the control words are named and refused here
  // instead: `  if (ready) {` has exactly the shape of a method and is not one.
  /^ {2}(?:(?:public|private|protected|static|async|readonly|abstract)\s+)*(?:get\s+|set\s+)?(?!(?:if|for|while|switch|catch|do|else|return|typeof|await|new|delete|void)\b)([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*[:{]/,
];

// What a TypeScript file says that a JavaScript one cannot. These come first: a
// line naming a type is never also a binding, so nothing is taken from the list
// above, and putting them first keeps the type-level reading of the line.
const TYPESCRIPT_DEFINITIONS = [
  /^(?:export\s+)?(?:declare\s+)?(?:abstract\s+)?interface\s+([A-Za-z_$][\w$]*)/,
  /^(?:export\s+)?(?:declare\s+)?type\s+([A-Za-z_$][\w$]*)\s*[=<]/,
  /^(?:export\s+)?(?:declare\s+)?(?:const\s+)?enum\s+([A-Za-z_$][\w$]*)/,
  /^(?:export\s+)?(?:declare\s+)?(?:module|namespace)\s+([A-Za-z_$][\w$.]*)/,
];

// C, and what a header written in C++ adds to it.
//
// A C file will never contain a line starting `class` or `namespace`, so offering
// both languages the same patterns costs nothing and means a .h read as C — which
// lib/syntax.js does deliberately, for the keywords — still outlines its classes.
//
// A function is told from a control statement by its return type: `if (ready) {`
// has the shape of a definition and is not one, so a word before the name is
// required. That also gives up on a definition written with the type on its own
// line, which is the usual bargain here.
const C_DEFINITIONS = [
  /^#\s*define\s+([A-Za-z_]\w*)/,
  /^typedef\s+.*\b([A-Za-z_]\w*)\s*;/,
  /^(?:template\s*<[^>]*>\s*)?(?:class|struct|union|namespace|enum(?:\s+class)?)\s+([A-Za-z_]\w*)/,
  /^[A-Za-z_][A-Za-z0-9_ \t*&:<>,]*?[ \t*&]\**([A-Za-z_]\w*)\s*\([^;]*\)\s*(?:const\s*)?\{\s*$/,
];

// Dart, which the highlighter has known since it was added and this did not — a Dart
// file's outline was empty, which reads as "nothing declared here" rather than as a
// gap in the patterns.
//
// A function is told from a call by what follows the brackets: a declaration opens a
// body with `{` or an arrow with `=>`, where the constructor calls a build method is
// made of end in `,` or `)`. Getting that wrong would outline a widget tree.
const DART_DEFINITIONS = [
  /^(?:(?:abstract|base|final|sealed|interface)\s+)*(?:class|mixin|extension|enum)\s+([A-Za-z_$][\w$]*)/,
  /^typedef\s+([A-Za-z_$][\w$]*)/,
  /^(?:final|const|var|late)\s+(?:[\w$<>,[\]?]+\s+)?([A-Za-z_$][\w$]*)\s*=/,
  // A top-level getter: `String get title => _title;` has no brackets to be found by
  /^[A-Za-z_$][\w$<>,[\]?]*\s+get\s+([A-Za-z_$][\w$]*)/,
  // A top-level function: a return type, a name, and a body or an arrow
  /^[A-Za-z_$][\w$<>,[\]? ]*\s+([A-Za-z_$][\w$]*)\s*\([^;]*\)\s*(?:async\*?\s*)?(?:\{|=>)/,
  // A method of a class body, indented by exactly two spaces
  /^ {2}(?:(?:static|final|const|late|external)\s+)*(?:[\w$<>,[\]?]+\s+)?(?:get\s+)?([A-Za-z_$][\w$]*)\s*(?:\([^;]*\))?\s*(?:async\*?\s*)?(?:\{|=>)/,
];

// Lua. A function is declared four ways — bare, local, on a table, and as a method —
// and the name carries the dots and colons that say which, because `M.setup` is what
// a reader looking for it will type.
const LUA_DEFINITIONS = [
  /^(?:local\s+)?function\s+([A-Za-z_][\w.:]*)/,
  /^(?:local\s+)?([A-Za-z_][\w.]*)\s*=\s*function\s*\(/,
  /^local\s+([A-Za-z_]\w*)\s*=/,
  /^ {2}([A-Za-z_][\w.:]*)\s*=\s*function\s*\(/,
];

// Swift. The function pattern comes first because `class` is both a kind of type and
// a modifier on a member: `class func make()` declares a function, and a type pattern
// asked first would call it a type named `func`.
const SWIFT_DEFINITIONS = [
  /^(?:@[\w()]+\s+)*(?:(?:public|private|internal|fileprivate|open|final|static|class|override|mutating|nonmutating|convenience|required|discardableResult)\s+)*func\s+([A-Za-z_]\w*)/,
  /^(?:@[\w()]+\s+)*(?:(?:public|private|internal|fileprivate|open|final|indirect)\s+)*(?:class|struct|enum|protocol|extension|actor)\s+([A-Za-z_]\w*)/,
  /^(?:(?:public|private|internal|fileprivate|open|static|final|lazy|weak|unowned)\s+)*(?:let|var)\s+([A-Za-z_]\w*)/,
  /^typealias\s+([A-Za-z_]\w*)/,
  /^ {4}(?:@[\w()]+\s+)*(?:(?:public|private|internal|fileprivate|open|final|static|class|override|mutating|convenience|required)\s+)*func\s+([A-Za-z_]\w*)/,
  /^ {4}(?:(?:public|private|internal|fileprivate|open|static|final|lazy|weak|unowned)\s+)*(?:let|var)\s+([A-Za-z_]\w*)/,
];

// Kotlin. `fun` first for the reason Swift's `func` is: `enum class` and `data class`
// put a type word in front of the type keyword, and a function may carry a receiver —
// `fun String.slugify()` declares `slugify`, not `String`.
const KOTLIN_DEFINITIONS = [
  /^(?:(?:public|private|internal|protected|open|override|suspend|inline|operator|infix|tailrec|external|expect|actual)\s+)*fun\s+(?:<[^>]*>\s*)?(?:[\w.<>?]+\.)?([A-Za-z_]\w*)/,
  /^(?:(?:public|private|internal|protected|open|abstract|sealed|final|data|inner|inline|value|annotation|enum|companion|expect|actual)\s+)*(?:class|interface|object)\s+([A-Za-z_]\w*)/,
  /^(?:(?:public|private|internal|protected|const|lateinit|open|override)\s+)*(?:val|var)\s+([A-Za-z_]\w*)/,
  /^typealias\s+([A-Za-z_]\w*)/,
  /^ {4}(?:(?:public|private|internal|protected|open|override|suspend|inline|operator|abstract)\s+)*fun\s+(?:<[^>]*>\s*)?(?:[\w.<>?]+\.)?([A-Za-z_]\w*)/,
];

// PHP. A namespace is a declaration a reader jumps to as readily as a class, and it
// keeps its backslashes: `App\Models` is what the file calls itself.
const PHP_DEFINITIONS = [
  /^(?:(?:abstract|final|readonly)\s+)*(?:class|interface|trait|enum)\s+([A-Za-z_]\w*)/,
  /^(?:(?:public|private|protected|static|abstract|final)\s+)*function\s+&?\s*([A-Za-z_]\w*)/,
  /^namespace\s+([\w\\]+)/,
  /^(?:define\s*\(\s*['"]|const\s+)([A-Za-z_]\w*)/,
  /^ {4}(?:(?:public|private|protected|static|abstract|final|readonly)\s+)*function\s+&?\s*([A-Za-z_]\w*)/,
];

// C#. A member is told from a statement by the two words in front of its brackets: a
// return type and a name. `if (ready)` has one word and `return new Order();` has no
// bracket where a member's name would put one.
const CSHARP_DEFINITIONS = [
  /^namespace\s+([\w.]+)/,
  // A type at any of the indents a namespace puts it at. C# has written `namespace X
  // { ... }` for twenty years and the file-scoped `namespace X;` only since C# 10, so
  // a pattern anchored at the margin would miss the class in most files there are.
  /^ {0,8}(?:(?:public|private|protected|internal|static|sealed|abstract|partial|readonly|unsafe|new|file)\s+)*(?:class|interface|struct|enum|record(?:\s+struct)?)\s+([A-Za-z_]\w*)/,
  /^ {4,8}(?:\[[^\]]*\]\s*)?(?:(?:public|private|protected|internal|static|virtual|override|async|sealed|abstract|extern|unsafe|new|partial|readonly|required|const)\s+)+[\w<>[\],.?]+\s+([A-Za-z_]\w*)\s*(?:\(|\{|=>|;)/,
  // A constructor, which is the one member with no return type in front of its name.
  // At least one modifier is required: without that this is the shape of every `if`.
  /^ {4,12}(?:(?:public|private|protected|internal|static|unsafe|extern)\s+)+([A-Z]\w*)\s*\(/,
];

// SQL, which shouts and indents where it likes, so this is the one language whose
// patterns are asked without case and past whatever whitespace opens the line.
const SQL_DEFINITIONS = [
  /^\s*create\s+(?:or\s+replace\s+)?(?:global\s+)?(?:temp(?:orary)?\s+)?(?:unique\s+)?(?:materialized\s+)?(?:table|view|index|function|procedure|trigger|type|schema|sequence|database)\s+(?:if\s+not\s+exists\s+)?[`"[]?([\w.]+)/i,
  /^\s*alter\s+table\s+(?:if\s+exists\s+)?[`"[]?([\w.]+)/i,
];

// A document rather than a program. What a reader jumps to in one is a heading or the
// thing an anchor points at, so those are what it declares.
const HTML_DEFINITIONS = [
  /^\s*<h[1-6]\b[^>]*>([^<]+)</,
  /\bid=["']([A-Za-z_][\w-]*)["']/,
];

// A stylesheet declares by selecting. The whole selector is the name, because `.card`
// and `.card > .title` are two different rules and naming both `.card` helps nobody.
const CSS_DEFINITIONS = [
  /^(@[\w-]+[^{;]*?)\s*\{/,
  /^(\$[\w-]+)\s*:/,
  /^(--[\w-]+)\s*:/,
  /^([^@$\s{}][^{}]*?)\s*\{\s*$/,
];

const DEFINITIONS = {
  javascript: JAVASCRIPT_DEFINITIONS,
  typescript: [...TYPESCRIPT_DEFINITIONS, ...JAVASCRIPT_DEFINITIONS],
  dart: DART_DEFINITIONS,
  c: C_DEFINITIONS,
  cpp: C_DEFINITIONS,
  java: [
    /^(?:(?:public|private|protected|abstract|final|static|sealed|non-sealed)\s+)*(?:class|interface|enum|record|@interface)\s+([A-Za-z_]\w*)/,
    // A method of a class body, indented by two or four spaces. Java writes a
    // return type before the name, which is what tells a method from a call.
    /^ {2,4}(?:@\w+\s+)*(?:[A-Za-z_$][\w$<>[\],.]*\s+)+([A-Za-z_]\w*)\s*\([^;]*\)\s*(?:throws [\w, .]+)?\{/,
  ],
  ruby: [
    /^(?:class|module)\s+([A-Za-z_][\w:]*)/,
    // Ruby method names may end in ? or !, and the two spell different methods
    // from the bare name — `valid?` is not `valid`
    /^(?: {2,4})?def\s+(?:self\.)?([A-Za-z_]\w*[?!=]?)/,
    /^ {2}(?:class|module)\s+([A-Za-z_][\w:]*)/,
  ],
  python: [
    /^(?:async\s+)?def\s+([A-Za-z_]\w*)/,
    /^class\s+([A-Za-z_]\w*)/,
    /^ {4}(?:async\s+)?def\s+([A-Za-z_]\w*)/,
  ],
  rust: [
    /^(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?(?:unsafe\s+)?fn\s+([A-Za-z_]\w*)/,
    /^(?:pub(?:\([^)]*\))?\s+)?(?:struct|enum|trait|union|type|mod)\s+([A-Za-z_]\w*)/,
    /^impl(?:<[^>]*>)?\s+(?:[\w:<>, ]+\s+for\s+)?([A-Za-z_]\w*)/,
    /^ {4}(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?fn\s+([A-Za-z_]\w*)/,
  ],
  go: [
    /^func\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)/,
    /^type\s+([A-Za-z_]\w*)/,
  ],
  shell: [
    /^(?:function\s+)?([A-Za-z_]\w*)\s*\(\)\s*\{/,
  ],
  lua: LUA_DEFINITIONS,
  swift: SWIFT_DEFINITIONS,
  kotlin: KOTLIN_DEFINITIONS,
  php: PHP_DEFINITIONS,
  csharp: CSHARP_DEFINITIONS,
  sql: SQL_DEFINITIONS,
  html: HTML_DEFINITIONS,
  css: CSS_DEFINITIONS,
  // A single-file component is three blocks in one file. Which block a line is in is
  // the first thing a reader wants and the last thing a line can answer on its own,
  // so the blocks themselves are declarations — and what the script declares is
  // JavaScript, which is what it is written in.
  vue: [/^<(template|script|style)\b/, ...JAVASCRIPT_DEFINITIONS],
  toml: [/^\[+([^\]]+)\]+/],
  yaml: [/^([A-Za-z_][\w-]*):/],
  // Markdown has no patterns: a heading is not a line's own business — see below
};

// A relative specifier is the only kind that names a file in this repository; a bare
// one names a package, which the browser has nothing to show for.
const IMPORT_PATTERNS = [
  /\brequire\(\s*["'](\.[^"']*)["']\s*\)/, // CommonJS
  /\bfrom\s+["'](\.[^"']*)["']/, // ES modules, Python-ish
  /\bimport\s+["'](\.[^"']*)["']/, // side-effect import
  /^\s*(?:pub\s+)?use\s+(?:crate|super|self)::([\w:]+)/, // Rust
  /^\s*(?:pub\s+)?mod\s+([a-z_]\w*)\s*;/, // Rust: a module declared elsewhere
];

// What a language reaches for that the shapes above do not describe.
//
// The list above captures relative specifiers only, because in the languages it was
// written for a bare one names a package the browser has nothing to show for. That is
// not true everywhere: a Lua `require` names a module by its dotted path and that path
// is a file in this repository, and a stylesheet and a page name theirs their own ways.
// So a language may add shapes of its own, tried before the common ones.
const IMPORT_PATTERNS_BY_LANGUAGE = {
  lua: [/\brequire\s*\(?\s*["']([\w.]+)["']/],
  css: [/@(?:import|use)\s+["']([^"']+)["']/],
  html: [/\b(?:src|href)=["']([^"']+)["']/],
};

// Every keyword an import uses is also an ordinary English word, so matching the
// word alone would call any prose mentioning the file an import of it. Each branch
// pins the keyword to the shape it has in an import: a call, the start of a line, or
// a quote right after it.
const IMPORT_LINE = new RegExp(
  [
    /\brequire\s*\(/.source, // CommonJS
    /^\s*(?:import|from)\s/.source, // ES modules and Python
    /\bfrom\s*["']/.source, // re-export
    /^\s*(?:pub\s+)?(?:use|mod)\s/.source, // Rust
    /^\s*#\s*include\b/.source, // C family
    /^\s*(?:source|\.)\s+\S/.source, // shell
    /\brequire\s*["']/.source, // Lua and Ruby, which write it without brackets
    /^\s*(?:require|include)(?:_once)?\b/.source, // PHP
    /^\s*using\s+[\w.]+\s*;/.source, // C#, which also writes `using (` for a block
    /^\s*@(?:import|use)\b/.source, // CSS, Sass and Less
    // A page pulling something in, which is the tag with a source on it: a Vue
    // component's own `<script setup>` names no file and is not an import of one.
    /^\s*<(?:script|link)\b[^>]*\b(?:src|href)=/.source,
  ].join("|")
);

const NO_PATTERNS = [];

// How long a line may be and still be asked whether it declares something.
//
// A declaration is a line somebody wrote, and a line somebody wrote is short. A file
// may hold lines nobody wrote: a minified bundle, a generated table, a data blob, any
// of which can be the whole file on one line and may be two megabytes of it.
//
// That matters because of how the patterns fail rather than how they match. Several of
// them — the C and Dart function shapes especially — can only decide that a line is
// not a definition by trying every way of splitting it, which is quadratic in the
// line's length. At a few thousand characters that is nothing; at two million it is
// minutes of a pane that has stopped answering, and the answer at the end of it is
// that there was no declaration there. A repository under review is somebody else's
// work, so the length is theirs to choose.
const MAX_DEFINITION_LINE = 1000;

/** Whether a line is short enough to be worth matching patterns against. */
function couldDeclare(text) {
  return text.length <= MAX_DEFINITION_LINE;
}

/** The definition patterns for a language, empty when it has none. */
function patternsFor(language) {
  return DEFINITIONS[language] || NO_PATTERNS;
}

/**
 * A document's headings, in the shape the outline list is built from.
 *
 * The import filter the code path applies is not asked here. It answers for code,
 * where `# include` reaches for a file; in a document it is a section called
 * "include the header", and dropping it would leave a hole in the contents.
 */
function markdownOutline(lines, filePath) {
  return markdownHeadings(lines).map((heading) => ({
    path: filePath,
    line: heading.line,
    text: heading.text,
    name: heading.title,
  }));
}

/**
 * Every top-level definition in a file.
 *
 * The shape matches a search hit — path, line, text — so a list of these travels
 * through the same view, the same keys, and the same jump as a search result does.
 *
 * @param {Array<string>} lines The file, one entry per line
 * @param {string} language A language name from lib/syntax
 * @param {string} filePath Repository-relative path, carried on every entry
 * @returns {Array<{path: string, line: number, text: string, name: string}>}
 */
function buildOutline(lines, language, filePath) {
  if (language === MARKDOWN) {
    return markdownOutline(lines, filePath);
  }

  const patterns = patternsFor(language);
  if (patterns.length === 0) {
    return [];
  }

  const found = [];

  lines.forEach((line, index) => {
    if (!couldDeclare(line)) {
      return;
    }

    // A binding whose value is an import is an import. `const fs = require("fs")`
    // is a definition only in the narrowest sense, and a file that opens with ten
    // of them would have an outline made of nothing else. The imports list is where
    // those lines belong, and it already has them.
    if (looksLikeImport(line)) {
      return;
    }

    for (const pattern of patterns) {
      const match = pattern.exec(line);
      if (match) {
        found.push({ path: filePath, line: index + 1, text: line.trim(), name: match[1] });
        return; // One entry per line: the first pattern that fits wins
      }
    }
  });

  return found;
}

/**
 * The relative specifiers a file imports, deduplicated, in the order they appear.
 *
 * One line names one thing, and the first pattern that fits decides which — the same
 * rule the outline follows. A specifier already listed is simply not listed twice;
 * the line is still finished with, rather than handed to the next pattern to see what
 * else on it looks like a specifier. Doing that made a line mean different things
 * depending on what came before it, and attributed
 * `require("./a")  // import "./legacy" was here` to a path in a comment.
 *
 * @returns {Array<{path: string, line: number, text: string, name: string}>}
 */
function buildImports(lines, filePath) {
  const found = [];
  const seen = new Set();
  // A language's own shapes come first: `require("diffview.config")` is a Lua module
  // and not the bare package the common shape would refuse to name.
  const patterns = [
    ...(IMPORT_PATTERNS_BY_LANGUAGE[detectLanguage(filePath)] || []),
    ...IMPORT_PATTERNS,
  ];

  lines.forEach((line, index) => {
    for (const pattern of patterns) {
      const match = pattern.exec(line);
      if (match === null) {
        continue; // Not this pattern's shape; the next one may fit
      }

      if (!seen.has(match[1])) {
        seen.add(match[1]);
        found.push({ path: filePath, line: index + 1, text: line.trim(), name: match[1] });
      }
      return;
    }
  });

  return found;
}

/**
 * Whether this is a language the outline has patterns for.
 *
 * A file in one it does not — Lua, Swift, PHP, Kotlin — has an empty outline, and "no
 * definitions found" is a fact about the file that is not true of it. Which of the two
 * it is has to be said apart, because a reader told there is nothing here stops looking
 * and a reader told this language is not covered reaches for `/` instead.
 */
function hasOutline(language) {
  return language === MARKDOWN || patternsFor(language).length > 0;
}

/**
 * Whether a line looks like it imports something, whatever the language.
 * Used to keep a grep for a file's name down to the lines that actually reach for it.
 */
function looksLikeImport(text) {
  return IMPORT_LINE.test(text);
}

// What a name may not be surrounded by and still be a name of its own.
const IDENTIFIER_CHAR = /[\w$]/;

/**
 * Whether a line reaches for a module of this name, rather than merely spelling it.
 *
 * What reaches for a file is found by grepping the repository for the file's own name,
 * which is a substring search and finds the name wherever it happens to sit: `review`
 * is inside `withPreview` and inside `sheetPreview`, so three of the ten files said to
 * import `bin/review.js` were importing `./views` and saying nothing about it. A name
 * glued to identifier characters at either end is part of a longer word rather than the
 * module — and `./logger` is not `log`.
 *
 * Asked of the whole line rather than of the specifier, because the shapes the grep is
 * kept down to are more than the ones a specifier can be pulled out of: a C include and
 * a shell `source` name a file without quoting it the way a require does.
 *
 * @param {string} text One line, as grep reported it
 * @param {string} stem The file's name, without its extension
 */
function namesModule(text, stem) {
  for (let at = text.indexOf(stem); at !== -1; at = text.indexOf(stem, at + 1)) {
    const before = at === 0 ? "" : text[at - 1];
    const after = text[at + stem.length] || "";
    if (!IDENTIFIER_CHAR.test(before) && !IDENTIFIER_CHAR.test(after)) {
      return true;
    }
  }
  return false;
}

/**
 * Whether a line declares a particular name.
 *
 * The same patterns the outline is built from, asked a narrower question: a grep for
 * a name finds every line that mentions it, and this is what separates the one that
 * defines it from the hundred that call it.
 *
 * @param {string} text One line, as grep reported it
 * @param {string} name The identifier being looked for
 * @param {string} language A language name from lib/syntax
 */
function definesName(text, name, language) {
  // A grep hit is one line with no document around it, so the fences are unknowable
  // here. What a heading looks like is not, and a section named after one word is
  // where that word is declared in a document.
  if (language === MARKDOWN) {
    const heading = headingAt(text);
    return heading !== null && heading.title === name;
  }
  if (!couldDeclare(text) || looksLikeImport(text)) {
    return false;
  }

  for (const pattern of patternsFor(language)) {
    const match = pattern.exec(text);
    if (match && match[1] === name) {
      return true;
    }
  }
  return false;
}

/**
 * Whether one line on its own declares something, and what.
 *
 * buildOutline answers the same question of a whole file at once, which is what a
 * list of definitions needs. This answers it of one line, which is what walking up
 * from the cursor to find the thing it is inside needs — see lib/sticky.
 *
 * @returns {string|null} The name declared, or null
 */
function definitionOn(text, language) {
  if (typeof text !== "string" || !couldDeclare(text) || looksLikeImport(text)) {
    return null;
  }

  for (const pattern of patternsFor(language)) {
    const match = pattern.exec(text);
    if (match) {
      return match[1];
    }
  }

  return null;
}

module.exports = {
  MAX_DEFINITION_LINE,
  buildImports,
  buildOutline,
  definesName,
  definitionOn,
  hasOutline,
  looksLikeImport,
  namesModule,
};
