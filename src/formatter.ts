import { pathToFileURL } from "node:url";
import * as path from "node:path";
import { group, hardLine, indentDoc, joinDoc, renderDoc } from "./doc";
import {
  buildFormatterGmlAst,
  compareFormatterGmlAsts,
  normalizeGmlAst,
  summarizeFormatterGmlAst,
  summarizeGmlAst,
  type FormatterGmlAst,
} from "./ast";
import { collectTriviaComments, compareTrivia } from "./trivia";

export interface GmlFormatOptions {
  indentSize?: number;
  useTabs?: boolean;
  printWidth?: number;
  trailingCommas?: boolean;
  multilineFunctionCalls?: "auto" | "always" | "never";
  style?: "opinionated" | "minimal" | "preserve" | "gameMakerStudio";
  safety?: "ast-equivalence" | "ast-and-trivia" | "trivia-strict" | "parse-only" | "off";
  mode?: "file" | "snippet" | "expression" | "macro";
  trimTrailingWhitespace?: boolean;
  maxBlankLines?: number;
  readableSpacing?: boolean;
}

export interface GmlFormatResult {
  formatted: string;
  changed: boolean;
  parserErrors: string[];
  parserDiagnostics: GmlParseDiagnostic[];
  safetyErrors: string[];
  safetyDiagnostics: string[];
  formatterAst?: FormatterGmlAst;
}

export interface GmlFormatterDebugInfo {
  parserErrors: string[];
  parserDiagnostics: GmlParseDiagnostic[];
  tokenCount: number;
  rootNode: string;
  topLevelStatements: number;
  normalizedAstSummary: string[];
  comments: CommentTrivia[];
  commentAttachments: CommentAttachment[];
  semanticSignature: string[];
  formatterAstSummary: string[];
}

export interface GmlParseDiagnostic {
  message: string;
  line: number;
  column: number;
}

export interface CommentTrivia {
  kind: "line" | "block";
  startOffset: number;
  endOffset: number;
  startLine: number;
  endLine: number;
  text: string;
}

export interface CommentAttachment {
  kind: CommentTrivia["kind"];
  attachment: "leading" | "trailing" | "dangling";
  line: number;
  text: string;
}

export interface GmlToken {
  image: string;
  tokenType: {
    name: string;
  };
  startOffset: number;
  endOffset: number;
  startLine: number;
  endLine: number;
  startColumn: number;
  endColumn: number;
}

interface GmlLocation {
  startOffset: number;
  endOffset: number;
  startLine: number;
  endLine: number;
  startColumn: number;
  endColumn: number;
}

interface GmlCstNode {
  name: string;
  location?: Partial<GmlLocation>;
  children: Record<string, Array<GmlCstNode | GmlToken>>;
}

export interface ParsedGml {
  lexed: {
    tokens: GmlToken[];
    errors?: unknown[];
  };
  cst: GmlCstNode;
  errors: unknown[];
}

interface GmlParserModule {
  parser: {
    parse(code: string): ParsedGml;
  };
}

interface FormatterSettings {
  indentSize: number;
  useTabs: boolean;
  printWidth: number;
  trailingCommas: boolean;
  multilineFunctionCalls: "auto" | "always" | "never";
  style: "opinionated" | "minimal" | "preserve" | "gameMakerStudio";
  safety: "ast-equivalence" | "ast-and-trivia" | "trivia-strict" | "parse-only" | "off";
  mode: "file" | "snippet" | "expression" | "macro";
  trimTrailingWhitespace: boolean;
  maxBlankLines: number;
  readableSpacing: boolean;
  enforceBraces: boolean;
  enforceSemicolons: boolean;
  normalizeComments: boolean;
  simplifyParentheses: boolean;
  splitLongConditions: boolean;
}

const DEFAULT_OPTIONS: FormatterSettings = {
  indentSize: 4,
  useTabs: false,
  printWidth: 100,
  trailingCommas: false,
  multilineFunctionCalls: "auto",
  style: "opinionated",
  safety: "ast-and-trivia",
  mode: "file",
  trimTrailingWhitespace: true,
  maxBlankLines: 2,
  readableSpacing: true,
  enforceBraces: true,
  enforceSemicolons: true,
  normalizeComments: true,
  simplifyParentheses: true,
  splitLongConditions: false,
};

const STATEMENT_NODE_NAMES = new Set([
  "breakStatement",
  "continueStatement",
  "doUntilStatement",
  "emptyStatement",
  "enumStatement",
  "exitStatement",
  "expressionStatement",
  "forStatement",
  "functionStatement",
  "globalVarDeclarationsStatement",
  "ifStatement",
  "localVarDeclarationsStatement",
  "macroStatement",
  "repeatStatement",
  "returnStatement",
  "staticVarDeclarationStatement",
  "switchStatement",
  "tryStatement",
  "variableAssignmentStatement",
  "whileStatement",
  "withStatement",
]);

const SEMICOLON_STATEMENTS = new Set([
  "breakStatement",
  "continueStatement",
  "exitStatement",
  "expressionStatement",
  "globalVarDeclarationsStatement",
  "localVarDeclarationsStatement",
  "returnStatement",
  "staticVarDeclarationStatement",
  "variableAssignmentStatement",
]);

const BINARY_OPERATOR_TOKENS = new Set([
  "Assign",
  "NullishAssign",
  "PlusAssign",
  "MinusAssign",
  "MultiplyAssign",
  "DivideAssign",
  "ModuloAssign",
  "BitwiseAndAssign",
  "BitwiseOrAssign",
  "BitwiseXorAssign",
  "Nullish",
  "Equals",
  "NotEqual",
  "LessThan",
  "GreaterThan",
  "LessThanOrEqual",
  "GreaterThanOrEqual",
  "ShiftLeft",
  "ShiftRight",
  "Plus",
  "Minus",
  "Multiply",
  "Divide",
  "BitwiseAnd",
  "BitwiseOr",
  "BitwiseXor",
  "And",
  "Or",
  "Xor",
  "Div",
  "Modulo",
]);

const PREFIX_WORD_TOKENS = new Set(["Delete", "New", "Not"]);
const CONTROL_CONDITION_TOKENS = new Set(["Catch", "For", "If", "Switch", "While", "With"]);
const KEYWORD_SEPARATORS = new Set([
  "Case",
  "Catch",
  "Do",
  "Else",
  "Enum",
  "For",
  "Function",
  "GlobalVar",
  "If",
  "Repeat",
  "Return",
  "Static",
  "Switch",
  "Until",
  "Var",
  "While",
  "With",
]);

let parserModulePromise: Promise<GmlParserModule> | undefined;
const dynamicImport = new Function("specifier", "return import(specifier)") as (
  specifier: string,
) => Promise<GmlParserModule>;

export async function formatGml(source: string, options: GmlFormatOptions = {}): Promise<string> {
  return (await formatGmlDocument(source, options)).formatted;
}

export async function parseGml(source: string): Promise<ParsedGml> {
  return parseWithBscotch(source);
}

export async function checkGml(
  source: string,
  options: GmlFormatOptions = {},
): Promise<GmlFormatResult> {
  return formatGmlDocument(source, options);
}

export function formatGmlLexicalFallback(source: string, options: GmlFormatOptions = {}): string {
  const settings = { ...DEFAULT_OPTIONS, ...options };
  const indentUnit = settings.useTabs ? "\t" : " ".repeat(settings.indentSize);
  let indentLevel = 0;
  const output: string[] = [];
  for (const rawLine of source.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n")) {
    const trimmed = rawLine.trim().replace(/\/\/\s*/, "// ");
    if (!trimmed) {
      output.push("");
      continue;
    }
    const leadingClosers = trimmed.startsWith("}") ? 1 : 0;
    const effectiveIndent = Math.max(0, indentLevel - leadingClosers);
    const withSemicolon = shouldLexicallyAddSemicolon(trimmed) ? `${trimmed};` : trimmed;
    output.push(`${indentUnit.repeat(effectiveIndent)}${withSemicolon}`);
    indentLevel += countLexicalChar(trimmed, "{") - countLexicalChar(trimmed, "}");
    indentLevel = Math.max(0, indentLevel);
  }
  return output.join(source.includes("\r\n") ? "\r\n" : "\n");
}

function shouldLexicallyAddSemicolon(line: string): boolean {
  return (
    !/[;:{}]$/.test(line) &&
    !/^(?:if|else|for|while|switch|with|repeat|do|try|catch|finally|case|default|#)\b/.test(line)
  );
}

function countLexicalChar(line: string, char: string): number {
  return [...line].filter((candidate) => candidate === char).length;
}

export async function formatGmlDocument(
  source: string,
  options: GmlFormatOptions = {},
): Promise<GmlFormatResult> {
  const parsed = await parseWithBscotch(source);
  const parserDiagnostics = collectParseDiagnostics(parsed);
  const parserErrors = parserDiagnostics.map((diagnostic) => diagnostic.message);

  if (parserErrors.length > 0) {
    return {
      formatted: source,
      changed: false,
      parserErrors,
      parserDiagnostics,
      safetyErrors: [],
      safetyDiagnostics: [],
    };
  }

  const settings = resolveFormatterSettings(options);
  const newline = source.includes("\r\n") ? "\r\n" : "\n";
  const normalized = source.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const printer = new CstPrinter(normalized, parsed, settings);
  let formatted = printer.print().join(newline) + (normalized.endsWith("\n") ? newline : "");
  formatted = restoreMissingLineComments(source, formatted, newline);

  const reparsed = await parseWithBscotch(formatted);
  const reparseDiagnostics = collectParseDiagnostics(reparsed);
  if (reparseDiagnostics.length > 0) {
    return {
      formatted: source,
      changed: false,
      parserErrors: [],
      parserDiagnostics: [],
      safetyErrors: ["Formatted output failed to parse."],
      safetyDiagnostics: reparseDiagnostics.map(
        (diagnostic) => `${diagnostic.line}:${diagnostic.column} ${diagnostic.message}`,
      ),
    };
  }

  const originalFormatterAst = buildFormatterGmlAst(parsed.cst, parsed.lexed.tokens);
  const formattedFormatterAst = buildFormatterGmlAst(reparsed.cst, reparsed.lexed.tokens);
  const safetyDiagnostics =
    settings.safety === "ast-equivalence" ||
    settings.safety === "ast-and-trivia" ||
    settings.safety === "trivia-strict"
      ? compareFormatterGmlAsts(originalFormatterAst, formattedFormatterAst)
      : [];
  if (settings.safety === "ast-and-trivia" || settings.safety === "trivia-strict") {
    const triviaComparison = compareTrivia(source, formatted, settings.safety === "trivia-strict");
    safetyDiagnostics.push(
      ...triviaComparison.diagnostics.map((diagnostic) => `trivia: ${diagnostic}`),
    );
  }
  if (safetyDiagnostics.length > 0) {
    return {
      formatted: source,
      changed: false,
      parserErrors: [],
      parserDiagnostics: [],
      safetyErrors: ["Formatted output did not preserve the configured safety model."],
      safetyDiagnostics,
    };
  }

  return {
    formatted,
    changed: formatted !== source,
    parserErrors: [],
    parserDiagnostics: [],
    safetyErrors: [],
    safetyDiagnostics: [],
    formatterAst: formattedFormatterAst,
  };
}

export async function getGmlFormatterDebugInfo(source: string): Promise<GmlFormatterDebugInfo> {
  const parsed = await parseWithBscotch(source);
  const statements = parsed.cst.children.statements?.filter(isCstNode)[0];
  const ast = normalizeGmlAst(parsed.cst);
  const formatterAst = buildFormatterGmlAst(parsed.cst, parsed.lexed.tokens);
  const parserDiagnostics = collectParseDiagnostics(parsed);
  return {
    parserErrors: parserDiagnostics.map((diagnostic) => diagnostic.message),
    parserDiagnostics,
    tokenCount: parsed.lexed.tokens.length,
    rootNode: parsed.cst.name,
    topLevelStatements: statements?.children.statement?.filter(isCstNode).length ?? 0,
    normalizedAstSummary: summarizeGmlAst(ast),
    comments: collectComments(source),
    commentAttachments: collectCommentAttachments(source, parsed.lexed.tokens),
    semanticSignature: semanticTokenSignature(parsed),
    formatterAstSummary: summarizeFormatterGmlAst(formatterAst),
  };
}

function resolveFormatterSettings(options: GmlFormatOptions): FormatterSettings {
  const settings = { ...DEFAULT_OPTIONS, ...options };
  if (settings.style === "minimal") {
    settings.multilineFunctionCalls = options.multilineFunctionCalls ?? "never";
    settings.maxBlankLines = options.maxBlankLines ?? 2;
    settings.readableSpacing = options.readableSpacing ?? false;
    settings.enforceBraces = false;
    settings.enforceSemicolons = false;
    settings.simplifyParentheses = false;
  } else if (settings.style === "preserve") {
    settings.multilineFunctionCalls = options.multilineFunctionCalls ?? "never";
    settings.trimTrailingWhitespace = options.trimTrailingWhitespace ?? false;
    settings.maxBlankLines = options.maxBlankLines ?? 5;
    settings.readableSpacing = options.readableSpacing ?? false;
    settings.enforceBraces = false;
    settings.enforceSemicolons = false;
    settings.normalizeComments = false;
    settings.simplifyParentheses = false;
  } else if (settings.style === "gameMakerStudio") {
    settings.printWidth = options.printWidth ?? 120;
    settings.maxBlankLines = options.maxBlankLines ?? 1;
    settings.splitLongConditions = false;
  }
  return settings;
}

async function parseWithBscotch(source: string): Promise<ParsedGml> {
  const { parser } = await loadBscotchParser();
  return parser.parse(source);
}

async function loadBscotchParser(): Promise<GmlParserModule> {
  if (process.env.GML_FORMATTER_LOAD_FROM_NODE_MODULES === "1") {
    parserModulePromise ??= dynamicImport(
      pathToFileURL(
        path.join(
          __dirname,
          "..",
          "..",
          "node_modules",
          "@bscotch",
          "gml-parser",
          "dist",
          "parser.js",
        ),
      ).href,
    );
  } else {
    parserModulePromise ??=
      import("../node_modules/@bscotch/gml-parser/dist/parser.js") as Promise<GmlParserModule>;
  }

  return parserModulePromise;
}

function collectParseDiagnostics(parsed: ParsedGml): GmlParseDiagnostic[] {
  return [...(parsed.lexed.errors ?? []), ...(parsed.errors ?? [])].map((error) => {
    const errorObject =
      typeof error === "object" && error !== null
        ? (error as {
            message?: unknown;
            token?: { startLine?: number; startColumn?: number };
            line?: number;
            column?: number;
          })
        : undefined;
    return {
      message:
        error instanceof Error
          ? error.message
          : errorObject?.message
            ? String(errorObject.message)
            : String(error),
      line: errorObject?.token?.startLine ?? errorObject?.line ?? 1,
      column: errorObject?.token?.startColumn ?? errorObject?.column ?? 1,
    };
  });
}

export function collectComments(source: string): CommentTrivia[] {
  const comments: CommentTrivia[] = [];
  let line = 1;
  let column = 1;
  let quote: '"' | "'" | "`" | undefined;
  let escaped = false;

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];
    if (char === "\n") {
      line += 1;
      column = 1;
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
      const startOffset = index;
      const startLine = line;
      const lineEnd = source.indexOf("\n", index);
      const endOffset = (lineEnd === -1 ? source.length : lineEnd) - 1;
      comments.push({
        kind: "line",
        startOffset,
        endOffset,
        startLine,
        endLine: startLine,
        text: source.slice(startOffset, endOffset + 1).trim(),
      });
      index = endOffset;
      column += endOffset - startOffset + 1;
      continue;
    }
    if (char === "/" && next === "*") {
      const startOffset = index;
      const startLine = line;
      const end = source.indexOf("*/", index + 2);
      const endOffset = end === -1 ? source.length - 1 : end + 1;
      const text = source.slice(startOffset, endOffset + 1);
      const lineBreaks = text.match(/\n/g)?.length ?? 0;
      comments.push({
        kind: "block",
        startOffset,
        endOffset,
        startLine,
        endLine: startLine + lineBreaks,
        text: text.trim(),
      });
      index = endOffset;
      line += lineBreaks;
      column = lineBreaks ? text.length - text.lastIndexOf("\n") : column + text.length;
      continue;
    }
    column += 1;
  }

  return comments;
}

function restoreMissingLineComments(source: string, formatted: string, newline: string): string {
  const originalComments = collectTriviaComments(source);
  const formattedComments = collectTriviaComments(formatted);
  const missing = missingLineComments(originalComments, formattedComments);
  if (missing.length === 0) {
    return formatted;
  }

  const lines = formatted.split(/\r?\n/);
  const usedLineIndexes = new Set<number>();
  for (const comment of missing) {
    const normalizedComment = normalizeLineCommentText(comment.normalizedText);
    const anchor = normalizeCommentAnchor(comment.codeBeforeOnLine);
    const lineIndex = anchor
      ? findFormattedCommentAnchorLine(lines, anchor, usedLineIndexes)
      : undefined;

    if (lineIndex !== undefined) {
      lines[lineIndex] = `${stripTrailingWhitespace(lines[lineIndex])} ${normalizedComment}`;
      usedLineIndexes.add(lineIndex);
      continue;
    }

    const fallbackIndex = Math.min(Math.max(comment.line - 1, 0), Math.max(lines.length - 1, 0));
    const indent = lines[fallbackIndex]?.match(/^\s*/)?.[0] ?? "";
    lines.splice(fallbackIndex, 0, `${indent}${normalizedComment}`);
    usedLineIndexes.add(fallbackIndex);
  }

  return lines.join(newline);
}

function missingLineComments(
  original: ReturnType<typeof collectTriviaComments>,
  formatted: ReturnType<typeof collectTriviaComments>,
): ReturnType<typeof collectTriviaComments> {
  const formattedCounts = new Map<string, number>();
  for (const comment of formatted) {
    formattedCounts.set(
      comment.normalizedText,
      (formattedCounts.get(comment.normalizedText) ?? 0) + 1,
    );
  }

  const missing: ReturnType<typeof collectTriviaComments> = [];
  for (const comment of original) {
    const remaining = formattedCounts.get(comment.normalizedText) ?? 0;
    if (remaining > 0) {
      formattedCounts.set(comment.normalizedText, remaining - 1);
      continue;
    }
    if (comment.kind === "line") {
      missing.push(comment);
    }
  }
  return missing;
}

function findFormattedCommentAnchorLine(
  lines: string[],
  normalizedAnchor: string,
  usedLineIndexes: Set<number>,
): number | undefined {
  for (let index = 0; index < lines.length; index += 1) {
    if (usedLineIndexes.has(index) || findLineCommentStart(lines[index]) !== undefined) {
      continue;
    }
    if (normalizeCommentAnchor(lines[index].trim()) === normalizedAnchor) {
      return index;
    }
  }
  for (let index = 0; index < lines.length; index += 1) {
    if (usedLineIndexes.has(index) || findLineCommentStart(lines[index]) !== undefined) {
      continue;
    }
    const candidate = normalizeCommentAnchor(lines[index].trim());
    if (candidate.startsWith(normalizedAnchor) || normalizedAnchor.startsWith(candidate)) {
      return index;
    }
  }
  return undefined;
}

function normalizeCommentAnchor(text: string): string {
  return stripLineComment(text).replace(/\s+/g, "").replace(/;$/, "").toLowerCase();
}

function stripLineComment(text: string): string {
  const index = findLineCommentStart(text);
  return (index === undefined ? text : text.slice(0, index)).trim();
}

function stripTrailingWhitespace(text: string): string {
  return text.replace(/[ \t]+$/g, "");
}

function findLineCommentStart(text: string): number | undefined {
  let quote: '"' | "'" | "`" | undefined;
  let escaped = false;
  for (let index = 0; index < text.length - 1; index += 1) {
    const char = text[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) quote = undefined;
      continue;
    }
    if (char === '"' || char === "'" || char === "`") {
      quote = char;
      continue;
    }
    if (char === "/" && text[index + 1] === "/") {
      return index;
    }
  }
  return undefined;
}

export function collectCommentAttachments(source: string, tokens: GmlToken[]): CommentAttachment[] {
  return collectComments(source).map((comment) => {
    const lineStart = source.lastIndexOf("\n", comment.startOffset) + 1;
    const beforeOnLine = source.slice(lineStart, comment.startOffset).trim();
    const previousToken = [...tokens]
      .reverse()
      .find((token) => token.endOffset < comment.startOffset);
    const nextToken = tokens.find((token) => token.startOffset > comment.endOffset);
    let attachment: CommentAttachment["attachment"] = "dangling";
    if (comment.kind === "line" && beforeOnLine && previousToken?.endLine === comment.startLine) {
      attachment = "trailing";
    } else if (nextToken && comment.endLine < nextToken.startLine) {
      attachment = "leading";
    }
    return {
      kind: comment.kind,
      attachment,
      line: comment.startLine,
      text: comment.kind === "line" ? normalizeLineCommentText(comment.text) : comment.text,
    };
  });
}

function compareSemanticSignatures(original: ParsedGml, formatted: ParsedGml): string[] {
  const left = semanticTokenSignature(original);
  const right = semanticTokenSignature(formatted);
  const diagnostics: string[] = [];
  if (left.length !== right.length) {
    diagnostics.push(`semantic token count changed: ${left.length} -> ${right.length}`);
  }
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    if (left[index] !== right[index]) {
      diagnostics.push(
        `first semantic token mismatch at ${index}: ${left[index] ?? "<missing>"} -> ${right[index] ?? "<missing>"}`,
      );
      break;
    }
  }
  return diagnostics;
}

function semanticTokenSignature(parsed: ParsedGml): string[] {
  const tokens = parsed.lexed.tokens;
  const skippedStructuralIndexes = controlWrapperParenIndexes(tokens);
  return tokens
    .map((token, index) => ({ token, index }))
    .filter(({ token, index }) => {
      const name = token.tokenType.name;
      return (
        name !== "Semicolon" &&
        name !== "StartBrace" &&
        name !== "EndBrace" &&
        name !== "StartParen" &&
        name !== "EndParen" &&
        !(name === "Comma" && isTrailingDelimiterComma(tokens, index)) &&
        !skippedStructuralIndexes.has(index)
      );
    })
    .map(({ token }) => `${token.tokenType.name}:${normalizeSemanticImage(token.image)}`);
}

function isTrailingDelimiterComma(tokens: GmlToken[], index: number): boolean {
  const next = tokens[index + 1]?.tokenType.name;
  return next === "EndBrace" || next === "EndBracket" || next === "EndParen";
}

function normalizeSemanticImage(image: string): string {
  return image.replace(/\s+/g, " ").trim();
}

function controlWrapperParenIndexes(tokens: GmlToken[]): Set<number> {
  const skip = new Set<number>();
  const controlTokens = new Set(["If", "Switch", "While", "With", "Catch", "Repeat", "Until"]);
  for (let index = 0; index < tokens.length; index += 1) {
    if (!controlTokens.has(tokens[index].tokenType.name)) {
      continue;
    }
    const openIndex = nextMeaningfulTokenIndex(tokens, index + 1);
    if (openIndex === undefined || tokens[openIndex].tokenType.name !== "StartParen") {
      continue;
    }
    const closeIndex = matchingParenIndex(tokens, openIndex);
    if (closeIndex !== undefined) {
      skip.add(openIndex);
      skip.add(closeIndex);
    }
  }
  return skip;
}

function nextMeaningfulTokenIndex(tokens: GmlToken[], start: number): number | undefined {
  return start < tokens.length ? start : undefined;
}

function matchingParenIndex(tokens: GmlToken[], openIndex: number): number | undefined {
  let depth = 0;
  for (let index = openIndex; index < tokens.length; index += 1) {
    const name = tokens[index].tokenType.name;
    if (name === "StartParen") depth += 1;
    else if (name === "EndParen") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return undefined;
}

function normalizeLineCommentText(comment: string): string {
  return comment.startsWith("//") ? comment.replace(/^\/\/\s*/, "// ") : comment;
}

class CstPrinter {
  private readonly tokens: GmlToken[];
  private readonly settings: FormatterSettings;
  private readonly source: string;
  private readonly comments: CommentTrivia[];

  constructor(source: string, parsed: ParsedGml, settings: FormatterSettings) {
    this.source = source;
    this.tokens = parsed.lexed.tokens;
    this.settings = settings;
    this.comments = collectComments(source);
    this.root = parsed.cst;
  }

  private readonly root: GmlCstNode;

  print(): string[] {
    const lines = this.printStatements(
      this.children(this.child(this.root, "statements"), "statement"),
      0,
      {
        startOffset: 0,
        endOffset: this.source.length,
      },
    );
    return this.trimOuterBlankLines(lines);
  }

  private printStatements(
    statementWrappers: GmlCstNode[],
    indentLevel: number,
    bounds: { startOffset: number; endOffset: number },
  ): string[] {
    const lines: string[] = [];
    let cursor = bounds.startOffset;

    statementWrappers.forEach((wrapper, wrapperIndex) => {
      const statement = this.unwrapStatement(wrapper);
      const location = this.location(statement);
      if (!location) {
        return;
      }

      const leadingTrivia = this.leadingTrivia(cursor, location.startOffset, indentLevel);
      lines.push(...leadingTrivia);
      const printed = this.printStatement(statement, indentLevel);
      const comment = this.trailingLineComment(location.endOffset + 1);
      if (comment && printed.length > 0) {
        printed[printed.length - 1] = `${printed[printed.length - 1]} ${comment.text}`;
        cursor = comment.endOffset;
      } else {
        cursor = location.endOffset + 1;
      }
      lines.push(...printed);

      const nextStatement = this.nextStatement(statementWrappers, wrapperIndex);
      const nextLocation = nextStatement ? this.location(nextStatement) : undefined;
      if (
        this.settings.readableSpacing &&
        nextStatement &&
        nextLocation &&
        this.shouldInsertReadableBlankLine(statement, nextStatement, indentLevel) &&
        !this.hasBlankLineBetween(cursor, nextLocation.startOffset) &&
        lines[lines.length - 1] !== ""
      ) {
        lines.push("");
      }
    });

    lines.push(...this.leadingTrivia(cursor, bounds.endOffset, indentLevel));
    return this.capBlankLines(lines);
  }

  private printStatement(node: GmlCstNode, indentLevel: number): string[] {
    switch (node.name) {
      case "ifStatement":
        return this.printIfStatement(node, indentLevel);
      case "switchStatement":
        return this.printSwitchStatement(node, indentLevel);
      case "forStatement":
        return this.printBracedBody(
          this.printHeaderBeforeChild(node, "blockableStatement"),
          this.child(node, "blockableStatement"),
          indentLevel,
        );
      case "whileStatement":
        return this.printHeaderBodyStatement(node, indentLevel, "while", "blockableStatement");
      case "withStatement":
        return this.printHeaderBodyStatement(node, indentLevel, "with", "blockableStatement");
      case "repeatStatement":
        return this.printHeaderBodyStatement(node, indentLevel, "repeat", "blockableStatement");
      case "doUntilStatement":
        return this.printDoUntilStatement(node, indentLevel);
      case "tryStatement":
        return this.printTryStatement(node, indentLevel);
      case "functionStatement":
        return this.printFunctionStatement(node, indentLevel);
      case "enumStatement":
        return this.printEnumStatement(node, indentLevel);
      case "macroStatement":
        return [this.indent(indentLevel) + this.originalLine(node)];
      case "emptyStatement":
        return [this.indent(indentLevel) + ";"];
      default:
        return this.printSimpleStatement(node, indentLevel);
    }
  }

  private nextStatement(
    statementWrappers: GmlCstNode[],
    currentIndex: number,
  ): GmlCstNode | undefined {
    for (let index = currentIndex + 1; index < statementWrappers.length; index += 1) {
      const statement = this.unwrapStatement(statementWrappers[index]);
      if (this.location(statement)) return statement;
    }
    return undefined;
  }

  private shouldInsertReadableBlankLine(
    current: GmlCstNode,
    next: GmlCstNode,
    indentLevel: number,
  ): boolean {
    if (
      indentLevel > 0 &&
      current.name !== "functionStatement" &&
      current.name !== "enumStatement" &&
      current.name !== "switchStatement"
    ) {
      return false;
    }
    if (next.name === "emptyStatement") return false;
    return this.isReadableSpacingBoundary(current) || this.isReadableSpacingBoundary(next);
  }

  private isReadableSpacingBoundary(node: GmlCstNode): boolean {
    return (
      node.name === "ifStatement" ||
      node.name === "switchStatement" ||
      node.name === "forStatement" ||
      node.name === "whileStatement" ||
      node.name === "withStatement" ||
      node.name === "repeatStatement" ||
      node.name === "doUntilStatement" ||
      node.name === "tryStatement" ||
      node.name === "functionStatement" ||
      node.name === "enumStatement"
    );
  }

  private hasBlankLineBetween(startOffset: number, endOffset: number): boolean {
    const text = this.source.slice(Math.max(0, startOffset), Math.max(startOffset, endOffset));
    return /\n\s*\n/.test(text);
  }

  private printIfStatement(node: GmlCstNode, indentLevel: number): string[] {
    const lines = this.printConditionalBody(
      "if",
      this.child(node, "expression"),
      this.child(node, "blockableStatement"),
      indentLevel,
    );

    for (const elseIf of this.children(node, "elseIfStatement")) {
      lines.push(
        ...this.printConditionalBody(
          "else if",
          this.child(elseIf, "expression"),
          this.child(elseIf, "blockableStatement"),
          indentLevel,
        ),
      );
    }

    const elseNode = this.childOptional(node, "elseStatement");
    if (elseNode) {
      lines.push(
        ...this.printBracedBody("else", this.child(elseNode, "blockableStatement"), indentLevel),
      );
    }

    return lines;
  }

  private printConditionalBody(
    keyword: string,
    expression: GmlCstNode,
    body: GmlCstNode,
    indentLevel: number,
  ): string[] {
    return this.printBracedBody(`${keyword} ${this.printCondition(expression)}`, body, indentLevel);
  }

  private printHeaderBodyStatement(
    node: GmlCstNode,
    indentLevel: number,
    keyword: string,
    bodyName: string,
  ): string[] {
    const expression = this.childOptional(node, "expression");
    const header = expression
      ? `${keyword} ${this.printCondition(expression)}`
      : this.printHeaderBeforeChild(node, bodyName);
    return this.printBracedBody(header, this.child(node, bodyName), indentLevel);
  }

  private printDoUntilStatement(node: GmlCstNode, indentLevel: number): string[] {
    const lines = this.printBracedBody("do", this.child(node, "blockableStatement"), indentLevel);
    const expression = this.child(node, "expression");
    lines.push(`${this.indent(indentLevel)}until ${this.printCondition(expression)}`);
    return lines;
  }

  private printTryStatement(node: GmlCstNode, indentLevel: number): string[] {
    const lines = this.printNamedBlock("try", this.child(node, "blockStatement"), indentLevel);
    const catchNode = this.childOptional(node, "catchStatement");
    if (catchNode) {
      lines.push(...this.printCatchStatement(catchNode, indentLevel));
    }
    const finallyBlock = this.thirdBlockStatement(node);
    if (finallyBlock) {
      lines.push(...this.printNamedBlock("finally", finallyBlock, indentLevel));
    }
    return lines;
  }

  private printCatchStatement(node: GmlCstNode, indentLevel: number): string[] {
    const identifier = this.token(node, "Identifier")?.image ?? "";
    return this.printNamedBlock(
      `catch (${identifier})`,
      this.child(node, "blockStatement"),
      indentLevel,
    );
  }

  private printFunctionStatement(node: GmlCstNode, indentLevel: number): string[] {
    return this.printFunctionExpression(this.child(node, "functionExpression"), indentLevel);
  }

  private printFunctionExpression(node: GmlCstNode, indentLevel: number): string[] {
    const block = this.child(node, "blockStatement");
    const header = this.printTokensInRange(
      this.location(node)!.startOffset,
      this.location(block)!.startOffset - 1,
    );
    return this.printNamedBlock(header, block, indentLevel);
  }

  private printEnumStatement(node: GmlCstNode, indentLevel: number): string[] {
    const name =
      this.tokensInNode(node).find((token) => token.tokenType.name === "Identifier")?.image ?? "";
    const members = this.children(node, "enumMember");
    const lines = [`${this.indent(indentLevel)}enum ${name} {`];
    members.forEach((member, index) => {
      const comma = index === members.length - 1 ? "" : ",";
      lines.push(`${this.indent(indentLevel + 1)}${this.printNodeRange(member)}${comma}`);
    });
    lines.push(`${this.indent(indentLevel)}}`);
    return lines;
  }

  private printSwitchStatement(node: GmlCstNode, indentLevel: number): string[] {
    const lines = [
      `${this.indent(indentLevel)}switch ${this.printCondition(this.child(node, "expression"))} {`,
    ];
    const cases = [
      ...this.children(node, "caseStatement"),
      ...this.children(node, "defaultStatement"),
    ].sort((left, right) => this.location(left)!.startOffset - this.location(right)!.startOffset);
    const switchTokens = this.tokensInNode(node);
    const openBrace = switchTokens.find((token) => token.tokenType.name === "StartBrace");
    const closeBrace = [...switchTokens]
      .reverse()
      .find((token) => token.tokenType.name === "EndBrace");
    let cursor = openBrace
      ? openBrace.endOffset + 1
      : this.location(this.child(node, "expression"))!.endOffset + 1;
    let previousCase: GmlCstNode | undefined;

    cases.forEach((caseNode) => {
      const location = this.location(caseNode)!;
      const trivia = this.leadingTrivia(cursor, location.startOffset, indentLevel + 1);
      if (previousCase && trivia.length === 0 && this.caseHasBody(previousCase)) {
        lines.push("");
      }
      lines.push(...trivia);
      lines.push(...this.printCaseStatement(caseNode, indentLevel + 1));
      cursor = location.endOffset + 1;
      previousCase = caseNode;
    });

    const trailingEnd = closeBrace ? closeBrace.startOffset : this.location(node)!.endOffset;
    lines.push(...this.leadingTrivia(cursor, trailingEnd, indentLevel + 1));
    lines.push(`${this.indent(indentLevel)}}`);
    return lines;
  }

  private caseHasBody(node: GmlCstNode): boolean {
    const blockableStatements = this.childOptional(node, "blockableStatements");
    if (!blockableStatements) {
      return false;
    }
    const block = this.childOptional(blockableStatements, "blockStatement");
    if (block) {
      return this.children(block, "statement").length > 0;
    }
    const statements = this.childOptional(blockableStatements, "statements");
    return this.children(statements, "statement").length > 0;
  }

  private printCaseStatement(node: GmlCstNode, indentLevel: number): string[] {
    const lines: string[] = [];
    const colon = this.token(node, "Colon");
    const trailingComment = colon
      ? this.trailingCaseLineComment(colon.endOffset + 1)?.text
      : undefined;
    if (node.name === "caseStatement") {
      lines.push(
        `${this.indent(indentLevel)}case ${this.printNodeRange(this.child(node, "expression"))}:${trailingComment ? ` ${trailingComment}` : ""}`,
      );
    } else {
      lines.push(
        `${this.indent(indentLevel)}default:${trailingComment ? ` ${trailingComment}` : ""}`,
      );
    }

    lines.push(
      ...this.printBlockableStatementsContents(
        this.child(node, "blockableStatements"),
        indentLevel + 1,
      ),
    );
    return lines;
  }

  private printBracedBody(header: string, body: GmlCstNode, indentLevel: number): string[] {
    if (!this.settings.enforceBraces && !this.childOptional(body, "blockStatement")) {
      const lines = [`${this.indent(indentLevel)}${header}`];
      lines.push(...this.printBlockableContents(body, indentLevel + 1));
      return lines;
    }
    const lines = [`${this.indent(indentLevel)}${header} {`];
    lines.push(...this.printBlockableContents(body, indentLevel + 1));
    lines.push(`${this.indent(indentLevel)}}`);
    return lines;
  }

  private printNamedBlock(header: string, block: GmlCstNode, indentLevel: number): string[] {
    const location = this.location(block)!;
    const lines = [`${this.indent(indentLevel)}${header} {`];
    lines.push(
      ...this.printStatements(this.children(block, "statement"), indentLevel + 1, {
        startOffset: location.startOffset + 1,
        endOffset: location.endOffset,
      }),
    );
    lines.push(`${this.indent(indentLevel)}}`);
    return lines;
  }

  private printBlockableContents(blockable: GmlCstNode, indentLevel: number): string[] {
    const block = this.childOptional(blockable, "blockStatement");
    if (block) {
      const location = this.location(block)!;
      return this.printStatements(this.children(block, "statement"), indentLevel, {
        startOffset: location.startOffset + 1,
        endOffset: location.endOffset,
      });
    }

    const statement = this.child(blockable, "statement");
    return this.printStatements([statement], indentLevel, {
      startOffset: this.location(statement)!.startOffset,
      endOffset: this.location(statement)!.endOffset + 1,
    });
  }

  private printBlockableStatementsContents(blockable: GmlCstNode, indentLevel: number): string[] {
    const block = this.childOptional(blockable, "blockStatement");
    if (block) {
      const location = this.location(block)!;
      return this.printStatements(this.children(block, "statement"), indentLevel, {
        startOffset: location.startOffset + 1,
        endOffset: location.endOffset,
      });
    }

    const statements = this.child(blockable, "statements");
    const location = this.location(statements)!;
    return this.printStatements(this.children(statements, "statement"), indentLevel, {
      startOffset: location.startOffset,
      endOffset: location.endOffset + 1,
    });
  }

  private printSimpleStatement(node: GmlCstNode, indentLevel: number): string[] {
    const body = this.printNodeRange(node);
    const statement =
      this.settings.enforceSemicolons && SEMICOLON_STATEMENTS.has(node.name) && !body.endsWith(";")
        ? `${body};`
        : body;
    return this.printPossiblyMultilineExpression(statement, indentLevel);
  }

  private printHeaderBeforeChild(node: GmlCstNode, childName: string): string {
    const location = this.location(node)!;
    const child = this.child(node, childName);
    const childLocation = this.location(child)!;
    return this.printTokensInRange(location.startOffset, childLocation.startOffset - 1);
  }

  private printCondition(expression: GmlCstNode): string {
    const text = this.printNodeRange(expression);
    return text.startsWith("(") && text.endsWith(")") ? text : `(${text})`;
  }

  private printNodeRange(node: GmlCstNode): string {
    const location = this.location(node);
    return location ? this.printTokensInRange(location.startOffset, location.endOffset) : "";
  }

  private printTokensInRange(startOffset: number, endOffset: number): string {
    return this.renderTokens(
      this.tokens.filter(
        (token) => token.startOffset >= startOffset && token.endOffset <= endOffset,
      ),
    );
  }

  private printPossiblyMultilineExpression(statement: string, indentLevel: number): string[] {
    const singleLine = `${this.indent(indentLevel)}${statement}`;
    if (
      this.settings.multilineFunctionCalls === "never" ||
      (this.settings.multilineFunctionCalls === "auto" &&
        singleLine.length <= this.settings.printWidth)
    ) {
      return [singleLine];
    }

    const multiline = this.trySplitExpressionStatement(statement, indentLevel);
    return multiline ?? [singleLine];
  }

  private trySplitExpressionStatement(
    statement: string,
    indentLevel: number,
  ): string[] | undefined {
    const semicolon = statement.endsWith(";") ? ";" : "";
    const body = semicolon ? statement.slice(0, -1) : statement;
    return (
      this.trySplitCall(body, indentLevel, semicolon) ??
      this.trySplitAssignmentLiteral(body, indentLevel, semicolon) ??
      this.trySplitDelimited(body, indentLevel, semicolon)
    );
  }

  private trySplitCall(body: string, indentLevel: number, semicolon: string): string[] | undefined {
    const open = this.findFirstTopLevelDelimiter(body, "(");
    if (open === undefined || !/[\w)\]]$/.test(body.slice(0, open).trim())) {
      return undefined;
    }

    const close = this.findMatchingDelimiter(body, open, "(", ")");
    if (close !== body.length - 1) {
      return undefined;
    }

    const callee = body.slice(0, open).trim();
    const args = this.splitTopLevelItems(body.slice(open + 1, close));
    if (args.length <= 1 && this.settings.multilineFunctionCalls !== "always") {
      return undefined;
    }

    return renderDoc(
      group([
        `${callee}(`,
        indentDoc([
          hardLine,
          joinDoc(
            hardLine,
            args.map(
              (arg, index) =>
                `${arg}${this.shouldEmitTrailingComma(index, args.length) ? "," : ""}`,
            ),
          ),
        ]),
        hardLine,
        `)${semicolon}`,
      ]),
      {
        indent: this.indent(1),
        printWidth: this.settings.printWidth,
      },
    )
      .split("\n")
      .map((line, index) => `${this.indent(indentLevel + (index === 0 ? 0 : 0))}${line}`);
  }

  private trySplitAssignmentLiteral(
    body: string,
    indentLevel: number,
    semicolon: string,
  ): string[] | undefined {
    const assign = this.findTopLevelAssignment(body);
    if (assign === undefined) {
      return undefined;
    }

    const left = body.slice(0, assign.index).trim();
    const operator = assign.operator;
    const right = body.slice(assign.index + operator.length).trim();
    const split = this.trySplitDelimited(right, indentLevel, semicolon, `${left} ${operator} `);
    return split;
  }

  private trySplitDelimited(
    body: string,
    indentLevel: number,
    semicolon: string,
    prefix = "",
  ): string[] | undefined {
    const trimmed = body.trim();
    const openChar = trimmed[0];
    const closeChar = openChar === "{" ? "}" : openChar === "[" ? "]" : undefined;
    if (!closeChar || !trimmed.endsWith(closeChar)) {
      return undefined;
    }

    const items = this.splitTopLevelItems(trimmed.slice(1, -1));
    if (items.length <= 1 && this.settings.multilineFunctionCalls !== "always") {
      return undefined;
    }

    return renderDoc(
      group([
        `${prefix}${openChar}`,
        indentDoc([
          hardLine,
          joinDoc(
            hardLine,
            items.map(
              (item, index) =>
                `${item}${this.shouldEmitTrailingComma(index, items.length) ? "," : ""}`,
            ),
          ),
        ]),
        hardLine,
        `${closeChar}${semicolon}`,
      ]),
      {
        indent: this.indent(1),
        printWidth: this.settings.printWidth,
      },
    )
      .split("\n")
      .map((line) => `${this.indent(indentLevel)}${line}`);
  }

  private shouldEmitTrailingComma(index: number, length: number): boolean {
    return index < length - 1 || this.settings.trailingCommas;
  }

  private findFirstTopLevelDelimiter(text: string, delimiter: string): number | undefined {
    let depth = 0;
    let quote: string | undefined;
    for (let index = 0; index < text.length; index += 1) {
      const char = text[index];
      if (quote) {
        if (char === quote && text[index - 1] !== "\\") {
          quote = undefined;
        }
        continue;
      }
      if (char === '"' || char === "'" || char === "`") {
        quote = char;
        continue;
      }
      if (char === delimiter && depth === 0) {
        return index;
      }
      if (char === "(" || char === "[" || char === "{") {
        depth += 1;
      } else if (char === ")" || char === "]" || char === "}") {
        depth = Math.max(0, depth - 1);
      }
    }
    return undefined;
  }

  private findMatchingDelimiter(
    text: string,
    openIndex: number,
    openChar: string,
    closeChar: string,
  ): number | undefined {
    let depth = 0;
    let quote: string | undefined;
    for (let index = openIndex; index < text.length; index += 1) {
      const char = text[index];
      if (quote) {
        if (char === quote && text[index - 1] !== "\\") {
          quote = undefined;
        }
        continue;
      }
      if (char === '"' || char === "'" || char === "`") {
        quote = char;
        continue;
      }
      if (char === openChar) {
        depth += 1;
      } else if (char === closeChar) {
        depth -= 1;
        if (depth === 0) {
          return index;
        }
      }
    }
    return undefined;
  }

  private splitTopLevelItems(text: string): string[] {
    const items: string[] = [];
    let start = 0;
    let parenDepth = 0;
    let bracketDepth = 0;
    let braceDepth = 0;
    let quote: string | undefined;

    for (let index = 0; index < text.length; index += 1) {
      const char = text[index];
      if (quote) {
        if (char === quote && text[index - 1] !== "\\") {
          quote = undefined;
        }
        continue;
      }
      if (char === '"' || char === "'" || char === "`") {
        quote = char;
        continue;
      }
      if (char === "(") parenDepth += 1;
      else if (char === ")") parenDepth -= 1;
      else if (char === "[") bracketDepth += 1;
      else if (char === "]") bracketDepth -= 1;
      else if (char === "{") braceDepth += 1;
      else if (char === "}") braceDepth -= 1;
      else if (char === "," && parenDepth === 0 && bracketDepth === 0 && braceDepth === 0) {
        const item = text.slice(start, index).trim();
        if (item) items.push(item);
        start = index + 1;
      }
    }

    const final = text.slice(start).trim();
    if (final) {
      items.push(final);
    }
    return items;
  }

  private findTopLevelAssignment(text: string): { index: number; operator: string } | undefined {
    const operators = ["??=", "+=", "-=", "*=", "/=", "%=", "&=", "|=", "^=", "="];
    let parenDepth = 0;
    let bracketDepth = 0;
    let braceDepth = 0;
    let quote: string | undefined;

    for (let index = 0; index < text.length; index += 1) {
      const char = text[index];
      if (quote) {
        if (char === quote && text[index - 1] !== "\\") quote = undefined;
        continue;
      }
      if (char === '"' || char === "'" || char === "`") {
        quote = char;
        continue;
      }
      if (char === "(") parenDepth += 1;
      else if (char === ")") parenDepth -= 1;
      else if (char === "[") bracketDepth += 1;
      else if (char === "]") bracketDepth -= 1;
      else if (char === "{") braceDepth += 1;
      else if (char === "}") braceDepth -= 1;
      if (parenDepth !== 0 || bracketDepth !== 0 || braceDepth !== 0) {
        continue;
      }
      for (const operator of operators) {
        if (text.slice(index, index + operator.length) === operator) {
          if (operator === "=" && this.isEqualityOrComparisonToken(text, index)) {
            continue;
          }
          return { index, operator };
        }
      }
    }
    return undefined;
  }

  private isEqualityOrComparisonToken(text: string, index: number): boolean {
    return (
      text[index - 1] === "=" ||
      text[index - 1] === "!" ||
      text[index - 1] === "<" ||
      text[index - 1] === ">" ||
      text[index + 1] === "="
    );
  }

  private renderTokens(tokens: GmlToken[]): string {
    let output = "";
    for (let index = 0; index < tokens.length; index += 1) {
      const token = tokens[index];
      const previous = tokens[index - 1];
      if (
        previous &&
        this.shouldInsertSpace(tokens[index - 2], previous, token, tokens[index + 1])
      ) {
        output += " ";
      }
      output += token.image;
    }
    return this.settings.simplifyParentheses
      ? this.simplifyRenderedTokenText(output.trim())
      : output.trim();
  }

  private simplifyRenderedTokenText(text: string): string {
    if (!text) {
      return text;
    }
    const assignment = this.findTopLevelAssignment(text);
    if (assignment) {
      const left = text.slice(0, assignment.index).trim();
      const right = text.slice(assignment.index + assignment.operator.length).trim();
      return `${left} ${assignment.operator} ${this.stripRedundantOuterParens(right)}`;
    }
    if (/^(?:return|case|repeat|until)\b/.test(text)) {
      return text.replace(
        /^(return|case|repeat|until)\s+(.+)$/,
        (_match, keyword: string, expression: string) =>
          `${keyword} ${this.stripRedundantOuterParens(expression)}`,
      );
    }
    return this.stripRedundantOuterParens(text);
  }

  private stripRedundantOuterParens(text: string): string {
    let current = text.trim();
    while (
      current.startsWith("(") &&
      current.endsWith(")") &&
      this.outerParensWrapExpression(current)
    ) {
      current = current.slice(1, -1).trim();
    }
    return current;
  }

  private outerParensWrapExpression(text: string): boolean {
    let depth = 0;
    let quote: string | undefined;
    let escaped = false;
    for (let index = 0; index < text.length; index += 1) {
      const char = text[index];
      if (quote) {
        if (escaped) escaped = false;
        else if (char === "\\") escaped = true;
        else if (char === quote) quote = undefined;
        continue;
      }
      if (char === '"' || char === "'" || char === "`") {
        quote = char;
        continue;
      }
      if (char === "(") {
        depth += 1;
      } else if (char === ")") {
        depth -= 1;
        if (depth === 0 && index < text.length - 1) {
          return false;
        }
      }
    }
    return depth === 0;
  }

  private shouldInsertSpace(
    beforePrevious: GmlToken | undefined,
    previous: GmlToken,
    current: GmlToken,
    next: GmlToken | undefined,
  ): boolean {
    void next;
    const beforePreviousName = beforePrevious?.tokenType.name;
    const previousName = previous.tokenType.name;
    const currentName = current.tokenType.name;

    if (this.isInsideString(previousName, currentName)) {
      return false;
    }
    if (currentName === "Comma" || currentName === "Colon" || currentName === "Semicolon") {
      return false;
    }
    if (previousName === "Semicolon") {
      return true;
    }
    if (previousName === "Comma" || previousName === "Colon") {
      return true;
    }
    if (currentName === "EndParen" || currentName === "EndBracket" || currentName === "EndBrace") {
      return false;
    }
    if (
      previousName === "StartParen" ||
      previousName === "StartBracket" ||
      previousName === "StartBrace"
    ) {
      return false;
    }
    if (currentName === "StartParen") {
      return CONTROL_CONDITION_TOKENS.has(previousName) || BINARY_OPERATOR_TOKENS.has(previousName);
    }
    if (previousName === "Dot" || currentName === "Dot") {
      return false;
    }
    if (this.isUnarySign(currentName) && this.isUnarySignContext(previousName)) {
      return this.needsSpaceBeforeUnary(previousName);
    }
    if (this.isUnarySign(previousName) && this.isUnarySignContext(beforePreviousName)) {
      return false;
    }
    if (BINARY_OPERATOR_TOKENS.has(previousName) || BINARY_OPERATOR_TOKENS.has(currentName)) {
      return true;
    }
    if (PREFIX_WORD_TOKENS.has(previousName) || PREFIX_WORD_TOKENS.has(currentName)) {
      return true;
    }
    if (KEYWORD_SEPARATORS.has(previousName) || KEYWORD_SEPARATORS.has(currentName)) {
      return true;
    }
    return this.isWordLike(previousName) && this.isWordLike(currentName);
  }

  private isUnarySign(tokenName: string): boolean {
    return tokenName === "Minus" || tokenName === "Plus";
  }

  private isUnarySignContext(tokenName: string | undefined): boolean {
    return (
      !tokenName ||
      tokenName === "StartParen" ||
      tokenName === "StartBracket" ||
      tokenName === "StartBrace" ||
      tokenName === "Comma" ||
      tokenName === "Colon" ||
      tokenName === "Case" ||
      tokenName === "Return" ||
      tokenName === "Delete" ||
      tokenName === "New" ||
      tokenName === "Not" ||
      BINARY_OPERATOR_TOKENS.has(tokenName)
    );
  }

  private needsSpaceBeforeUnary(previousName: string): boolean {
    return (
      previousName === "Case" ||
      previousName === "Return" ||
      previousName === "Delete" ||
      previousName === "New" ||
      previousName === "Not" ||
      BINARY_OPERATOR_TOKENS.has(previousName)
    );
  }

  private isInsideString(previousName: string, currentName: string): boolean {
    return (
      (previousName === "StringStart" || previousName === "Character") &&
      (currentName === "Character" || currentName === "StringEnd")
    );
  }

  private isWordLike(tokenName: string): boolean {
    return /^(?:Identifier|Real|Hex|Binary|HexColor|True|False|Undefined|Infinity|NaN|Pi|Self|Other|Noone|All|Character|StringStart|StringEnd)$/.test(
      tokenName,
    );
  }

  private leadingTrivia(startOffset: number, endOffset: number, indentLevel: number): string[] {
    const lines: string[] = [];
    const snippet = this.source.slice(Math.max(0, startOffset), Math.max(0, endOffset));
    const rawLines = snippet.split("\n");
    let inBlockComment = false;

    for (let index = 0; index < rawLines.length; index += 1) {
      const rawLine = rawLines[index];
      const trimmed = rawLine.trim();
      const isBoundaryLine = index === 0 || index === rawLines.length - 1;

      if (inBlockComment) {
        lines.push(`${this.indent(indentLevel)}${trimmed}`);
        if (trimmed.includes("*/")) {
          inBlockComment = false;
        }
      } else if (trimmed.startsWith("/*")) {
        lines.push(`${this.indent(indentLevel)}${trimmed}`);
        if (!trimmed.includes("*/")) {
          inBlockComment = true;
        }
      } else if (trimmed.startsWith("//")) {
        lines.push(`${this.indent(indentLevel)}${this.normalizeComment(trimmed)}`);
      } else if (!trimmed && !isBoundaryLine) {
        lines.push("");
      }
    }
    return this.capBlankLines(lines);
  }

  private trailingLineComment(offset: number): { text: string; endOffset: number } | undefined {
    const lineEnd = this.lineEndOffset(offset);
    const rest = this.source.slice(offset, lineEnd);
    const index = this.findLineCommentStart(rest);
    if (index === undefined) {
      return undefined;
    }
    return {
      text: this.normalizeComment(rest.slice(index).trim()),
      endOffset: lineEnd,
    };
  }

  private trailingCaseLineComment(offset: number): { text: string; endOffset: number } | undefined {
    const lineEnd = this.lineEndOffset(offset);
    const rest = this.source.slice(offset, lineEnd);
    const index = this.findLineCommentStart(rest);
    if (index === undefined) {
      return undefined;
    }

    const commentStart = offset + index;
    const caseLabelBeforeComment = this.tokens.some(
      (token) =>
        token.startOffset >= offset &&
        token.endOffset < commentStart &&
        (token.tokenType.name === "Case" || token.tokenType.name === "Default"),
    );

    return caseLabelBeforeComment
      ? undefined
      : {
          text: this.normalizeComment(rest.slice(index).trim()),
          endOffset: lineEnd,
        };
  }

  private originalLine(node: GmlCstNode): string {
    const location = this.location(node);
    if (!location) {
      return "";
    }
    const lineStart = this.source.lastIndexOf("\n", location.startOffset) + 1;
    const lineEnd = this.lineEndOffset(location.endOffset);
    return this.source.slice(lineStart, lineEnd).trimEnd();
  }

  private lineEndOffset(offset: number): number {
    const lineEnd = this.source.indexOf("\n", offset);
    return lineEnd === -1 ? this.source.length : lineEnd;
  }

  private findLineCommentStart(line: string): number | undefined {
    let quote: '"' | "'" | "`" | undefined;
    let escaped = false;

    for (let index = 0; index < line.length - 1; index += 1) {
      const char = line[index];
      const next = line[index + 1];
      if (quote) {
        if (escaped) {
          escaped = false;
        } else if (char === "\\") {
          escaped = true;
        } else if (char === quote) {
          quote = undefined;
        }
        continue;
      }
      if (char === '"' || char === "'" || char === "`") {
        quote = char;
        continue;
      }
      if (char === "/" && next === "/") {
        return index;
      }
    }
    return undefined;
  }

  private normalizeComment(comment: string): string {
    return this.settings.normalizeComments && comment.startsWith("//")
      ? comment.replace(/^\/\/\s*/, "// ")
      : comment;
  }

  private isCommentLine(line: string): boolean {
    return (
      line.startsWith("//") ||
      line.startsWith("/*") ||
      line.startsWith("*") ||
      line.startsWith("*/")
    );
  }

  private child(parent: GmlCstNode, name: string, index = 0): GmlCstNode {
    const node = this.childOptional(parent, name, index);
    if (!node) {
      throw new Error(`Expected ${parent.name}.${name}[${index}]`);
    }
    return node;
  }

  private childOptional(parent: GmlCstNode, name: string, index = 0): GmlCstNode | undefined {
    return this.children(parent, name)[index];
  }

  private children(parent: GmlCstNode | undefined, name: string): GmlCstNode[] {
    return (parent?.children[name] ?? []).filter(isCstNode);
  }

  private token(parent: GmlCstNode, name: string, index = 0): GmlToken | undefined {
    return (parent.children[name] ?? []).filter(isToken)[index];
  }

  private tokensInNode(node: GmlCstNode): GmlToken[] {
    const location = this.location(node);
    return location
      ? this.tokens.filter(
          (token) =>
            token.startOffset >= location.startOffset && token.endOffset <= location.endOffset,
        )
      : [];
  }

  private thirdBlockStatement(node: GmlCstNode): GmlCstNode | undefined {
    return this.children(node, "blockStatement")[1];
  }

  private unwrapStatement(wrapper: GmlCstNode): GmlCstNode {
    if (wrapper.name !== "statement") {
      return wrapper;
    }
    for (const childNodes of Object.values(wrapper.children)) {
      for (const child of childNodes) {
        if (isCstNode(child) && STATEMENT_NODE_NAMES.has(child.name)) {
          return child;
        }
      }
    }
    return wrapper;
  }

  private location(node: GmlCstNode): GmlLocation | undefined {
    return isCompleteLocation(node.location) ? node.location : undefined;
  }

  private indent(level: number): string {
    return this.settings.useTabs
      ? "\t".repeat(level)
      : " ".repeat(this.settings.indentSize * level);
  }

  private capBlankLines(lines: string[]): string[] {
    const capped: string[] = [];
    let blankRun = 0;
    for (const line of lines) {
      const trimmed = this.settings.trimTrailingWhitespace ? line.trimEnd() : line;
      if (trimmed === "") {
        if (blankRun < this.settings.maxBlankLines) {
          capped.push("");
        }
        blankRun += 1;
      } else {
        capped.push(trimmed);
        blankRun = 0;
      }
    }
    return capped;
  }

  private trimOuterBlankLines(lines: string[]): string[] {
    const trimmed = [...lines];
    while (trimmed[0] === "") {
      trimmed.shift();
    }
    while (trimmed[trimmed.length - 1] === "") {
      trimmed.pop();
    }
    return trimmed;
  }
}

function isCstNode(value: GmlCstNode | GmlToken): value is GmlCstNode {
  return "children" in value;
}

function isToken(value: GmlCstNode | GmlToken): value is GmlToken {
  return "image" in value && "tokenType" in value;
}

function isCompleteLocation(location: GmlCstNode["location"]): location is GmlLocation {
  return typeof location?.startOffset === "number" && typeof location.endOffset === "number";
}
