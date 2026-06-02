export interface ExpressionSimplification {
  original: string;
  simplified: string;
  changes: string[];
}

export interface ExpressionExplanation {
  expression: string;
  plainEnglish: string;
  fullyParenthesized: string;
  shape: string[];
  detectedPatterns: string[];
  suggestions: string[];
}

export function simplifyGmlExpression(expression: string): ExpressionSimplification {
  let simplified = expression.trim();
  const changes: string[] = [];

  const replacements: Array<[RegExp, string, string]> = [
    [/\b([A-Za-z_][A-Za-z0-9_.\[\]]*)\s*==\s*true\b/g, "$1", "Removed comparison to true."],
    [/\b([A-Za-z_][A-Za-z0-9_.\[\]]*)\s*!=\s*false\b/g, "$1", "Removed comparison against false."],
    [
      /\b([A-Za-z_][A-Za-z0-9_.\[\]]*)\s*==\s*false\b/g,
      "!$1",
      "Converted comparison to false into negation.",
    ],
    [
      /\b([A-Za-z_][A-Za-z0-9_.\[\]]*)\s*!=\s*true\b/g,
      "!$1",
      "Converted comparison against true into negation.",
    ],
    [/\b([A-Za-z_][A-Za-z0-9_.\[\]]*)\s*\+\s*0\b/g, "$1", "Removed addition by zero."],
    [/\b0\s*\+\s*([A-Za-z_][A-Za-z0-9_.\[\]]*)\b/g, "$1", "Removed leading zero addition."],
    [/\b([A-Za-z_][A-Za-z0-9_.\[\]]*)\s*-\s*0\b/g, "$1", "Removed subtraction by zero."],
    [/\b([A-Za-z_][A-Za-z0-9_.\[\]]*)\s*\*\s*1\b/g, "$1", "Removed multiplication by one."],
    [/\b1\s*\*\s*([A-Za-z_][A-Za-z0-9_.\[\]]*)\b/g, "$1", "Removed leading multiplication by one."],
    [/\b([A-Za-z_][A-Za-z0-9_.\[\]]*)\s*\/\s*1\b/g, "$1", "Removed division by one."],
    [
      /([A-Za-z_][A-Za-z0-9_.\[\]]*)\s*-\s*-\s*(\d+(?:\.\d+)?)/g,
      "$1 + $2",
      "Converted subtracting a negative number into addition.",
    ],
    [/!\s*!\s*([A-Za-z_][A-Za-z0-9_.\[\]]*)/g, "$1", "Removed double negation."],
  ];

  for (const [pattern, replacement, description] of replacements) {
    const next = simplified.replace(pattern, replacement);
    if (next !== simplified) {
      simplified = next;
      changes.push(description);
    }
  }

  simplified = simplified.replace(/\(([^()\n]+)\)\s*\*\s*\(\1\)/g, (_match, repeated: string) => {
    changes.push("Detected repeated multiplication and converted it to sqr(...).");
    return `sqr(${repeated.trim()})`;
  });

  simplified = simplified.replace(
    /!\s*\(([^()]+)\s*<\s*([^()]+)\)/g,
    (_match, left: string, right: string) => {
      changes.push("Converted negated less-than comparison.");
      return `${left.trim()} >= ${right.trim()}`;
    },
  );
  simplified = simplified.replace(
    /!\s*\(([^()]+)\s*>\s*([^()]+)\)/g,
    (_match, left: string, right: string) => {
      changes.push("Converted negated greater-than comparison.");
      return `${left.trim()} <= ${right.trim()}`;
    },
  );

  const spaced = normalizeExpressionSpacing(simplified);
  if (spaced !== simplified) {
    simplified = spaced;
    changes.push("Normalized expression spacing.");
  }

  return {
    original: expression,
    simplified,
    changes,
  };
}

export function explainGmlExpression(expression: string): ExpressionExplanation {
  const trimmed = expression.trim();
  const detectedPatterns: string[] = [];
  const suggestions: string[] = [];
  const shape = expressionShape(trimmed);

  const repeated = repeatedParenthesizedFactor(trimmed);
  if (repeated) {
    detectedPatterns.push(`Repeated factor: ${repeated}`);
    suggestions.push(`Consider sqr(${repeated}) or extracting ${repeated} to a local variable.`);
  }
  if (/==\s*true\b|!=\s*false\b|==\s*false\b|!=\s*true\b/.test(trimmed)) {
    detectedPatterns.push("Boolean comparison to true/false.");
    suggestions.push("Use the boolean value directly or negate it.");
  }
  if (/[A-Za-z_][A-Za-z0-9_]*\s*[-+*/]\s*-?\d/.test(trimmed)) {
    detectedPatterns.push("Numeric operation with a literal.");
  }
  if (/^\(?\s*\d+\s*\/\s*\d+\s*\)?\s*\*/.test(trimmed)) {
    detectedPatterns.push("Leading numeric coefficient.");
    suggestions.push(
      "Consider naming the coefficient with a #macro or local variable if it represents speed, gravity, curve height, or timing.",
    );
  }
  if (
    /\b[A-Za-z_][A-Za-z0-9_]*_X\b/.test(trimmed) &&
    /\b[A-Za-z_][A-Za-z0-9_]*_Y\b/.test(trimmed)
  ) {
    detectedPatterns.push("Coordinate-style expression.");
  }
  if (
    /\([A-Za-z_][A-Za-z0-9_]*_X\s*[-+]\s*-?\d+(?:\.\d+)?\)\s*\*\s*\([A-Za-z_][A-Za-z0-9_]*_X\s*[-+]\s*-?\d+(?:\.\d+)?\)/.test(
      trimmed,
    )
  ) {
    detectedPatterns.push("Parabola-style repeated X offset.");
    suggestions.push(
      "Use sqr(xOffset) or a named xOffset variable to make the curve easier to tune.",
    );
  }
  if (/\bsqr\s*\(/.test(trimmed)) {
    detectedPatterns.push("Squared expression helper.");
  }
  const constant = trimmed.match(/\(([-+*/.\d\s]{3,})\)/);
  if (constant) {
    const value = evaluateArithmeticConstant(constant[1]);
    if (value !== undefined) {
      detectedPatterns.push(
        `Constant sub-expression: (${constant[1].trim()}) = ${Number(value.toPrecision(8))}`,
      );
      suggestions.push("Prefer a named constant when the number has gameplay meaning.");
    }
  }

  const simplification = simplifyGmlExpression(trimmed);
  if (simplification.changes.length > 0 && simplification.simplified !== trimmed) {
    suggestions.push(`Simplified form: ${simplification.simplified}`);
  }

  return {
    expression: trimmed,
    plainEnglish: explainInPlainEnglish(trimmed),
    fullyParenthesized: fullyParenthesizeExpression(trimmed),
    shape,
    detectedPatterns,
    suggestions,
  };
}

function normalizeExpressionSpacing(expression: string): string {
  if (/["'`]/.test(expression)) return expression.trim();
  return expression
    .replace(/\s+/g, " ")
    .replace(/\s*([*/%])\s*/g, " $1 ")
    .replace(/\s*([+])\s*/g, " $1 ")
    .replace(/([A-Za-z0-9_\]\)])\s*-\s*([A-Za-z0-9_(])/g, "$1 - $2")
    .replace(/\s*(==|!=|<=|>=|<|>)\s*/g, " $1 ")
    .replace(/\s*,\s*/g, ", ")
    .replace(/\(\s+/g, "(")
    .replace(/\s+\)/g, ")")
    .replace(/\s+/g, " ")
    .trim();
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

function expressionShape(expression: string): string[] {
  const lines: string[] = [];
  const operators = [
    [" or ", "LogicalOr"],
    [" and ", "LogicalAnd"],
    ["==", "Equality"],
    ["!=", "Inequality"],
    [">=", "GreaterOrEqual"],
    ["<=", "LessOrEqual"],
    [">", "GreaterThan"],
    ["<", "LessThan"],
    ["+", "Add"],
    ["-", "Subtract"],
    ["*", "Multiply"],
    ["/", "Divide"],
  ] as const;
  for (const [operator, label] of operators) {
    const parts = splitTopLevel(expression, operator);
    if (parts.length > 1) {
      lines.push(label);
      for (const part of parts) {
        lines.push(`  ${part.trim()}`);
      }
      return lines;
    }
  }
  lines.push(expression);
  return lines;
}

function explainInPlainEnglish(expression: string): string {
  const normalized = expression
    .replace(/\s+/g, " ")
    .replace(/\band\b/g, "&&")
    .replace(/\bor\b/g, "||")
    .trim();
  const orParts = splitTopLevel(normalized, "||");
  if (orParts.length > 1) {
    return `This is true when ${orParts.map(explainInPlainEnglish).join(" or ")}.`;
  }
  const andParts = splitTopLevel(normalized, "&&");
  if (andParts.length > 1) {
    return `all of these are true: ${andParts.map(explainInPlainEnglish).join("; ")}.`;
  }
  const comparison = normalized.match(/^(.+?)\s*(==|!=|<=|>=|<|>)\s*(.+)$/);
  if (comparison) {
    const [, left, operator, right] = comparison;
    const words: Record<string, string> = {
      "==": "equals",
      "!=": "does not equal",
      "<=": "is at most",
      ">=": "is at least",
      "<": "is less than",
      ">": "is greater than",
    };
    return `${left.trim()} ${words[operator]} ${right.trim()}`;
  }
  if (/^!\s*/.test(normalized)) return `not (${normalized.replace(/^!\s*/, "").trim()})`;
  return normalized;
}

function fullyParenthesizeExpression(expression: string): string {
  const normalized = expression
    .replace(/\s+/g, " ")
    .replace(/\band\b/g, "&&")
    .replace(/\bor\b/g, "||")
    .trim();
  for (const operator of ["||", "&&", "==", "!=", ">=", "<=", ">", "<", "+", "-", "*", "/"]) {
    const parts = splitTopLevel(normalized, operator);
    if (parts.length > 1) {
      return `(${parts.map(fullyParenthesizeExpression).join(` ${operator} `)})`;
    }
  }
  return normalized;
}

function repeatedParenthesizedFactor(expression: string): string | undefined {
  const match = expression.match(/\(([^()\n]+)\)\s*\*\s*\(\1\)/);
  return match?.[1]?.trim();
}

function splitTopLevel(expression: string, operator: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote: string | undefined;
  let start = 0;
  for (let index = 0; index < expression.length; index += 1) {
    const char = expression[index];
    if (quote) {
      if (char === quote && expression[index - 1] !== "\\") quote = undefined;
      continue;
    }
    if (char === '"' || char === "'" || char === "`") {
      quote = char;
      continue;
    }
    if (char === "(" || char === "[" || char === "{") depth += 1;
    else if (char === ")" || char === "]" || char === "}") depth -= 1;
    if (depth === 0 && expression.slice(index, index + operator.length) === operator) {
      parts.push(expression.slice(start, index));
      start = index + operator.length;
      index += operator.length - 1;
    }
  }
  if (parts.length > 0) {
    parts.push(expression.slice(start));
  }
  return parts;
}
