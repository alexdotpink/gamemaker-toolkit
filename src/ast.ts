export interface NormalizedGmlAst {
  kind: "File";
  statements: NormalizedStatement[];
}

export interface FormatterGmlAst {
  kind: "File";
  statements: FormatterStatement[];
}

export interface NormalizedStatement {
  kind: string;
  startOffset: number;
  endOffset: number;
  children: NormalizedStatement[];
}

export interface FormatterStatement {
  kind: string;
  children: FormatterStatement[];
  expressions: FormatterExpression[];
  semanticTokens: string[];
}

export interface FormatterExpression {
  kind: string;
  value?: string;
  operator?: string;
  children?: FormatterExpression[];
}

interface CstNodeLike {
  name: string;
  location?: {
    startOffset?: number;
    endOffset?: number;
  };
  children?: Record<string, Array<CstNodeLike | unknown>>;
}

interface TokenLike {
  image: string;
  tokenType: { name: string };
  startOffset: number;
  endOffset: number;
}

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

const IGNORED_SEMANTIC_TOKEN_NAMES = new Set([
  "Semicolon",
  "StartBrace",
  "EndBrace",
  "StartParen",
  "EndParen",
]);

const ASSIGNMENT_TOKEN_NAMES = new Set([
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
]);

const BINARY_PRECEDENCE = new Map<string, number>([
  ["Or", 1],
  ["Xor", 2],
  ["And", 3],
  ["BitwiseOr", 4],
  ["BitwiseXor", 5],
  ["BitwiseAnd", 6],
  ["Equals", 7],
  ["NotEqual", 7],
  ["LessThan", 8],
  ["GreaterThan", 8],
  ["LessThanOrEqual", 8],
  ["GreaterThanOrEqual", 8],
  ["ShiftLeft", 9],
  ["ShiftRight", 9],
  ["Plus", 10],
  ["Minus", 10],
  ["Multiply", 11],
  ["Divide", 11],
  ["Div", 11],
  ["Modulo", 11],
  ["Nullish", 12],
]);

const PREFIX_TOKEN_NAMES = new Set(["Minus", "Plus", "Not", "Delete", "New"]);
const PRIMARY_TOKEN_NAMES = new Set([
  "Identifier",
  "Real",
  "Hex",
  "Binary",
  "HexColor",
  "StringLiteral",
  "StringStart",
  "StringEnd",
  "Character",
  "True",
  "False",
  "Undefined",
  "Infinity",
  "NaN",
  "Pi",
  "Self",
  "Other",
  "Noone",
  "All",
]);

export function normalizeGmlAst(cst: CstNodeLike): NormalizedGmlAst {
  return {
    kind: "File",
    statements: findStatements(cst),
  };
}

export function summarizeGmlAst(ast: NormalizedGmlAst): string[] {
  const lines: string[] = [];
  const visit = (statement: NormalizedStatement, depth: number) => {
    lines.push(
      `${"  ".repeat(depth)}- ${statement.kind} [${statement.startOffset}, ${statement.endOffset}]`,
    );
    statement.children.forEach((child) => visit(child, depth + 1));
  };
  ast.statements.forEach((statement) => visit(statement, 0));
  return lines;
}

export function buildFormatterGmlAst(cst: CstNodeLike, tokens: TokenLike[]): FormatterGmlAst {
  return {
    kind: "File",
    statements: findFormatterStatements(cst, tokens),
  };
}

export function summarizeFormatterGmlAst(ast: FormatterGmlAst): string[] {
  const lines: string[] = [];
  const visit = (statement: FormatterStatement, depth: number) => {
    const expressions = statement.expressions.length
      ? ` expr=${statement.expressions.map((expression) => expressionToSignature(expression)).join(", ")}`
      : "";
    lines.push(`${"  ".repeat(depth)}- ${statement.kind}${expressions}`);
    statement.children.forEach((child) => visit(child, depth + 1));
  };
  ast.statements.forEach((statement) => visit(statement, 0));
  return lines;
}

export function compareFormatterGmlAsts(left: FormatterGmlAst, right: FormatterGmlAst): string[] {
  const leftComparable = comparableFormatterAst(left);
  const rightComparable = comparableFormatterAst(right);
  if (JSON.stringify(leftComparable) === JSON.stringify(rightComparable)) {
    return [];
  }
  const leftLines = JSON.stringify(leftComparable, null, 2).split("\n");
  const rightLines = JSON.stringify(rightComparable, null, 2).split("\n");
  const diagnostics: string[] = ["formatter AST changed"];
  for (let index = 0; index < Math.max(leftLines.length, rightLines.length); index += 1) {
    if (leftLines[index] !== rightLines[index]) {
      diagnostics.push(`first AST mismatch at line ${index + 1}`);
      diagnostics.push(`original: ${leftLines[index] ?? "<missing>"}`);
      diagnostics.push(`formatted: ${rightLines[index] ?? "<missing>"}`);
      break;
    }
  }
  return diagnostics;
}

function findStatements(node: CstNodeLike): NormalizedStatement[] {
  const statements: NormalizedStatement[] = [];
  walk(node, (child) => {
    if (STATEMENT_NODE_NAMES.has(child.name)) {
      statements.push(normalizeStatement(child));
      return false;
    }
    return true;
  });
  return statements;
}

function findFormatterStatements(node: CstNodeLike, tokens: TokenLike[]): FormatterStatement[] {
  const statements: FormatterStatement[] = [];
  walk(node, (child) => {
    if (STATEMENT_NODE_NAMES.has(child.name)) {
      statements.push(normalizeFormatterStatement(child, tokens));
      return false;
    }
    return true;
  });
  return statements;
}

function normalizeStatement(node: CstNodeLike): NormalizedStatement {
  return {
    kind: node.name,
    startOffset: node.location?.startOffset ?? -1,
    endOffset: node.location?.endOffset ?? -1,
    children: directStatementChildren(node).map(normalizeStatement),
  };
}

function normalizeFormatterStatement(node: CstNodeLike, tokens: TokenLike[]): FormatterStatement {
  const nodeTokens = tokensInNode(tokens, node);
  return {
    kind: node.name,
    children: directStatementChildren(node).map((child) =>
      normalizeFormatterStatement(child, tokens),
    ),
    expressions: directExpressionChildren(node)
      .map((expression) => parseExpression(tokensInNode(tokens, expression)))
      .filter((expression): expression is FormatterExpression => !!expression),
    semanticTokens: semanticTokens(nodeTokens),
  };
}

function directStatementChildren(node: CstNodeLike): CstNodeLike[] {
  const children: CstNodeLike[] = [];
  for (const values of Object.values(node.children ?? {})) {
    for (const value of values) {
      if (isCstNode(value)) {
        if (STATEMENT_NODE_NAMES.has(value.name)) {
          children.push(value);
        } else {
          children.push(...directStatementChildren(value));
        }
      }
    }
  }
  return children;
}

function directExpressionChildren(node: CstNodeLike): CstNodeLike[] {
  const children: CstNodeLike[] = [];
  for (const values of Object.values(node.children ?? {})) {
    for (const value of values) {
      if (!isCstNode(value)) {
        continue;
      }
      if (value.name === "expression") {
        children.push(value);
      } else if (!STATEMENT_NODE_NAMES.has(value.name)) {
        children.push(...directExpressionChildren(value));
      }
    }
  }
  return children;
}

function tokensInNode(tokens: TokenLike[], node: CstNodeLike): TokenLike[] {
  const start = node.location?.startOffset;
  const end = node.location?.endOffset;
  if (typeof start !== "number" || typeof end !== "number") {
    return [];
  }
  return tokens.filter((token) => token.startOffset >= start && token.endOffset <= end);
}

function semanticTokens(tokens: TokenLike[]): string[] {
  return tokens
    .filter((token, index) => {
      const name = token.tokenType.name;
      return (
        !IGNORED_SEMANTIC_TOKEN_NAMES.has(name) &&
        !(name === "Comma" && isTrailingDelimiterComma(tokens, index))
      );
    })
    .map((token) => `${token.tokenType.name}:${token.image.replace(/\s+/g, " ").trim()}`);
}

function isTrailingDelimiterComma(tokens: TokenLike[], index: number): boolean {
  const next = tokens[index + 1]?.tokenType.name;
  return next === "EndBrace" || next === "EndBracket" || next === "EndParen";
}

function parseExpression(tokens: TokenLike[]): FormatterExpression | undefined {
  const expressionTokens = trimOuterParens(
    tokens.filter((token) => !["Semicolon"].includes(token.tokenType.name)),
  );
  if (expressionTokens.length === 0) {
    return undefined;
  }
  const parser = new ExpressionParser(expressionTokens);
  return (
    parser.parse() ?? {
      kind: "TokenRange",
      value: semanticTokens(expressionTokens).join(" "),
    }
  );
}

function trimOuterParens(tokens: TokenLike[]): TokenLike[] {
  let current = tokens;
  while (
    current.length >= 2 &&
    current[0].tokenType.name === "StartParen" &&
    current[current.length - 1].tokenType.name === "EndParen" &&
    matchingParenIndex(current, 0) === current.length - 1
  ) {
    current = current.slice(1, -1);
  }
  return current;
}

function matchingParenIndex(tokens: TokenLike[], openIndex: number): number | undefined {
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

class ExpressionParser {
  private cursor = 0;

  constructor(private readonly tokens: TokenLike[]) {}

  parse(): FormatterExpression | undefined {
    const expression = this.parseAssignment();
    return expression;
  }

  private parseAssignment(): FormatterExpression | undefined {
    const left = this.parseBinary(0);
    const token = this.peek();
    if (left && token && ASSIGNMENT_TOKEN_NAMES.has(token.tokenType.name)) {
      this.cursor += 1;
      const right = this.parseAssignment();
      return {
        kind: "AssignmentExpression",
        operator: token.tokenType.name,
        children: right ? [left, right] : [left],
      };
    }
    return left;
  }

  private parseBinary(minPrecedence: number): FormatterExpression | undefined {
    let left = this.parsePrefix();
    while (left) {
      const token = this.peek();
      const precedence = token ? BINARY_PRECEDENCE.get(token.tokenType.name) : undefined;
      if (!token || precedence === undefined || precedence < minPrecedence) {
        break;
      }
      this.cursor += 1;
      const right = this.parseBinary(precedence + 1);
      left = {
        kind: "BinaryExpression",
        operator: token.tokenType.name,
        children: right ? [left, right] : [left],
      };
    }
    return left;
  }

  private parsePrefix(): FormatterExpression | undefined {
    const token = this.peek();
    if (token && PREFIX_TOKEN_NAMES.has(token.tokenType.name)) {
      this.cursor += 1;
      const argument = this.parsePrefix();
      return {
        kind: "UnaryExpression",
        operator: token.tokenType.name,
        children: argument ? [argument] : [],
      };
    }
    return this.parsePostfix();
  }

  private parsePostfix(): FormatterExpression | undefined {
    let expression = this.parsePrimary();
    while (expression) {
      const token = this.peek();
      if (!token) break;
      if (token.tokenType.name === "StartParen") {
        const args = this.consumeDelimited("StartParen", "EndParen");
        expression = {
          kind: "CallExpression",
          children: [expression, ...splitExpressionList(args)],
        };
      } else if (token.tokenType.name === "StartBracket") {
        const args = this.consumeDelimited("StartBracket", "EndBracket");
        expression = {
          kind: "IndexExpression",
          children: [expression, ...splitExpressionList(args)],
        };
      } else if (token.tokenType.name === "Dot") {
        this.cursor += 1;
        const property = this.next();
        expression = {
          kind: "MemberExpression",
          value: property?.image,
          children: [expression],
        };
      } else {
        break;
      }
    }
    return expression;
  }

  private parsePrimary(): FormatterExpression | undefined {
    const token = this.next();
    if (!token) {
      return undefined;
    }
    if (token.tokenType.name === "StartParen") {
      const start = this.cursor;
      const close = matchingParenIndex(this.tokens.slice(tokenIndexBefore(this.cursor)), 0);
      if (close !== undefined) {
        const end = start + close - 1;
        const inner = this.tokens.slice(start, end);
        this.cursor = end + 1;
        return parseExpression(inner);
      }
    }
    if (token.tokenType.name === "StartBracket") {
      const items = this.consumeAlreadyOpenedDelimited("EndBracket");
      return { kind: "ArrayLiteral", children: splitExpressionList(items) };
    }
    if (token.tokenType.name === "StartBrace") {
      const items = this.consumeAlreadyOpenedDelimited("EndBrace");
      return { kind: "StructLiteral", children: splitExpressionList(items) };
    }
    if (PRIMARY_TOKEN_NAMES.has(token.tokenType.name)) {
      return {
        kind: token.tokenType.name,
        value: token.image,
      };
    }
    return {
      kind: token.tokenType.name,
      value: token.image,
    };
  }

  private consumeDelimited(open: string, close: string): TokenLike[] {
    const token = this.next();
    if (!token || token.tokenType.name !== open) return [];
    return this.consumeAlreadyOpenedDelimited(close);
  }

  private consumeAlreadyOpenedDelimited(close: string): TokenLike[] {
    const start = this.cursor;
    let paren = 0;
    let bracket = 0;
    let brace = 0;
    for (; this.cursor < this.tokens.length; this.cursor += 1) {
      const name = this.tokens[this.cursor].tokenType.name;
      if (name === "StartParen") paren += 1;
      else if (name === "EndParen") {
        if (close === "EndParen" && paren === 0 && bracket === 0 && brace === 0) break;
        paren -= 1;
      } else if (name === "StartBracket") bracket += 1;
      else if (name === "EndBracket") {
        if (close === "EndBracket" && paren === 0 && bracket === 0 && brace === 0) break;
        bracket -= 1;
      } else if (name === "StartBrace") brace += 1;
      else if (name === "EndBrace") {
        if (close === "EndBrace" && paren === 0 && bracket === 0 && brace === 0) break;
        brace -= 1;
      }
    }
    const items = this.tokens.slice(start, this.cursor);
    if (this.peek()?.tokenType.name === close) this.cursor += 1;
    return items;
  }

  private peek(): TokenLike | undefined {
    return this.tokens[this.cursor];
  }

  private next(): TokenLike | undefined {
    const token = this.tokens[this.cursor];
    if (token) this.cursor += 1;
    return token;
  }
}

function tokenIndexBefore(cursor: number): number {
  return Math.max(0, cursor - 1);
}

function splitExpressionList(tokens: TokenLike[]): FormatterExpression[] {
  const expressions: FormatterExpression[] = [];
  let start = 0;
  let paren = 0;
  let bracket = 0;
  let brace = 0;
  for (let index = 0; index <= tokens.length; index += 1) {
    const token = tokens[index];
    const name = token?.tokenType.name;
    const isBoundary =
      index === tokens.length || (name === "Comma" && paren === 0 && bracket === 0 && brace === 0);
    if (isBoundary) {
      const expression = parseExpression(tokens.slice(start, index));
      if (expression) expressions.push(expression);
      start = index + 1;
      continue;
    }
    if (name === "StartParen") paren += 1;
    else if (name === "EndParen") paren -= 1;
    else if (name === "StartBracket") bracket += 1;
    else if (name === "EndBracket") bracket -= 1;
    else if (name === "StartBrace") brace += 1;
    else if (name === "EndBrace") brace -= 1;
  }
  return expressions;
}

function expressionToSignature(expression: FormatterExpression): string {
  const children = expression.children?.length
    ? `(${expression.children.map(expressionToSignature).join(",")})`
    : "";
  return `${expression.kind}${expression.operator ? `:${expression.operator}` : ""}${expression.value ? `:${expression.value}` : ""}${children}`;
}

function comparableFormatterAst(ast: FormatterGmlAst): unknown {
  return {
    kind: ast.kind,
    statements: ast.statements.map(comparableStatement),
  };
}

function comparableStatement(statement: FormatterStatement): unknown {
  return {
    kind: statement.kind,
    semanticTokens: statement.semanticTokens,
    expressions: statement.expressions.map(comparableExpression),
    children: statement.children.map(comparableStatement),
  };
}

function comparableExpression(expression: FormatterExpression): unknown {
  return {
    kind: expression.kind,
    value: expression.value,
    operator: expression.operator,
    children: expression.children?.map(comparableExpression) ?? [],
  };
}

function walk(node: CstNodeLike, visitor: (node: CstNodeLike) => boolean): void {
  if (!visitor(node)) return;
  for (const values of Object.values(node.children ?? {})) {
    for (const value of values) {
      if (isCstNode(value)) {
        walk(value, visitor);
      }
    }
  }
}

function isCstNode(value: unknown): value is CstNodeLike {
  return typeof value === "object" && value !== null && "name" in value && "children" in value;
}
