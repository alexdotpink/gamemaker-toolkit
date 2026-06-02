import { formatGmlDocument } from "./formatter";
import {
  explainGmlExpression,
  simplifyGmlExpression,
  type ExpressionExplanation,
} from "./expressionTools";
import { collectTriviaComments, collectTriviaStrings, compareTrivia } from "./trivia";

export interface GmlProjectRules {
  stateVariables?: string[];
  languageVariables?: string[];
  requiredLanguages?: string[];
  dialogueObjects?: string[];
}

export interface GmlAnalysisOptions {
  projectRules?: GmlProjectRules;
}

export interface GmlDiagnosticFinding {
  severity: "info" | "warning" | "error";
  code: string;
  message: string;
  line: number;
  column: number;
  endLine?: number;
  endColumn?: number;
}

export interface GmlMagicNumber {
  value: string;
  count: number;
  lines: number[];
}

export interface GmlSuspiciousName {
  name: string;
  suggestion: string;
  lines: number[];
}

export interface GmlStateCase {
  label: string;
  line: number;
  comment?: string;
  transitions: string[];
  hasBreak: boolean;
}

export interface GmlStateMachine {
  variable: string;
  line: number;
  cases: GmlStateCase[];
  warnings: string[];
  mermaid: string;
}

export interface GmlDialogueCase {
  room?: string;
  txtNum: string;
  line: number;
  len?: number;
  textCount?: number;
  faceCount?: number;
  choiceCount?: number;
  choiceTargetCount?: number;
  missingLanguages: string[];
  warnings: string[];
}

export interface GmlRepeatedExpression {
  expression: string;
  count: number;
  lines: number[];
  suggestion: string;
}

export interface GmlComplexityMetrics {
  lineCount: number;
  codeLineCount: number;
  commentLineCount: number;
  functionCount: number;
  maxBraceDepth: number;
  cyclomaticComplexity: number;
}

export interface GmlTodoComment {
  tag: string;
  text: string;
  line: number;
}

export interface GmlAssetReference {
  kind: "sprite" | "sound" | "object" | "room" | "script" | "path" | "font" | "timeline";
  name: string;
  line: number;
  context: string;
}

export interface GmlConstantExpression {
  expression: string;
  value: number;
  line: number;
  suggestion: string;
}

export interface GmlAnalysisReport {
  findings: GmlDiagnosticFinding[];
  metrics: GmlComplexityMetrics;
  todoComments: GmlTodoComment[];
  magicNumbers: GmlMagicNumber[];
  suspiciousNames: GmlSuspiciousName[];
  assetReferences: GmlAssetReference[];
  constantExpressions: GmlConstantExpression[];
  stateMachines: GmlStateMachine[];
  dialogueCases: GmlDialogueCase[];
  repeatedExpressions: GmlRepeatedExpression[];
  expressionExplanations: ExpressionExplanation[];
  sceneNotesMarkdown: string;
  confidence: {
    level: "high" | "medium" | "low";
    reasons: string[];
  };
}

const DEFAULT_RULES: Required<GmlProjectRules> = {
  stateVariables: ["fase", "phase", "state"],
  languageVariables: ["global.LAN"],
  requiredLanguages: ["ITA", "ENG"],
  dialogueObjects: ["dialoguebarUI"],
};

const TYPO_SUGGESTIONS = new Map([
  ["collomn", "column"],
  ["collom", "column"],
  ["chioces", "choices"],
  ["dialouge", "dialogue"],
  ["dialouges", "dialogues"],
  ["charecter", "character"],
  ["beggining", "beginning"],
  ["seccuss", "success"],
]);

export async function analyzeGmlSource(
  source: string,
  options: GmlAnalysisOptions = {},
): Promise<GmlAnalysisReport> {
  const rules = resolveRules(options.projectRules);
  const formatResult = await formatGmlDocument(source);
  const findings: GmlDiagnosticFinding[] = [];
  if (formatResult.parserErrors.length > 0) {
    findings.push(
      ...formatResult.parserDiagnostics.map((diagnostic) => ({
        severity: "error" as const,
        code: "parse-error",
        message: diagnostic.message,
        line: diagnostic.line,
        column: diagnostic.column,
      })),
    );
  }
  if (formatResult.safetyErrors.length > 0) {
    findings.push({
      severity: "error",
      code: "formatter-safety",
      message: formatResult.safetyDiagnostics[0] ?? formatResult.safetyErrors[0],
      line: 1,
      column: 1,
    });
  }

  const lines = source.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const metrics = calculateMetrics(lines);
  findings.push(...metricFindings(metrics));
  const todoComments = findTodoComments(lines);
  findings.push(
    ...todoComments.map((comment) => ({
      severity: /^(?:FIXME|BUG|XXX)$/i.test(comment.tag) ? ("warning" as const) : ("info" as const),
      code: "todo-comment",
      message: `${comment.tag}: ${comment.text}`,
      line: comment.line,
      column: Math.max(1, lines[comment.line - 1].indexOf(comment.tag) + 1),
    })),
  );

  const commentAudit = auditComments(source, formatResult.formatted);
  const stringAudit = auditStrings(source, formatResult.formatted);
  if (!commentAudit.ok) {
    findings.push({
      severity: "error",
      code: "comment-preservation",
      message: commentAudit.message,
      line: 1,
      column: 1,
    });
  }
  if (!stringAudit.ok) {
    findings.push({
      severity: "error",
      code: "string-preservation",
      message: stringAudit.message,
      line: 1,
      column: 1,
    });
  }

  findings.push(...findFlowFindings(lines));
  const magicNumbers = findMagicNumbers(lines);
  findings.push(
    ...magicNumbers
      .filter((number) => number.count > 1)
      .map((number) => ({
        severity: "info" as const,
        code: "magic-number",
        message: `Magic number ${number.value} appears ${number.count} times. Consider extracting a named constant.`,
        line: number.lines[0],
        column: Math.max(1, lines[number.lines[0] - 1].indexOf(number.value) + 1),
      })),
  );

  const suspiciousNames = findSuspiciousNames(lines);
  findings.push(
    ...suspiciousNames.map((name) => ({
      severity: "info" as const,
      code: "suspicious-name",
      message: `Suspicious name "${name.name}". Did you mean "${name.suggestion}"?`,
      line: name.lines[0],
      column: Math.max(1, lines[name.lines[0] - 1].indexOf(name.name) + 1),
    })),
  );

  const assetReferences = findAssetReferences(lines);
  const constantExpressions = findConstantExpressions(lines);
  findings.push(
    ...constantExpressions.map((expression) => ({
      severity: "info" as const,
      code: "constant-expression",
      message: expression.suggestion,
      line: expression.line,
      column: Math.max(1, lines[expression.line - 1].indexOf(expression.expression) + 1),
    })),
  );

  const stateMachines = findStateMachines(lines, rules.stateVariables);
  for (const machine of stateMachines) {
    findings.push(
      ...machine.warnings.map((warning) => ({
        severity: "warning" as const,
        code: "state-machine",
        message: warning,
        line: machine.line,
        column: 1,
      })),
    );
  }

  const dialogueCases = findDialogueCases(lines, rules);
  for (const dialogue of dialogueCases) {
    findings.push(
      ...dialogue.warnings.map((warning) => ({
        severity: "warning" as const,
        code: "dialogue",
        message: warning,
        line: dialogue.line,
        column: 1,
      })),
    );
  }

  const repeatedExpressions = findRepeatedExpressions(lines);
  findings.push(
    ...repeatedExpressions.map((expression) => ({
      severity: "info" as const,
      code: "repeated-expression",
      message: `${expression.expression} appears ${expression.count} times. ${expression.suggestion}`,
      line: expression.lines[0],
      column: Math.max(1, lines[expression.lines[0] - 1].indexOf(expression.expression) + 1),
    })),
  );

  const expressionExplanations = repeatedExpressions
    .slice(0, 5)
    .map((expression) => explainGmlExpression(expression.expression));
  const confidenceReasons = [
    formatResult.parserErrors.length === 0 ? "parser ok" : "parser errors present",
    formatResult.safetyErrors.length === 0 ? "formatter AST equivalent" : "formatter safety failed",
    commentAudit.ok ? "comments preserved" : "comment mismatch",
    stringAudit.ok ? "strings preserved" : "string mismatch",
  ];
  const level =
    formatResult.parserErrors.length ||
    formatResult.safetyErrors.length ||
    !commentAudit.ok ||
    !stringAudit.ok
      ? "low"
      : collectTriviaComments(source).some((comment) => comment.kind === "block")
        ? "medium"
        : "high";

  return {
    findings,
    metrics,
    todoComments,
    magicNumbers,
    suspiciousNames,
    assetReferences,
    constantExpressions,
    stateMachines,
    dialogueCases,
    repeatedExpressions,
    expressionExplanations,
    sceneNotesMarkdown: generateSceneNotesMarkdown(stateMachines, dialogueCases),
    confidence: {
      level,
      reasons: confidenceReasons,
    },
  };
}

export function analyzeExpressionAtText(text: string): ExpressionExplanation {
  return explainGmlExpression(text);
}

export function simplifyExpressionText(text: string): string {
  return simplifyGmlExpression(text).simplified;
}

function resolveRules(rules?: GmlProjectRules): Required<GmlProjectRules> {
  return {
    stateVariables: rules?.stateVariables ?? DEFAULT_RULES.stateVariables,
    languageVariables: rules?.languageVariables ?? DEFAULT_RULES.languageVariables,
    requiredLanguages: rules?.requiredLanguages ?? DEFAULT_RULES.requiredLanguages,
    dialogueObjects: rules?.dialogueObjects ?? DEFAULT_RULES.dialogueObjects,
  };
}

function auditComments(original: string, formatted: string): { ok: boolean; message: string } {
  const comparison = compareTrivia(original, formatted);
  const commentDiagnostics = comparison.diagnostics.filter((diagnostic) =>
    diagnostic.startsWith("comment "),
  );
  const left = collectTriviaComments(original);
  const right = collectTriviaComments(formatted);
  return commentDiagnostics.length === 0
    ? { ok: true, message: `Comments preserved: ${left.length}/${left.length}` }
    : {
        ok: false,
        message: `Comments changed: original ${left.length}, formatted ${right.length}. ${commentDiagnostics[0]}`,
      };
}

function auditStrings(original: string, formatted: string): { ok: boolean; message: string } {
  const left = collectTriviaStrings(original).map((string) => string.text);
  const right = collectTriviaStrings(formatted).map((string) => string.text);
  return arraysEqual(left, right)
    ? { ok: true, message: `Strings preserved: ${left.length}/${left.length}` }
    : { ok: false, message: `Strings changed: original ${left.length}, formatted ${right.length}` };
}

function arraysEqual(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function calculateMetrics(lines: string[]): GmlComplexityMetrics {
  let codeLineCount = 0;
  let commentLineCount = 0;
  let functionCount = 0;
  let maxBraceDepth = 0;
  let braceDepth = 0;
  let cyclomaticComplexity = 1;
  for (const line of lines) {
    const code = stripLineComment(line);
    const trimmedCode = code.trim();
    const trimmedLine = line.trim();
    if (trimmedCode) codeLineCount += 1;
    if (/^(?:\/\/|\/\*|\*)/.test(trimmedLine) || line.includes("//")) commentLineCount += 1;
    if (/^\s*(?:function\b|constructor\b)/.test(code)) functionCount += 1;
    cyclomaticComplexity += countMatches(code, /\b(?:if|case|for|while|repeat|with|catch)\b/g);
    cyclomaticComplexity += countMatches(code, /\b(?:and|or)\b|&&|\|\||\?/g);
    braceDepth += countChar(code, "{");
    maxBraceDepth = Math.max(maxBraceDepth, braceDepth);
    braceDepth = Math.max(0, braceDepth - countChar(code, "}"));
  }
  return {
    lineCount: lines.length,
    codeLineCount,
    commentLineCount,
    functionCount,
    maxBraceDepth,
    cyclomaticComplexity,
  };
}

function metricFindings(metrics: GmlComplexityMetrics): GmlDiagnosticFinding[] {
  const findings: GmlDiagnosticFinding[] = [];
  if (metrics.cyclomaticComplexity >= 30) {
    findings.push({
      severity: "warning",
      code: "complexity",
      message: `High cyclomatic complexity (${metrics.cyclomaticComplexity}). Consider splitting logic into functions or smaller states.`,
      line: 1,
      column: 1,
    });
  } else if (metrics.cyclomaticComplexity >= 18) {
    findings.push({
      severity: "info",
      code: "complexity",
      message: `Moderate cyclomatic complexity (${metrics.cyclomaticComplexity}).`,
      line: 1,
      column: 1,
    });
  }
  if (metrics.maxBraceDepth >= 7) {
    findings.push({
      severity: "warning",
      code: "nesting-depth",
      message: `Deep nesting detected (${metrics.maxBraceDepth} brace levels).`,
      line: 1,
      column: 1,
    });
  }
  if (metrics.codeLineCount >= 300) {
    findings.push({
      severity: "info",
      code: "large-file",
      message: `Large GML file (${metrics.codeLineCount} code lines).`,
      line: 1,
      column: 1,
    });
  }
  return findings;
}

function findTodoComments(lines: string[]): GmlTodoComment[] {
  const todos: GmlTodoComment[] = [];
  lines.forEach((line, index) => {
    const commentIndex = line.indexOf("//");
    if (commentIndex === -1) return;
    const text = line.slice(commentIndex + 2).trim();
    const match = text.match(/\b(TODO|FIXME|BUG|HACK|XXX|NOTE)\b:?\s*(.*)/i);
    if (!match) return;
    todos.push({
      tag: match[1].toUpperCase(),
      text: match[2].trim() || text,
      line: index + 1,
    });
  });
  return todos;
}

function findFlowFindings(lines: string[]): GmlDiagnosticFinding[] {
  const findings: GmlDiagnosticFinding[] = [];
  let unreachable = false;
  for (let index = 0; index < lines.length; index += 1) {
    const stripped = stripLineComment(lines[index]).trim();
    if (!stripped) continue;
    if (unreachable && !/^(?:case\b|default:|\})/.test(stripped)) {
      findings.push({
        severity: "warning",
        code: "unreachable",
        message: "Statement may be unreachable after break/continue/return/exit.",
        line: index + 1,
        column: Math.max(1, lines[index].search(/\S/) + 1),
      });
      unreachable = false;
    }
    unreachable = /\b(?:break|continue|return|exit)\s*;?\s*$/.test(stripped);
  }
  const seenCases = new Map<string, number>();
  lines.forEach((line, index) => {
    const match = line.match(/^\s*case\s+([^:]+):/);
    if (!match) return;
    const label = match[1].trim();
    const first = seenCases.get(label);
    if (first) {
      findings.push({
        severity: "warning",
        code: "duplicate-case",
        message: `Duplicate case label ${label}; first seen on line ${first}.`,
        line: index + 1,
        column: 1,
      });
    } else {
      seenCases.set(label, index + 1);
    }
  });
  lines.forEach((line, index) => {
    if (/\belse\s+if\b.*\{\s*\}/.test(line) || /\bif\b.*\{\s*\}/.test(line)) {
      findings.push({
        severity: "warning",
        code: "empty-branch",
        message: "Empty branch detected.",
        line: index + 1,
        column: Math.max(1, line.indexOf("{") + 1),
      });
    }
  });
  return findings;
}

function findMagicNumbers(lines: string[]): GmlMagicNumber[] {
  const skip = new Set(["0", "1", "-1", "2"]);
  const found = new Map<string, Set<number>>();
  lines.forEach((line, index) => {
    const code = stripLineComment(line);
    for (const match of code.matchAll(/(?<![A-Za-z_])(-?\d+(?:\.\d+)?)(?![A-Za-z_])/g)) {
      const value = match[1];
      if (skip.has(value)) continue;
      const set = found.get(value) ?? new Set<number>();
      set.add(index + 1);
      found.set(value, set);
    }
  });
  return [...found.entries()]
    .map(([value, linesSet]) => ({ value, count: linesSet.size, lines: [...linesSet] }))
    .sort((left, right) => right.count - left.count || Number(left.value) - Number(right.value));
}

function findSuspiciousNames(lines: string[]): GmlSuspiciousName[] {
  const found = new Map<string, Set<number>>();
  lines.forEach((line, index) => {
    for (const [typo] of TYPO_SUGGESTIONS) {
      if (new RegExp(`\\b[A-Za-z0-9_]*${typo}[A-Za-z0-9_]*\\b`, "i").test(line)) {
        const matched =
          line.match(new RegExp(`\\b[A-Za-z0-9_]*${typo}[A-Za-z0-9_]*\\b`, "i"))?.[0] ?? typo;
        const set = found.get(matched) ?? new Set<number>();
        set.add(index + 1);
        found.set(matched, set);
      }
    }
  });
  return [...found.entries()].map(([name, linesSet]) => {
    const typo =
      [...TYPO_SUGGESTIONS.keys()].find((candidate) => name.toLowerCase().includes(candidate)) ??
      name;
    return {
      name,
      suggestion: name.replace(new RegExp(typo, "i"), TYPO_SUGGESTIONS.get(typo) ?? typo),
      lines: [...linesSet],
    };
  });
}

function findAssetReferences(lines: string[]): GmlAssetReference[] {
  const references: GmlAssetReference[] = [];
  const callRules: Array<{ kind: GmlAssetReference["kind"]; pattern: RegExp; context: string }> = [
    {
      kind: "sprite",
      pattern: /\bdraw_sprite(?:_ext|_part|_stretched|_pos)?\s*\(\s*([A-Za-z_][A-Za-z0-9_]*)/g,
      context: "draw call",
    },
    {
      kind: "sprite",
      pattern: /\bsprite_index\s*=\s*([A-Za-z_][A-Za-z0-9_]*)/g,
      context: "sprite_index assignment",
    },
    {
      kind: "sound",
      pattern: /\baudio_play_sound\s*\(\s*([A-Za-z_][A-Za-z0-9_]*)/g,
      context: "sound call",
    },
    {
      kind: "object",
      pattern:
        /\binstance_create_(?:layer|depth)\s*\([^,\n]+,[^,\n]+,[^,\n]+,\s*([A-Za-z_][A-Za-z0-9_]*)/g,
      context: "instance creation",
    },
    {
      kind: "room",
      pattern: /\broom_goto(?:_next|_previous)?\s*\(\s*([A-Za-z_][A-Za-z0-9_]*)/g,
      context: "room transition",
    },
    {
      kind: "path",
      pattern: /\bmp_potential_path\s*\([^,\n]+,\s*([A-Za-z_][A-Za-z0-9_]*)/g,
      context: "pathfinding",
    },
    {
      kind: "font",
      pattern: /\bdraw_set_font\s*\(\s*([A-Za-z_][A-Za-z0-9_]*)/g,
      context: "font selection",
    },
    {
      kind: "timeline",
      pattern: /\btimeline_index\s*=\s*([A-Za-z_][A-Za-z0-9_]*)/g,
      context: "timeline assignment",
    },
  ];

  lines.forEach((line, index) => {
    const code = stripLineComment(line);
    for (const rule of callRules) {
      for (const match of code.matchAll(rule.pattern)) {
        references.push({
          kind: rule.kind,
          name: match[1],
          line: index + 1,
          context: rule.context,
        });
      }
    }
  });

  return dedupeBy(
    references,
    (reference) => `${reference.kind}:${reference.name}:${reference.line}:${reference.context}`,
  );
}

function findConstantExpressions(lines: string[]): GmlConstantExpression[] {
  const expressions: GmlConstantExpression[] = [];
  lines.forEach((line, index) => {
    const code = stripLineComment(line);
    for (const match of code.matchAll(/\(([-+*/.\d\s]{3,})\)/g)) {
      const raw = match[1].trim();
      if (!/[+*/-]/.test(raw) || !/\d/.test(raw)) continue;
      const value = evaluateArithmeticConstant(raw);
      if (value === undefined) continue;
      const expression = `(${raw})`;
      const compact = Number.isInteger(value)
        ? String(value)
        : Number(value.toPrecision(8)).toString();
      expressions.push({
        expression,
        value,
        line: index + 1,
        suggestion: `${expression} is a constant expression equal to ${compact}. Consider a named #macro if it explains movement, timing, or physics.`,
      });
    }
  });
  return dedupeBy(expressions, (expression) => `${expression.expression}:${expression.line}`);
}

function evaluateArithmeticConstant(expression: string): number | undefined {
  if (!/^[\d\s+*/().-]+$/.test(expression)) return undefined;
  if (/\.\./.test(expression)) return undefined;
  try {
    const value = Function(`"use strict"; return (${expression});`)() as unknown;
    return typeof value === "number" && Number.isFinite(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

function findStateMachines(lines: string[], stateVariables: string[]): GmlStateMachine[] {
  const machines: GmlStateMachine[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const variable = stateVariables.find((candidate) =>
      new RegExp(`\\bswitch\\s*\\(\\s*${escapeRegExp(candidate)}\\s*\\)`).test(lines[index]),
    );
    if (!variable) continue;
    const block = collectBraceBlock(lines, index);
    const cases = parseStateCases(block.lines, block.startLine);
    const warnings: string[] = [];
    for (const stateCase of cases) {
      if (stateCase.transitions.length > 1)
        warnings.push(`case ${stateCase.label} has multiple ${variable} transitions.`);
      if (!stateCase.hasBreak && stateCase.transitions.length > 0)
        warnings.push(`case ${stateCase.label} changes ${variable} without an obvious break.`);
    }
    const labels = cases
      .map((stateCase) => Number(stateCase.label))
      .filter((label) => Number.isFinite(label))
      .sort((left, right) => left - right);
    for (let labelIndex = 1; labelIndex < labels.length; labelIndex += 1) {
      if (labels[labelIndex] - labels[labelIndex - 1] > 1) {
        warnings.push(`missing cases between ${labels[labelIndex - 1]} and ${labels[labelIndex]}.`);
      }
    }
    machines.push({
      variable,
      line: index + 1,
      cases,
      warnings,
      mermaid: stateMachineMermaid(variable, cases),
    });
  }
  return machines;
}

function parseStateCases(lines: string[], startLine: number): GmlStateCase[] {
  const cases: GmlStateCase[] = [];
  let current: GmlStateCase | undefined;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const caseMatch = line.match(/^\s*case\s+([^:]+):\s*(?:(\/\/.*))?/);
    if (caseMatch) {
      current = {
        label: caseMatch[1].trim(),
        line: startLine + index,
        comment: caseMatch[2]?.replace(/^\/\/\s*/, ""),
        transitions: [],
        hasBreak: false,
      };
      cases.push(current);
      continue;
    }
    if (!current) continue;
    if (/\bbreak\s*;?/.test(line)) current.hasBreak = true;
    if (/\b(?:fase|phase|state)\s*\+=\s*1\b/.test(line))
      current.transitions.push(`${current.label} + 1`);
    const assignment = line.match(/\b(?:fase|phase|state)\s*=\s*([^;]+)/);
    if (assignment) current.transitions.push(assignment[1].trim());
  }
  return cases;
}

function stateMachineMermaid(variable: string, cases: GmlStateCase[]): string {
  const lines = ["graph TD"];
  for (const stateCase of cases) {
    const node = `${variable}${sanitizeMermaidId(stateCase.label)}`;
    const label = `${variable} ${stateCase.label}${stateCase.comment ? `: ${stateCase.comment}` : ""}`;
    lines.push(`  ${node}["${label.replace(/"/g, "'")}"]`);
    for (const transition of stateCase.transitions) {
      const target =
        transition === `${stateCase.label} + 1` && /^-?\d+$/.test(stateCase.label)
          ? String(Number(stateCase.label) + 1)
          : transition;
      lines.push(
        `  ${node} --> ${variable}${sanitizeMermaidId(target)}["${variable} ${target.replace(/"/g, "'")}"]`,
      );
    }
  }
  return lines.join("\n");
}

function findDialogueCases(lines: string[], rules: Required<GmlProjectRules>): GmlDialogueCase[] {
  const dialogues: GmlDialogueCase[] = [];
  let room: string | undefined;
  for (let index = 0; index < lines.length; index += 1) {
    const roomMatch = lines[index].match(/case\s+"([^"]+)":/);
    if (roomMatch) room = roomMatch[1];
    const caseMatch = lines[index].match(/^\s*case\s+(-?\d+):/);
    if (!caseMatch) continue;
    const block = collectCaseBlock(lines, index);
    const text = block.join("\n");
    if (!/(?:text|face|LEN|choice|global\.LAN)/.test(text)) continue;
    const len = numberAssignment(text, "LEN");
    const faceCount = arrayAssignmentCount(text, "face");
    const textCount = arrayAssignmentCount(text, "text");
    const choiceCount = arrayAssignmentCount(text, "choices");
    const choiceTargetCount = arrayAssignmentCount(text, "WN");
    const presentLanguages = new Set(
      [...text.matchAll(/global\.LAN\s*==\s*"([^"]+)"/g)].map((match) => match[1]),
    );
    const missingLanguages = rules.requiredLanguages.filter(
      (language) => !presentLanguages.has(language),
    );
    const warnings: string[] = [];
    if (len !== undefined && textCount !== undefined && len !== textCount)
      warnings.push(`LEN is ${len}, but text array has ${textCount} entries.`);
    if (len !== undefined && faceCount !== undefined && faceCount !== len)
      warnings.push(`LEN is ${len}, but face array has ${faceCount} entries.`);
    if (/choice\s*=\s*true/.test(text) && choiceCount === undefined)
      warnings.push("choice is true but choices array is missing.");
    if (
      choiceCount !== undefined &&
      choiceTargetCount !== undefined &&
      choiceCount !== choiceTargetCount
    )
      warnings.push(`choices has ${choiceCount} entries, but WN has ${choiceTargetCount}.`);
    for (const language of missingLanguages) warnings.push(`Missing ${language} branch.`);
    if (/global\.LAN\s*==\s*"[^"]+"\s*\{\s*\}/.test(text))
      warnings.push("Empty language branch detected.");
    dialogues.push({
      room,
      txtNum: caseMatch[1],
      line: index + 1,
      len,
      textCount,
      faceCount,
      choiceCount,
      choiceTargetCount,
      missingLanguages,
      warnings,
    });
  }
  return dialogues;
}

function findRepeatedExpressions(lines: string[]): GmlRepeatedExpression[] {
  const found = new Map<string, Set<number>>();
  lines.forEach((line, index) => {
    const code = stripLineComment(line);
    for (const match of code.matchAll(/\(([A-Za-z_][A-Za-z0-9_]*\s*[-+]\s*-?\d+(?:\.\d+)?)\)/g)) {
      const expression = match[1].replace(/\s+/g, " ").trim();
      const set = found.get(expression) ?? new Set<number>();
      set.add(index + 1);
      found.set(expression, set);
    }
  });
  return [...found.entries()]
    .filter(([, linesSet]) => linesSet.size > 0)
    .map(([expression, linesSet]) => ({
      expression,
      count: linesSet.size,
      lines: [...linesSet],
      suggestion: `Consider sqr(${expression}) if it is multiplied by itself, or extract it to a variable.`,
    }))
    .filter(
      (entry) =>
        entry.count > 1 ||
        new RegExp(
          `\\(${escapeRegExp(entry.expression)}\\)\\s*\\*\\s*\\(${escapeRegExp(entry.expression)}\\)`,
        ).test(lines.join("\n")),
    );
}

function generateSceneNotesMarkdown(
  stateMachines: GmlStateMachine[],
  dialogueCases: GmlDialogueCase[],
): string {
  const lines = ["# GML Analysis Notes", ""];
  for (const machine of stateMachines) {
    lines.push(`## State Machine: ${machine.variable}`, "");
    for (const stateCase of machine.cases) {
      lines.push(
        `- ${machine.variable} ${stateCase.label}${stateCase.comment ? `: ${stateCase.comment}` : ""}`,
      );
    }
    if (machine.warnings.length) {
      lines.push("", "Warnings:");
      lines.push(...machine.warnings.map((warning) => `- ${warning}`));
    }
    lines.push("");
  }
  if (dialogueCases.length) {
    lines.push("## Dialogue Cases", "");
    for (const dialogue of dialogueCases) {
      lines.push(
        `- ${dialogue.room ?? "unknown room"} / txt_num ${dialogue.txtNum}: ${dialogue.warnings.length ? dialogue.warnings.join("; ") : "ok"}`,
      );
    }
  }
  return lines.join("\n").trimEnd() + "\n";
}

function collectBraceBlock(
  lines: string[],
  startIndex: number,
): { startLine: number; lines: string[] } {
  const collected: string[] = [];
  let depth = 0;
  let started = false;
  for (let index = startIndex; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.includes("{")) {
      depth += countChar(line, "{");
      started = true;
    }
    if (started) collected.push(line);
    if (line.includes("}")) depth -= countChar(line, "}");
    if (started && depth <= 0) break;
  }
  return { startLine: startIndex + 1, lines: collected };
}

function collectCaseBlock(lines: string[], startIndex: number): string[] {
  const collected: string[] = [lines[startIndex]];
  for (let index = startIndex + 1; index < lines.length; index += 1) {
    if (/^\s*(?:case\b|default:)/.test(lines[index])) break;
    collected.push(lines[index]);
  }
  return collected;
}

function stripLineComment(line: string): string {
  const index = line.indexOf("//");
  return index === -1 ? line : line.slice(0, index);
}

function numberAssignment(text: string, name: string): number | undefined {
  const match = text.match(new RegExp(`\\b${escapeRegExp(name)}\\s*=\\s*(-?\\d+(?:\\.\\d+)?)`));
  return match ? Number(match[1]) : undefined;
}

function arrayAssignmentCount(text: string, name: string): number | undefined {
  const match = text.match(new RegExp(`\\b${escapeRegExp(name)}\\s*=\\s*\\[([\\s\\S]*?)\\]`));
  if (!match) return undefined;
  return splitArrayItems(match[1]).length;
}

function splitArrayItems(text: string): string[] {
  const items: string[] = [];
  let start = 0;
  let depth = 0;
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
    if (char === "[" || char === "{" || char === "(") depth += 1;
    else if (char === "]" || char === "}" || char === ")") depth -= 1;
    else if (char === "," && depth === 0) {
      const item = text.slice(start, index).trim();
      if (item) items.push(item);
      start = index + 1;
    }
  }
  const final = text.slice(start).trim();
  if (final) items.push(final);
  return items;
}

function countChar(text: string, char: string): number {
  return [...text].filter((candidate) => candidate === char).length;
}

function countMatches(text: string, pattern: RegExp): number {
  return [...text.matchAll(pattern)].length;
}

function dedupeBy<T>(items: T[], keyFor: (item: T) => string): T[] {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const item of items) {
    const key = keyFor(item);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function sanitizeMermaidId(text: string): string {
  return text.replace(/[^A-Za-z0-9_]/g, "_");
}
