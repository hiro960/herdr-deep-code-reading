"use strict";

// Highlighting for markdown, which is structure rather than syntax.
//
// The code lexer next door looks for comments, strings, numbers and keywords. A
// README has none of those: run that over prose and every apostrophe opens a string,
// which is why markdown was left one colour instead. What helps someone reading a
// document in a pane is seeing where a heading, a code block, a link or a list is —
// so this reads the shape of the line and leaves the words themselves alone.
//
// Heuristic by design, like its neighbour. It knows the constructs a technical
// document actually uses, in the forms they are usually written in, and anything it
// is unsure of stays plain — a marker that never closes is text, not a mistake.

// The palette has four token colours. These are what markdown spends them on: code
// reads as a literal, structural punctuation as an aside, and a list marker as the
// one accent a line of prose gets. The heading is the only type of its own, because
// it is the one thing worth making bold.
const TYPE_HEADING = "heading";
const TYPE_CODE = "string";
const TYPE_DIM = "comment";
const TYPE_MARKER = "number";
const TYPE_PLAIN = "plain";

// The hashes, then the words, then the hashes some documents close a heading with
const HEADING = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?[ \t]*$/;
const CLOSING_HASHES = /[ \t]+#+$/;
const HORIZONTAL_RULE = /^ {0,3}([-*_])[ ]*(\1[ ]*){2,}$/;
const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const FENCE_CLOSE = /^ {0,3}(`{3,}|~{3,})[ ]*$/;
const QUOTE = /^ {0,3}(?:> ?)+/;
const BULLET = /^( *)([-*+]|\d{1,9}[.)])( +)/;
const TABLE_ROW = /^ {0,3}\|/;
const TABLE_RULE = /^ {0,3}\|[-:| ]+\|?[ ]*$/;

// Only the asterisk marks emphasis. An underscore is a letter in half the names a
// technical document mentions, and dimming the middle of some_long_name would be
// worse than not marking emphasis at all.
const EMPHASIS = "*";
const MAX_EMPHASIS_RUN = 3;

/**
 * The heading a line is, or null when it is not one.
 *
 * One reading of what a heading looks like, for the two things that ask: the
 * highlighter, which colours the line, and the outline, which lists it. A hash with
 * no space after it starts a #hashtag rather than a heading, and a seventh hash is
 * past every level markdown has.
 *
 * @returns {{level: number, title: string}|null}
 */
function headingAt(line) {
  const match = HEADING.exec(line);
  if (match === null) {
    return null;
  }
  const words = match[2] === undefined ? "" : match[2];
  return { level: match[1].length, title: words.replace(CLOSING_HASHES, "") };
}

/** Collect tokens, merging a run of the same type and dropping empty text. */
function collector() {
  const tokens = [];

  function push(text, type) {
    if (text === "") {
      return;
    }
    const last = tokens[tokens.length - 1];
    if (last !== undefined && last.type === type) {
      last.text += text;
      return;
    }
    tokens.push({ text, type });
  }

  return { push, tokens };
}

/** A whole line as one token, or no tokens at all when the line is empty. */
function wholeLine(line, type) {
  return line === "" ? [] : [{ text: line, type }];
}

/** How many times the character at an index repeats. */
function runLength(text, index) {
  const char = text[index];
  let end = index;
  while (end < text.length && text[end] === char) {
    end += 1;
  }
  return end - index;
}

/**
 * A code span: text between two runs of the same number of backticks.
 * @returns {Array<object>|null} null when the span never closes on this line
 */
function codeSpanAt(text, index) {
  const open = runLength(text, index);
  let at = index + open;

  while (at < text.length) {
    if (text[at] !== "`") {
      at += 1;
      continue;
    }
    const close = runLength(text, at);
    if (close === open) {
      return [{ text: text.slice(index, at + close), type: TYPE_CODE }];
    }
    at += close;
  }

  return null;
}

/**
 * A link or an image.
 *
 * The words are what the reader is reading; the brackets and the target are how the
 * document says where they point, and are dimmed so the sentence still reads as one.
 *
 * @returns {Array<object>|null} null when the line holds no whole one
 */
function linkAt(text, index) {
  const opens = text.startsWith("![", index) ? 2 : 1;
  const label = text.indexOf("]", index + opens);

  if (label === -1 || text[label + 1] !== "(") {
    return null;
  }
  const close = text.indexOf(")", label + 2);
  if (close === -1) {
    return null;
  }

  return [
    { text: text.slice(index, index + opens), type: TYPE_DIM },
    { text: text.slice(index + opens, label), type: TYPE_PLAIN },
    { text: text.slice(label, close + 1), type: TYPE_DIM },
  ];
}

/**
 * Emphasis, as the markers around the words rather than the words themselves.
 * A terminal cell has no bold-and-coloured to spare here, so the useful half is
 * dimming the punctuation until the emphasised words are what stands out.
 * @returns {Array<object>|null} null when the run never closes on this line
 */
function emphasisAt(text, index) {
  const open = Math.min(runLength(text, index), MAX_EMPHASIS_RUN);
  const from = index + open;
  const close = text.indexOf(EMPHASIS.repeat(open), from);

  if (close === -1 || close === from) {
    return null;
  }

  return [
    { text: text.slice(index, from), type: TYPE_DIM },
    { text: text.slice(from, close), type: TYPE_PLAIN },
    { text: text.slice(close, close + open), type: TYPE_DIM },
  ];
}

/**
 * The marked-up construct starting at an index, if one does.
 * @returns {Array<object>|null} Its tokens, in order, or null for ordinary prose
 */
function markedAt(text, index, inTable) {
  const char = text[index];

  if (char === "`") {
    return codeSpanAt(text, index);
  }
  if (char === "[" || (char === "!" && text[index + 1] === "[")) {
    return linkAt(text, index);
  }
  if (char === EMPHASIS) {
    return emphasisAt(text, index);
  }
  // Only where the line is a table row: a pipe in a sentence is a pipe
  if (char === "|" && inTable) {
    return [{ text: char, type: TYPE_DIM }];
  }
  return null;
}

/** Walk a run of text, marking the constructs in it and leaving the rest prose. */
function scanInline(text, push, inTable) {
  let index = 0;
  let prose = 0;

  while (index < text.length) {
    const pieces = markedAt(text, index, inTable);
    if (pieces === null) {
      index += 1;
      continue;
    }

    push(text.slice(prose, index), TYPE_PLAIN);
    for (const piece of pieces) {
      push(piece.text, piece.type);
      index += piece.text.length;
    }
    prose = index;
  }

  push(text.slice(prose), TYPE_PLAIN);
}

/** A line of prose: what it opens with, then whatever is marked up inside it. */
function bodyTokens(line) {
  const collected = collector();
  let rest = line;

  const quoted = QUOTE.exec(rest);
  if (quoted !== null) {
    collected.push(quoted[0], TYPE_DIM);
    rest = rest.slice(quoted[0].length);
  }

  const bullet = BULLET.exec(rest);
  if (bullet !== null) {
    collected.push(bullet[1], TYPE_PLAIN);
    collected.push(bullet[2], TYPE_MARKER);
    collected.push(bullet[3], TYPE_PLAIN);
    rest = rest.slice(bullet[0].length);
  }

  scanInline(rest, collected.push, TABLE_ROW.test(line));
  return collected.tokens;
}

/** Whether a line closes the fence that is open: same marker, and at least as long. */
function closesFence(line, fence) {
  const closing = FENCE_CLOSE.exec(line);
  return closing !== null && closing[1][0] === fence[0] && closing[1].length >= fence.length;
}

/**
 * Tokenize one line, given the fence it is inside.
 * @param {string|null} fence The marker that opened the block, or null
 * @returns {{tokens: Array<object>, fence: string|null}}
 */
function tokenizeLine(line, fence) {
  if (fence !== null) {
    return closesFence(line, fence)
      ? { tokens: wholeLine(line, TYPE_DIM), fence: null }
      : { tokens: wholeLine(line, TYPE_CODE), fence };
  }

  const opened = FENCE.exec(line);
  if (opened !== null) {
    return { tokens: wholeLine(line, TYPE_DIM), fence: opened[1] };
  }
  if (headingAt(line) !== null) {
    return { tokens: wholeLine(line, TYPE_HEADING), fence: null };
  }
  if (HORIZONTAL_RULE.test(line) || TABLE_RULE.test(line)) {
    return { tokens: wholeLine(line, TYPE_DIM), fence: null };
  }

  return { tokens: bodyTokens(line), fence: null };
}

/**
 * Tokenize a markdown file, carrying an open code fence between its lines.
 *
 * A fence is the one construct that spans lines — the same reason the code lexer
 * carries a block comment — and everything inside one is code however it is written,
 * headings and bullets included.
 *
 * @param {Array<string>} lines
 * @returns {Array<Array<{text: string, type: string}>>} One token list per line
 */
function tokenizeMarkdown(lines) {
  const rows = [];
  let fence = null;

  for (const line of lines) {
    const result = tokenizeLine(line, fence);
    rows.push(result.tokens);
    fence = result.fence;
  }

  return rows;
}

/**
 * Every heading of a document, in the order they appear.
 *
 * A table of contents, which is what a document has instead of definitions. It walks
 * the fences the same way the highlighter does, and for the same reason: a `#` at the
 * start of a line inside a shell or TOML block is that language's comment, and a
 * heading shown inside an example belongs to the example. Reading each line on its
 * own is what put this repository's own `# ~/.config/herdr/config.toml` in its
 * outline.
 *
 * Only the hash form is read. A heading underlined with `===` is rarer in a technical
 * document than the `---` that means a rule, a table, or the end of front matter, and
 * guessing between them would cost more than it found.
 *
 * @param {Array<string>} lines The document, one entry per line
 * @returns {Array<{line: number, level: number, title: string, text: string}>}
 */
function markdownHeadings(lines) {
  const headings = [];
  let fence = null;

  lines.forEach((line, index) => {
    if (fence !== null) {
      if (closesFence(line, fence)) {
        fence = null;
      }
      return;
    }

    const opened = FENCE.exec(line);
    if (opened !== null) {
      fence = opened[1];
      return;
    }

    const heading = headingAt(line);
    if (heading !== null) {
      headings.push({
        line: index + 1,
        level: heading.level,
        title: heading.title,
        // The line itself, so the list shows the hashes: how deep a heading sits is
        // what turns a list of them into a way through the document
        text: line.trim(),
      });
    }
  });

  return headings;
}

module.exports = { headingAt, markdownHeadings, tokenizeMarkdown };
