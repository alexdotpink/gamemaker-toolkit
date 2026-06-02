export interface TriviaComment {
  kind: "line" | "block";
  text: string;
  line: number;
  column: number;
  codeBeforeOnLine: string;
  normalizedText: string;
}

export interface TriviaString {
  quote: '"' | "'" | "`";
  text: string;
  line: number;
  column: number;
}

export interface TriviaComparison {
  ok: boolean;
  diagnostics: string[];
}

export function collectTriviaComments(source: string): TriviaComment[] {
  const comments: TriviaComment[] = [];
  let line = 1;
  let column = 1;
  let lineStart = 0;
  let quote: TriviaString["quote"] | undefined;
  let escaped = false;

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];
    if (char === "\n") {
      line += 1;
      column = 1;
      lineStart = index + 1;
      escaped = false;
      continue;
    }
    if (quote) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) quote = undefined;
      column += 1;
      continue;
    }
    if (char === '"' || char === "'" || char === "`") {
      quote = char;
      column += 1;
      continue;
    }
    if (char === "/" && next === "/") {
      const end = source.indexOf("\n", index + 2);
      const stop = end === -1 ? source.length : end;
      const text = source.slice(index, stop);
      comments.push({
        kind: "line",
        text,
        line,
        column,
        codeBeforeOnLine: source.slice(lineStart, index).trim(),
        normalizedText: normalizeTriviaComment(text),
      });
      column += stop - index;
      index = stop - 1;
      continue;
    }
    if (char === "/" && next === "*") {
      const end = source.indexOf("*/", index + 2);
      const stop = end === -1 ? source.length : end + 2;
      const text = source.slice(index, stop);
      comments.push({
        kind: "block",
        text,
        line,
        column,
        codeBeforeOnLine: source.slice(lineStart, index).trim(),
        normalizedText: normalizeTriviaComment(text),
      });
      const lineBreaks = text.match(/\n/g)?.length ?? 0;
      if (lineBreaks > 0) {
        line += lineBreaks;
        lineStart = source.lastIndexOf("\n", stop - 1) + 1;
        column = stop - lineStart + 1;
      } else {
        column += stop - index;
      }
      index = stop - 1;
      continue;
    }
    column += 1;
  }

  return comments;
}

export function collectTriviaStrings(source: string): TriviaString[] {
  const strings: TriviaString[] = [];
  let line = 1;
  let column = 1;
  let quote: TriviaString["quote"] | undefined;
  let start = 0;
  let startLine = 1;
  let startColumn = 1;
  let escaped = false;

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];
    if (char === "\n") {
      line += 1;
      column = 1;
      escaped = false;
      continue;
    }
    if (quote) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) {
        strings.push({
          quote,
          text: source.slice(start, index + 1),
          line: startLine,
          column: startColumn,
        });
        quote = undefined;
      }
      column += 1;
      continue;
    }
    if (char === "/" && next === "/") {
      const end = source.indexOf("\n", index + 2);
      const stop = end === -1 ? source.length : end;
      column += stop - index;
      index = stop - 1;
      continue;
    }
    if (char === "/" && next === "*") {
      const end = source.indexOf("*/", index + 2);
      const stop = end === -1 ? source.length : end + 2;
      const text = source.slice(index, stop);
      const lineBreaks = text.match(/\n/g)?.length ?? 0;
      if (lineBreaks > 0) {
        line += lineBreaks;
        column = stop - source.lastIndexOf("\n", stop - 1);
      } else {
        column += stop - index;
      }
      index = stop - 1;
      continue;
    }
    if (char === '"' || char === "'" || char === "`") {
      quote = char;
      start = index;
      startLine = line;
      startColumn = column;
    }
    column += 1;
  }

  return strings;
}

export function compareTrivia(
  original: string,
  formatted: string,
  strictAnchors = false,
): TriviaComparison {
  const diagnostics: string[] = [];
  const originalComments = collectTriviaComments(original);
  const formattedComments = collectTriviaComments(formatted);
  const originalStrings = collectTriviaStrings(original);
  const formattedStrings = collectTriviaStrings(formatted);
  compareOrderedValues(
    diagnostics,
    "comment",
    originalComments.map((comment) => comment.normalizedText),
    formattedComments.map((comment) => comment.normalizedText),
  );
  compareOrderedValues(
    diagnostics,
    "string literal",
    originalStrings.map((string) => string.text),
    formattedStrings.map((string) => string.text),
  );
  if (strictAnchors) {
    compareOrderedValues(
      diagnostics,
      "comment anchor",
      originalComments.map((comment) => (comment.codeBeforeOnLine ? "trailing" : "standalone")),
      formattedComments.map((comment) => (comment.codeBeforeOnLine ? "trailing" : "standalone")),
    );
  }
  return { ok: diagnostics.length === 0, diagnostics };
}

export function normalizeTriviaComment(text: string): string {
  if (text.startsWith("//")) return text.replace(/^\/\/\s*/, "// ").trimEnd();
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .join("\n")
    .trim();
}

function compareOrderedValues(
  diagnostics: string[],
  label: string,
  left: string[],
  right: string[],
): void {
  if (left.length !== right.length) {
    diagnostics.push(`${label} count changed: ${left.length} -> ${right.length}`);
  }
  const max = Math.max(left.length, right.length);
  for (let index = 0; index < max; index += 1) {
    if (left[index] === right[index]) continue;
    diagnostics.push(
      `${label} mismatch at ${index + 1}: ${left[index] ?? "<missing>"} -> ${right[index] ?? "<missing>"}`,
    );
    break;
  }
}
