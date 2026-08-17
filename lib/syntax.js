"use strict";

// A small lexer for reading code, not for compiling it.
//
// Real highlighters carry a grammar per language; with no dependencies allowed this
// recognises the four things that actually help when reading — comments, strings,
// numbers, and keywords — and leaves everything else plain. It is heuristic by
// design and will mislabel exotic syntax.
//
// Block comments span lines, so tokenizing is done over a whole file at once and the
// "inside a block comment" flag is carried forward.
//
// Markdown is not a language this lexer can read — a README has no keywords and every
// apostrophe in it would open a string — so it is handed to ./markdown, which reads
// the shape of a line instead of the syntax in it.

const { tokenizeMarkdown } = require("./markdown");

// Everything JavaScript is written in, which TypeScript is written in too
const JAVASCRIPT_KEYWORDS = [
  "async", "await", "break", "case", "catch", "class", "const", "continue",
  "default", "delete", "do", "else", "export", "extends", "finally", "for",
  "from", "function", "get", "if", "import", "in", "instanceof", "let", "new",
  "of", "return", "set", "static", "super", "switch", "this", "throw", "try",
  "typeof", "var", "void", "while", "yield", "true", "false", "null", "undefined",
];

// What C and C++ share. The C++ list adds to it rather than repeating it.
const C_KEYWORDS = [
  "auto", "break", "case", "char", "const", "continue", "default", "do", "double",
  "else", "enum", "extern", "float", "for", "goto", "if", "inline", "int", "long",
  "register", "restrict", "return", "short", "signed", "sizeof", "static", "struct",
  "switch", "typedef", "union", "unsigned", "void", "volatile", "while",
];

const KEYWORDS = {
  javascript: JAVASCRIPT_KEYWORDS,
  // The type-level half of the language, which is most of what a TypeScript file
  // says that a JavaScript one does not
  typescript: [
    ...JAVASCRIPT_KEYWORDS,
    "abstract", "any", "as", "asserts", "boolean", "declare", "enum", "implements",
    "infer", "interface", "is", "keyof", "namespace", "never", "number", "object",
    "private", "protected", "public", "readonly", "require", "satisfies", "string",
    "symbol", "type", "unique", "unknown",
  ],
  c: C_KEYWORDS,
  cpp: [
    ...C_KEYWORDS,
    "bool", "catch", "class", "constexpr", "delete", "explicit", "friend", "mutable",
    "namespace", "new", "noexcept", "nullptr", "operator", "override", "private",
    "protected", "public", "template", "this", "throw", "true", "false", "try",
    "typename", "using", "virtual",
  ],
  java: [
    "abstract", "assert", "boolean", "break", "byte", "case", "catch", "char",
    "class", "const", "continue", "default", "do", "double", "else", "enum",
    "extends", "final", "finally", "float", "for", "if", "implements", "import",
    "instanceof", "int", "interface", "long", "native", "new", "package", "private",
    "protected", "public", "record", "return", "sealed", "short", "static",
    "strictfp", "super", "switch", "synchronized", "this", "throw", "throws",
    "transient", "try", "var", "void", "volatile", "while", "yield",
    "true", "false", "null",
  ],
  ruby: [
    "alias", "and", "begin", "break", "case", "class", "def", "defined?", "do",
    "else", "elsif", "end", "ensure", "for", "if", "in", "module", "next", "nil",
    "not", "or", "redo", "require", "require_relative", "rescue", "retry", "return",
    "self", "super", "then", "undef", "unless", "until", "when", "while", "yield",
    "true", "false",
  ],
  dart: [
    "abstract", "as", "assert", "async", "await", "base", "break", "case", "catch",
    "class", "const", "continue", "covariant", "default", "deferred", "do", "dynamic",
    "else", "enum", "export", "extends", "extension", "external", "factory", "final",
    "finally", "for", "get", "hide", "if", "implements", "import", "in", "interface",
    "is", "late", "library", "mixin", "new", "on", "operator", "part", "required",
    "rethrow", "return", "sealed", "set", "show", "static", "super", "switch", "sync",
    "this", "throw", "typedef", "var", "void", "when", "while", "with", "yield",
    "true", "false", "null",
  ],
  python: [
    "and", "as", "assert", "async", "await", "break", "class", "continue", "def",
    "del", "elif", "else", "except", "finally", "for", "from", "global", "if",
    "import", "in", "is", "lambda", "none", "nonlocal", "not", "or", "pass",
    "raise", "return", "try", "while", "with", "yield", "True", "False", "None",
  ],
  rust: [
    "as", "async", "await", "break", "const", "continue", "crate", "dyn", "else",
    "enum", "extern", "fn", "for", "if", "impl", "in", "let", "loop", "match",
    "mod", "move", "mut", "pub", "ref", "return", "self", "static", "struct",
    "super", "trait", "type", "unsafe", "use", "where", "while", "true", "false",
  ],
  go: [
    "break", "case", "chan", "const", "continue", "default", "defer", "else",
    "fallthrough", "for", "func", "go", "goto", "if", "import", "interface",
    "map", "package", "range", "return", "select", "struct", "switch", "type",
    "var", "true", "false", "nil",
  ],
  shell: [
    "case", "do", "done", "elif", "else", "esac", "fi", "for", "function", "if",
    "in", "return", "then", "until", "while", "local", "export", "readonly",
  ],
  lua: [
    "and", "break", "do", "else", "elseif", "end", "for", "function", "goto", "if",
    "in", "local", "nil", "not", "or", "repeat", "return", "then", "until", "while",
    "true", "false",
  ],
  swift: [
    "actor", "any", "as", "associatedtype", "async", "await", "break", "case",
    "catch", "class", "continue", "convenience", "default", "defer", "deinit",
    "do", "else", "enum", "extension", "fallthrough", "fileprivate", "final", "for",
    "func", "guard", "if", "import", "in", "indirect", "init", "inout", "internal",
    "is", "lazy", "let", "mutating", "nil", "open", "operator", "override",
    "private", "protocol", "public", "repeat", "required", "rethrows", "return",
    "self", "some", "static", "struct", "subscript", "super", "switch", "throw",
    "throws", "try", "typealias", "var", "weak", "where", "while", "true", "false",
  ],
  kotlin: [
    "abstract", "actual", "annotation", "as", "break", "by", "catch", "class",
    "companion", "const", "constructor", "continue", "crossinline", "data", "do",
    "else", "enum", "expect", "external", "false", "final", "finally", "for", "fun",
    "get", "if", "import", "in", "infix", "init", "inline", "inner", "interface",
    "internal", "is", "lateinit", "noinline", "null", "object", "open", "operator",
    "out", "override", "package", "private", "protected", "public", "reified",
    "return", "sealed", "set", "super", "suspend", "tailrec", "this", "throw",
    "true", "try", "typealias", "val", "value", "var", "vararg", "when", "where",
    "while",
  ],
  php: [
    "abstract", "and", "array", "as", "break", "callable", "case", "catch", "class",
    "clone", "const", "continue", "declare", "default", "do", "echo", "else",
    "elseif", "empty", "enum", "extends", "final", "finally", "fn", "for", "foreach",
    "function", "global", "if", "implements", "include", "include_once", "instanceof",
    "insteadof", "interface", "isset", "list", "match", "namespace", "new", "or",
    "print", "private", "protected", "public", "readonly", "require", "require_once",
    "return", "static", "switch", "throw", "trait", "try", "unset", "use", "var",
    "while", "yield", "true", "false", "null",
  ],
  csharp: [
    "abstract", "as", "async", "await", "base", "bool", "break", "byte", "case",
    "catch", "char", "checked", "class", "const", "continue", "decimal", "default",
    "delegate", "do", "double", "else", "enum", "event", "explicit", "extern",
    "finally", "fixed", "float", "for", "foreach", "goto", "if", "implicit", "in",
    "int", "interface", "internal", "is", "lock", "long", "namespace", "new",
    "object", "operator", "out", "override", "params", "partial", "private",
    "protected", "public", "readonly", "record", "ref", "return", "sealed", "short",
    "sizeof", "stackalloc", "static", "string", "struct", "switch", "this", "throw",
    "try", "typeof", "uint", "ulong", "unchecked", "unsafe", "ushort", "using",
    "var", "virtual", "void", "volatile", "while", "yield", "true", "false", "null",
  ],
  // SQL shouts, and a reader writing it in either case means the same word. The
  // lexer matches keywords exactly, so both spellings are listed rather than the
  // matcher being taught a second rule for one language.
  sql: [
    "select", "from", "where", "join", "left", "right", "inner", "outer", "on",
    "group", "order", "by", "having", "limit", "offset", "insert", "into", "values",
    "update", "set", "delete", "create", "alter", "drop", "table", "view", "index",
    "unique", "primary", "key", "foreign", "references", "not", "null", "default",
    "and", "or", "as", "distinct", "case", "when", "then", "else", "end", "union",
    "all", "exists", "in", "between", "like", "is", "with", "returning",
    "SELECT", "FROM", "WHERE", "JOIN", "LEFT", "RIGHT", "INNER", "OUTER", "ON",
    "GROUP", "ORDER", "BY", "HAVING", "LIMIT", "OFFSET", "INSERT", "INTO", "VALUES",
    "UPDATE", "SET", "DELETE", "CREATE", "ALTER", "DROP", "TABLE", "VIEW", "INDEX",
    "UNIQUE", "PRIMARY", "KEY", "FOREIGN", "REFERENCES", "NOT", "NULL", "DEFAULT",
    "AND", "OR", "AS", "DISTINCT", "CASE", "WHEN", "THEN", "ELSE", "END", "UNION",
    "ALL", "EXISTS", "IN", "BETWEEN", "LIKE", "IS", "WITH", "RETURNING",
  ],
  // A tag name is not a keyword, and colouring one would colour half the document.
  // What a page says that is worth picking out is in its strings and its comments.
  html: [],
  css: [
    "and", "from", "important", "not", "only", "to",
  ],
  // A single-file component is a template, a script and a style block in one file,
  // and a line-at-a-time lexer cannot change language halfway down. The script is
  // where the reading happens, so it is read as JavaScript throughout — which leaves
  // the template's `<!-- -->` uncoloured and everything in the script right.
  vue: JAVASCRIPT_KEYWORDS,
  toml: ["true", "false"],
  yaml: ["true", "false", "null", "yes", "no"],
  json: ["true", "false", "null"],
};

// Per language: how a comment starts, and which quotes open a string
const SYNTAX = {
  javascript: { line: "//", block: ["/*", "*/"], quotes: `"'\`` },
  typescript: { line: "//", block: ["/*", "*/"], quotes: `"'\`` },
  dart: { line: "//", block: ["/*", "*/"], quotes: `"'` },
  c: { line: "//", block: ["/*", "*/"], quotes: `"'` },
  cpp: { line: "//", block: ["/*", "*/"], quotes: `"'` },
  java: { line: "//", block: ["/*", "*/"], quotes: `"'` },
  // Ruby comments the way Python does. A heredoc or a %w() literal is beyond a
  // line-at-a-time lexer, and mislabelling one is the price of not carrying a grammar.
  ruby: { line: "#", block: null, quotes: `"'` },
  // What a file whose language nothing here knows is read as. Comments written
  // //like this, strings in quotes and plain numbers are what most of them share,
  // and recognising those beats leaving a whole file one colour — which is what a
  // Dart file looked like before Dart was on the list above.
  generic: { line: "//", block: ["/*", "*/"], quotes: `"'\`` },
  python: { line: "#", block: null, quotes: `"'` },
  rust: { line: "//", block: ["/*", "*/"], quotes: `"` },
  go: { line: "//", block: ["/*", "*/"], quotes: `"\`` },
  shell: { line: "#", block: null, quotes: `"'` },
  lua: { line: "--", block: ["--[[", "]]"], quotes: `"'` },
  swift: { line: "//", block: ["/*", "*/"], quotes: `"` },
  kotlin: { line: "//", block: ["/*", "*/"], quotes: `"'` },
  // PHP writes a line comment `//` or `#`, and one marker is all a line-at-a-time
  // lexer carries. `//` is what nearly every PHP file uses.
  php: { line: "//", block: ["/*", "*/"], quotes: `"'` },
  csharp: { line: "//", block: ["/*", "*/"], quotes: `"'` },
  sql: { line: "--", block: ["/*", "*/"], quotes: `'"` },
  html: { line: null, block: ["<!--", "-->"], quotes: `"'` },
  // `//` is not CSS and is Sass and Less, which share this entry. Plain CSS never
  // writes one, so recognising it costs nothing and saves the other two.
  css: { line: "//", block: ["/*", "*/"], quotes: `"'` },
  vue: { line: "//", block: ["/*", "*/"], quotes: `"'\`` },
  toml: { line: "#", block: null, quotes: `"'` },
  yaml: { line: "#", block: null, quotes: `"'` },
  json: { line: null, block: null, quotes: `"` },
  // Markdown has no entry: it never reaches this lexer — see ./markdown
  plain: { line: null, block: null, quotes: "" },
};

// Extensions whose files are prose rather than code. They keep the plain reading
// they have always had: a quotation mark in a sentence is not a string.
const PROSE_EXTENSIONS = new Set(["txt", "text", "log", "csv", "tsv"]);

const GENERIC = "generic";
const PLAIN = "plain";
const MARKDOWN = "markdown";

const EXTENSIONS = {
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  ts: "typescript",
  tsx: "typescript",
  mts: "typescript",
  cts: "typescript",
  dart: "dart",
  // A header could be either language. It is read as C because `new`, `class` and
  // `delete` are ordinary identifiers there — `node *new = malloc(...)` is everyday
  // C — and colouring those as keywords misleads more often than the handful of C++
  // keywords a header goes without. The outline does not make the same trade: see
  // lib/outline.js, where C is offered the C++ patterns too.
  c: "c",
  h: "c",
  cc: "cpp",
  cpp: "cpp",
  cxx: "cpp",
  hpp: "cpp",
  hh: "cpp",
  hxx: "cpp",
  java: "java",
  rb: "ruby",
  rake: "ruby",
  py: "python",
  rs: "rust",
  go: "go",
  sh: "shell",
  bash: "shell",
  zsh: "shell",
  lua: "lua",
  swift: "swift",
  kt: "kotlin",
  kts: "kotlin",
  php: "php",
  cs: "csharp",
  sql: "sql",
  html: "html",
  htm: "html",
  css: "css",
  scss: "css",
  sass: "css",
  less: "css",
  vue: "vue",
  toml: "toml",
  yaml: "yaml",
  yml: "yaml",
  json: "json",
  md: "markdown",
  markdown: "markdown",
};

const IDENTIFIER_START = /[A-Za-z_$]/;
const IDENTIFIER_PART = /[A-Za-z0-9_$]/;
const DIGIT = /[0-9]/;

/**
 * The language of a path.
 *
 * A file with no extension is read as prose, and so are the few extensions that name
 * it. Everything else is code of some kind: an extension nobody here has heard of
 * still gets the comments, strings and numbers that nearly every language writes the
 * same way, rather than being shown in one colour from top to bottom.
 */
function detectLanguage(filePath) {
  const name = filePath.split("/").pop() || "";
  const dot = name.lastIndexOf(".");
  if (dot <= 0) {
    return PLAIN;
  }

  const extension = name.slice(dot + 1).toLowerCase();
  if (EXTENSIONS[extension]) {
    return EXTENSIONS[extension];
  }
  return PROSE_EXTENSIONS.has(extension) ? PLAIN : GENERIC;
}

// Built once at load: rebuilding these on every tokenize would re-allocate up to
// forty strings per previewed file.
const KEYWORD_SETS = Object.fromEntries(
  Object.entries(KEYWORDS).map(([language, words]) => [language, new Set(words)])
);
const NO_KEYWORDS = new Set();

function keywordsFor(language) {
  return KEYWORD_SETS[language] || NO_KEYWORDS;
}

/** Append text to the token list, merging into the previous token of the same type. */
function push(tokens, text, type) {
  if (text === "") {
    return;
  }
  const last = tokens[tokens.length - 1];
  if (last && last.type === type) {
    last.text += text;
    return;
  }
  tokens.push({ text, type });
}

/** Consume a string literal, honouring backslash escapes. Returns the end index. */
function scanString(line, start) {
  const quote = line[start];
  let index = start + 1;

  while (index < line.length) {
    if (line[index] === "\\") {
      index += 2;
      continue;
    }
    if (line[index] === quote) {
      return index + 1;
    }
    index += 1;
  }

  return line.length;
}

function scanNumber(line, start) {
  let index = start;
  while (index < line.length && /[0-9a-fA-FxXoObB._]/.test(line[index])) {
    index += 1;
  }
  return index;
}

function scanIdentifier(line, start) {
  let index = start;
  while (index < line.length && IDENTIFIER_PART.test(line[index])) {
    index += 1;
  }
  return index;
}

/** Consume the remainder of an open block comment. */
function continueBlockComment(line, tokens, close) {
  const end = line.indexOf(close);
  if (end === -1) {
    push(tokens, line, "comment");
    return { index: line.length, inBlock: true };
  }
  push(tokens, line.slice(0, end + close.length), "comment");
  return { index: end + close.length, inBlock: false };
}

/**
 * Read the one token that starts at an index.
 * @returns {{text: string, type: string, opensBlock: boolean}}
 */
function scanToken(line, index, syntax, keywords) {
  const rest = line.slice(index);

  if (syntax.block && rest.startsWith(syntax.block[0])) {
    const [open, close] = syntax.block;
    const end = line.indexOf(close, index + open.length);

    if (end === -1) {
      return { text: rest, type: "comment", opensBlock: true };
    }
    return { text: line.slice(index, end + close.length), type: "comment", opensBlock: false };
  }

  if (syntax.line && rest.startsWith(syntax.line)) {
    return { text: rest, type: "comment", opensBlock: false };
  }

  const char = line[index];

  if (syntax.quotes.includes(char)) {
    return { text: line.slice(index, scanString(line, index)), type: "string", opensBlock: false };
  }
  if (DIGIT.test(char)) {
    return { text: line.slice(index, scanNumber(line, index)), type: "number", opensBlock: false };
  }
  if (IDENTIFIER_START.test(char)) {
    const word = line.slice(index, scanIdentifier(line, index));
    return { text: word, type: keywords.has(word) ? "keyword" : "plain", opensBlock: false };
  }

  return { text: char, type: "plain", opensBlock: false };
}

/**
 * Tokenize one line, given whether a block comment is already open.
 * @returns {{tokens: Array<{text: string, type: string}>, inBlock: boolean}}
 */
function tokenizeLine(line, syntax, keywords, startsInBlock) {
  const tokens = [];
  let index = 0;
  let inBlock = startsInBlock;

  if (inBlock && syntax.block) {
    const resumed = continueBlockComment(line, tokens, syntax.block[1]);
    index = resumed.index;
    inBlock = resumed.inBlock;
  }

  while (index < line.length) {
    const token = scanToken(line, index, syntax, keywords);
    push(tokens, token.text, token.type);
    index += token.text.length;
    inBlock = token.opensBlock;
  }

  return { tokens, inBlock };
}

/**
 * Tokenize a whole file, carrying block comment state between lines.
 * @param {Array<string>} lines
 * @param {string} language
 * @returns {Array<Array<{text: string, type: string}>>} One token list per line
 */
function tokenizeLines(lines, language) {
  if (language === MARKDOWN) {
    return tokenizeMarkdown(lines);
  }

  const syntax = SYNTAX[language] || SYNTAX.plain;
  const keywords = keywordsFor(language);

  if (language === PLAIN) {
    return lines.map((line) => (line === "" ? [] : [{ text: line, type: "plain" }]));
  }

  const rows = [];
  let inBlock = false;

  for (const line of lines) {
    const result = tokenizeLine(line, syntax, keywords, inBlock);
    rows.push(result.tokens);
    inBlock = result.inBlock;
  }

  return rows;
}

module.exports = { MARKDOWN, detectLanguage, tokenizeLines };
