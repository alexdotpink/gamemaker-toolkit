import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  CompletionItemKind,
  createConnection,
  DiagnosticSeverity,
  Hover,
  InitializeParams,
  InitializeResult,
  Location,
  MarkupKind,
  ParameterInformation,
  ProposedFeatures,
  RenameParams,
  SemanticTokensBuilder,
  SemanticTokensLegend,
  SignatureHelp,
  SignatureInformation,
  SymbolInformation,
  SymbolKind,
  TextDocumentPositionParams,
  TextDocuments,
  TextDocumentSyncKind,
  WorkspaceSymbolParams,
} from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";
import { analyzeGmlSource } from "./analysis";
import { builtinMarkdown, expectedArgumentCount, findBuiltin, GML_BUILTINS } from "./gmlKnowledge";
import {
  buildGmlProjectIndex,
  closestResourceNames,
  eventFromPath,
  findSymbol,
  referencesFor,
  type GmlIndexedSymbol,
  type GmlProjectFile,
  type GmlProjectIndex,
} from "./projectIndex";

const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments(TextDocument);
const semanticLegend: SemanticTokensLegend = {
  tokenTypes: [
    "namespace",
    "type",
    "class",
    "enum",
    "function",
    "variable",
    "parameter",
    "property",
    "keyword",
    "number",
    "string",
    "comment",
    "macro",
  ],
  tokenModifiers: ["declaration", "readonly"],
};

let workspaceRoot = "";
let projectIndex: GmlProjectIndex = buildGmlProjectIndex("", []);

type ToolkitDiagnostic = {
  range: Location["range"];
  severity: DiagnosticSeverity;
  message: string;
  source: string;
  code: string;
};

connection.onInitialize((params: InitializeParams): InitializeResult => {
  workspaceRoot = params.workspaceFolders?.[0]?.uri
    ? fileURLToPath(params.workspaceFolders[0].uri)
    : params.rootUri
      ? fileURLToPath(params.rootUri)
      : "";
  return {
    capabilities: {
      textDocumentSync: TextDocumentSyncKind.Incremental,
      completionProvider: { triggerCharacters: [".", "_", "("] },
      hoverProvider: true,
      signatureHelpProvider: { triggerCharacters: ["(", ","] },
      definitionProvider: true,
      referencesProvider: true,
      renameProvider: { prepareProvider: true },
      documentSymbolProvider: true,
      workspaceSymbolProvider: true,
      semanticTokensProvider: {
        legend: semanticLegend,
        full: true,
      },
    },
  };
});

connection.onInitialized(() => {
  void rebuildProjectIndex();
});

documents.onDidOpen((event) => void validateDocument(event.document));
documents.onDidChangeContent((event) => void validateDocument(event.document));
documents.onDidClose((event) =>
  connection.sendDiagnostics({ uri: event.document.uri, diagnostics: [] }),
);

connection.onCompletion(async (params) => {
  const document = documents.get(params.textDocument.uri);
  const context = document
    ? completionContext(document, params.position.line, params.position.character)
    : "";
  await ensureProjectIndex();
  return [
    ...projectIndex.resources.map((resource) => ({
      label: resource.name,
      kind: CompletionItemKind.Value,
      detail: `${resource.type}${resource.parentName ? ` parent ${resource.parentName}` : ""}`,
      documentation: resource.file,
      sortText: resourceSortText(context, resource.type),
    })),
    ...projectIndex.symbols
      .filter((symbol) => symbol.kind !== "resource")
      .map((symbol) => ({
        label: symbol.name,
        kind: completionKind(symbol),
        detail: symbol.detail ?? symbol.kind,
        documentation: symbol.file,
        sortText: symbol.kind === "builtin" ? "30" : "20",
      })),
    ...projectIndex.inferredTypes.map((type) => ({
      label: type.name,
      kind:
        type.type === "string" || type.type === "number"
          ? CompletionItemKind.Variable
          : CompletionItemKind.Value,
      detail: `${type.type} inferred from ${type.detail}`,
      documentation: `${type.file}:${type.line}`,
      sortText: "25",
    })),
  ];
});

connection.onHover(async (params: TextDocumentPositionParams): Promise<Hover | null> => {
  const document = documents.get(params.textDocument.uri);
  if (!document) return null;
  const word = wordAt(document, params.position.line, params.position.character);
  const builtin = findBuiltin(word);
  if (builtin) {
    return {
      contents: {
        kind: MarkupKind.Markdown,
        value: builtinMarkdown(builtin),
      },
    };
  }
  await ensureProjectIndex();
  const symbol = findSymbol(projectIndex, word);
  const references = referencesFor(projectIndex, word);
  const inferred = projectIndex.inferredTypes.find((type) => type.name === word);
  return symbol
    ? {
        contents: {
          kind: MarkupKind.Markdown,
          value: [
            `**${symbol.name}**`,
            "",
            symbol.detail ?? symbol.kind,
            symbol.resourceType ? `\nResource type: \`${symbol.resourceType}\`` : "",
            inferred ? `\nInferred as: \`${inferred.type}\` (${inferred.detail})` : "",
            references.length ? `\nReferences found: ${references.length}` : "",
          ]
            .filter(Boolean)
            .join("\n"),
        },
      }
    : null;
});

connection.onSignatureHelp((params): SignatureHelp | null => {
  const document = documents.get(params.textDocument.uri);
  if (!document) return null;
  const call = callContext(document, params.position.line, params.position.character);
  if (!call) return null;
  const builtin = findBuiltin(call.name);
  if (!builtin || builtin.kind !== "function") return null;
  return {
    signatures: [
      SignatureInformation.create(
        builtin.signature,
        builtin.description,
        ...(builtin.parameters ?? []).map((parameter) => ParameterInformation.create(parameter)),
      ),
    ],
    activeSignature: 0,
    activeParameter: call.argumentIndex,
  };
});

connection.onDefinition(async (params) => {
  const document = documents.get(params.textDocument.uri);
  if (!document) return null;
  await ensureProjectIndex();
  const symbol = findSymbol(
    projectIndex,
    wordAt(document, params.position.line, params.position.character),
  );
  return symbol && symbol.file !== "<builtin>" ? locationFor(symbol) : null;
});

connection.onReferences(async (params) => {
  const document = documents.get(params.textDocument.uri);
  if (!document) return [];
  await ensureProjectIndex();
  const word = wordAt(document, params.position.line, params.position.character);
  return referencesFor(projectIndex, word).map(locationFor);
});

connection.onPrepareRename(async (params) => {
  const document = documents.get(params.textDocument.uri);
  if (!document) return null;
  const word = wordAt(document, params.position.line, params.position.character);
  if (!word || findBuiltin(word)) return null;
  await ensureProjectIndex();
  const symbol = findSymbol(projectIndex, word);
  if (!symbol && referencesFor(projectIndex, word).length === 0) return null;
  return rangeForWord(document, params.position.line, params.position.character);
});

connection.onRenameRequest(async (params: RenameParams) => {
  const document = documents.get(params.textDocument.uri);
  if (!document || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(params.newName)) return null;
  const oldName = wordAt(document, params.position.line, params.position.character);
  await ensureProjectIndex();
  const locations = [
    ...referencesFor(projectIndex, oldName),
    ...projectIndex.symbols.filter(
      (symbol) => symbol.name === oldName && symbol.file !== "<builtin>",
    ),
  ];
  const changes: Record<string, Array<{ range: Location["range"]; newText: string }>> = {};
  for (const symbol of dedupeLocations(locations)) {
    const uri = pathToFileURL(symbol.file).href;
    const list = changes[uri] ?? [];
    list.push({ range: rangeFor(symbol), newText: params.newName });
    changes[uri] = list;
  }
  return { changes };
});

connection.onDocumentSymbol((params) => {
  const document = documents.get(params.textDocument.uri);
  if (!document) return [];
  return collectDocumentSymbols(document);
});

connection.onWorkspaceSymbol(async (params: WorkspaceSymbolParams) => {
  await ensureProjectIndex();
  const query = params.query.toLowerCase();
  return projectIndex.symbols
    .filter((symbol) => !query || symbol.name.toLowerCase().includes(query))
    .slice(0, 500)
    .map((symbol) =>
      SymbolInformation.create(
        symbol.name,
        symbolKind(symbol),
        symbol.file === "<builtin>"
          ? Location.create("gml:builtin", rangeFor(symbol)).range
          : locationFor(symbol).range,
        symbol.file === "<builtin>" ? "gml:builtin" : pathToFileURL(symbol.file).href,
        symbol.detail ?? symbol.kind,
      ),
    );
});

connection.languages.semanticTokens.on(async (params) => {
  const document = documents.get(params.textDocument.uri);
  const builder = new SemanticTokensBuilder();
  if (!document) return builder.build();
  await ensureProjectIndex();
  const lines = document.getText().split(/\r?\n/);
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    for (const token of semanticTokensForLine(lines[lineIndex], projectIndex)) {
      builder.push(
        lineIndex,
        token.start,
        token.length,
        semanticLegend.tokenTypes.indexOf(token.type),
        token.modifiers ?? 0,
      );
    }
  }
  return builder.build();
});

async function validateDocument(document: TextDocument): Promise<void> {
  if (!isGmlUri(document.uri)) return;
  const report = await analyzeGmlSource(document.getText());
  const diagnostics: ToolkitDiagnostic[] = report.findings
    .filter((finding) => finding.severity !== "info")
    .map((finding) => ({
      range: {
        start: { line: Math.max(0, finding.line - 1), character: Math.max(0, finding.column - 1) },
        end: {
          line: Math.max(0, (finding.endLine ?? finding.line) - 1),
          character: Math.max(1, finding.endColumn ?? finding.column),
        },
      },
      severity:
        finding.severity === "error" ? DiagnosticSeverity.Error : DiagnosticSeverity.Warning,
      message: finding.message,
      source: "GameMaker Toolkit",
      code: finding.code,
    }));
  const file = uriToPath(document.uri);
  for (const reference of projectIndex.unresolvedReferences.filter(
    (candidate) => candidate.file === file,
  )) {
    const suggestions =
      reference.suggestions && reference.suggestions.length
        ? reference.suggestions
        : closestResourceNames(projectIndex, reference.name);
    diagnostics.push({
      range: {
        start: {
          line: Math.max(0, reference.line - 1),
          character: Math.max(0, reference.column - 1),
        },
        end: {
          line: Math.max(0, reference.line - 1),
          character: Math.max(0, reference.column - 1 + reference.name.length),
        },
      },
      severity: DiagnosticSeverity.Warning,
      message: suggestions.length
        ? `GameMaker resource "${reference.name}" was not found. Did you mean ${suggestions.join(", ")}?`
        : `GameMaker resource "${reference.name}" was not found in this project.`,
      source: "GameMaker Toolkit",
      code: "unresolved-resource",
    });
  }
  for (const mismatch of projectIndex.graph.resourceTypeMismatches.filter(
    (candidate) => candidate.file === file,
  )) {
    diagnostics.push({
      range: {
        start: { line: Math.max(0, mismatch.line - 1), character: 0 },
        end: { line: Math.max(0, mismatch.line - 1), character: 1 },
      },
      severity: DiagnosticSeverity.Warning,
      message: `Resource "${mismatch.name}" looks like a ${mismatch.actual}, but this call expects ${mismatch.expected}.`,
      source: "GameMaker Toolkit",
      code: "resource-type-mismatch",
    });
  }
  diagnostics.push(...argumentCountDiagnostics(document));
  diagnostics.push(...eventAwareDiagnostics(document));
  for (const lifecycle of projectIndex.graph.maybeUninitializedVariables.filter((entry) =>
    entry.readFiles.includes(file),
  )) {
    diagnostics.push({
      range: {
        start: { line: 0, character: 0 },
        end: { line: 0, character: 1 },
      },
      severity: DiagnosticSeverity.Warning,
      message: `Variable "${lifecycle.variable}" is read in ${lifecycle.objectName} but was not obviously initialized in its Create event.`,
      source: "GameMaker Toolkit",
      code: "maybe-uninitialized-instance-variable",
    });
  }
  connection.sendDiagnostics({ uri: document.uri, diagnostics });
}

function argumentCountDiagnostics(document: TextDocument): ToolkitDiagnostic[] {
  const diagnostics: ToolkitDiagnostic[] = [];
  const lines = document.getText().split(/\r?\n/);
  lines.forEach((line, lineIndex) => {
    const code = stripLineComment(line);
    for (const match of code.matchAll(/\b([A-Za-z_][A-Za-z0-9_]*)\s*\(([^;\n]*)\)/g)) {
      const builtin = findBuiltin(match[1]);
      if (!builtin || builtin.kind !== "function") continue;
      const args = splitArguments(match[2]).filter((arg) => arg.trim().length > 0);
      const expected = expectedArgumentCount(builtin);
      if (args.length >= expected.min && args.length <= expected.max) continue;
      diagnostics.push({
        range: {
          start: { line: lineIndex, character: match.index ?? 0 },
          end: { line: lineIndex, character: (match.index ?? 0) + match[1].length },
        },
        severity: DiagnosticSeverity.Warning,
        message: `${builtin.name} expects ${expected.min === expected.max ? expected.min : `${expected.min}-${expected.max}`} argument(s): ${(builtin.parameters ?? []).join(", ")}. You passed ${args.length}.`,
        source: "GameMaker Toolkit",
        code: "argument-count",
      });
    }
  });
  return diagnostics;
}

function eventAwareDiagnostics(document: TextDocument): ToolkitDiagnostic[] {
  const event = eventFromPath(uriToPath(document.uri));
  if (!event) return [];
  const diagnostics: ToolkitDiagnostic[] = [];
  const lines = document.getText().split(/\r?\n/);
  lines.forEach((line, lineIndex) => {
    const code = stripLineComment(line);
    const range = {
      start: { line: lineIndex, character: Math.max(0, line.search(/\S/)) },
      end: { line: lineIndex, character: Math.max(1, line.length) },
    };
    if (event.eventPrefix.toLowerCase() === "step") {
      if (/\bdraw_(?:sprite|text|set_|rectangle|line)\b/.test(code)) {
        diagnostics.push({
          range,
          severity: DiagnosticSeverity.Warning,
          message:
            "This is a Step event, so it runs every frame for logic. Draw calls usually belong in a Draw event.",
          source: "GameMaker Toolkit",
          code: "draw-call-in-step",
        });
      }
      if (/\b(?:ds_grid_create|surface_create|buffer_create|asset_get_index)\s*\(/.test(code)) {
        diagnostics.push({
          range,
          severity: DiagnosticSeverity.Warning,
          message:
            "This line is in a Step event and may run many times per second. Creating or looking up resources every frame can become expensive.",
          source: "GameMaker Toolkit",
          code: "expensive-step-operation",
        });
      }
      if (/\bshow_debug_message\s*\(/.test(code)) {
        diagnostics.push({
          range,
          severity: DiagnosticSeverity.Warning,
          message:
            "show_debug_message inside Step can print every frame. Put it behind a condition if this is not intentional.",
          source: "GameMaker Toolkit",
          code: "debug-message-in-step",
        });
      }
    }
    if (
      event.eventPrefix.toLowerCase() === "draw" &&
      /\binstance_create_(?:layer|depth)\s*\(/.test(code)
    ) {
      diagnostics.push({
        range,
        severity: DiagnosticSeverity.Warning,
        message:
          "This is a Draw event. Creating instances while drawing can create many objects unexpectedly.",
        source: "GameMaker Toolkit",
        code: "instance-create-in-draw",
      });
    }
  });
  return diagnostics;
}

async function ensureProjectIndex(): Promise<void> {
  if (projectIndex.root || !workspaceRoot) return;
  await rebuildProjectIndex();
}

async function rebuildProjectIndex(): Promise<void> {
  if (!workspaceRoot) return;
  const filePaths = await findProjectFiles(workspaceRoot);
  const files: GmlProjectFile[] = [];
  for (const filePath of filePaths) {
    try {
      files.push({ path: filePath, content: await readFile(filePath, "utf8") });
    } catch {
      // Ignore files that changed during indexing.
    }
  }
  projectIndex = buildGmlProjectIndex(workspaceRoot, files);
  for (const document of documents.all()) {
    void validateDocument(document);
  }
}

async function findProjectFiles(root: string): Promise<string[]> {
  const entries = await readdir(root);
  const files: string[] = [];
  for (const entry of entries) {
    if (entry === "node_modules" || entry === ".git" || entry === "dist") continue;
    const fullPath = path.join(root, entry);
    const info = await stat(fullPath);
    if (info.isDirectory()) files.push(...(await findProjectFiles(fullPath)));
    else if (/\.(?:gml|yy|yyp)$/i.test(entry)) files.push(fullPath);
  }
  return files;
}

function collectDocumentSymbols(document: TextDocument): SymbolInformation[] {
  const symbols: SymbolInformation[] = [];
  const file = uriToPath(document.uri);
  document
    .getText()
    .split(/\r?\n/)
    .forEach((line, index) => {
      const candidates: Array<{
        match: RegExpMatchArray | null;
        kind: SymbolKind;
        container: string;
      }> = [
        {
          match: line.match(/^\s*function\s+([A-Za-z_][A-Za-z0-9_]*)/),
          kind: SymbolKind.Function,
          container: "function",
        },
        {
          match: line.match(/^\s*#macro\s+([A-Za-z_][A-Za-z0-9_]*)/),
          kind: SymbolKind.Constant,
          container: "macro",
        },
        {
          match: line.match(/^\s*enum\s+([A-Za-z_][A-Za-z0-9_]*)/),
          kind: SymbolKind.Enum,
          container: "enum",
        },
      ];
      for (const candidate of candidates) {
        if (!candidate.match) continue;
        symbols.push(
          SymbolInformation.create(
            candidate.match[1],
            candidate.kind,
            {
              start: { line: index, character: Math.max(0, line.indexOf(candidate.match[1])) },
              end: {
                line: index,
                character: Math.max(
                  0,
                  line.indexOf(candidate.match[1]) + candidate.match[1].length,
                ),
              },
            },
            pathToFileURL(file).href,
            candidate.container,
          ),
        );
      }
    });
  return symbols;
}

function semanticTokensForLine(
  line: string,
  index: GmlProjectIndex,
): Array<{ start: number; length: number; type: string; modifiers?: number }> {
  const tokens: Array<{ start: number; length: number; type: string; modifiers?: number }> = [];
  const commentIndex = line.indexOf("//");
  const code = commentIndex === -1 ? line : line.slice(0, commentIndex);
  const addToken = (start: number, length: number, type: string, modifiers?: number) => {
    if (length <= 0) return;
    tokens.push({ start, length, type, modifiers });
  };
  if (commentIndex !== -1) addToken(commentIndex, line.length - commentIndex, "comment");
  for (const match of code.matchAll(/"([^"\\]|\\.)*"|'([^'\\]|\\.)*'|`([^`\\]|\\.)*`/g)) {
    addToken(match.index ?? 0, match[0].length, "string");
  }
  for (const match of code.matchAll(
    /\b(?:if|else|for|while|switch|case|default|break|continue|return|function|var|static|globalvar|enum|with|repeat|do|until|try|catch|finally|new|delete|exit)\b/g,
  )) {
    addToken(match.index ?? 0, match[0].length, "keyword");
  }
  for (const match of code.matchAll(
    /\b(?:self|other|global|local|noone|undefined|true|false|all)\b/g,
  )) {
    addToken(match.index ?? 0, match[0].length, "namespace", 2);
  }
  for (const match of code.matchAll(/#macro\s+([A-Za-z_][A-Za-z0-9_]*)/g)) {
    addToken((match.index ?? 0) + match[0].indexOf(match[1]), match[1].length, "macro", 1);
  }
  for (const match of code.matchAll(/\b([A-Za-z_][A-Za-z0-9_]*)\s*\(/g)) {
    const name = match[1];
    addToken((match.index ?? 0) + match[0].indexOf(name), name.length, "function");
  }
  for (const match of code.matchAll(/-?\d+(?:\.\d+)?/g)) {
    addToken(match.index ?? 0, match[0].length, "number");
  }
  const knownSymbols = new Map(index.symbols.map((symbol) => [symbol.name, symbol]));
  for (const match of code.matchAll(/\b[A-Za-z_][A-Za-z0-9_]*\b/g)) {
    const name = match[0];
    const symbol = knownSymbols.get(name);
    if (!symbol) continue;
    const start = match.index ?? 0;
    if (symbol.kind === "resource") addToken(start, name.length, "class", 2);
    else if (symbol.kind === "builtin") addToken(start, name.length, "function", 2);
    else if (symbol.kind === "macro") addToken(start, name.length, "macro", 2);
    else if (symbol.kind === "enum") addToken(start, name.length, "enum", 2);
  }
  for (const match of code.matchAll(/\.\s*([A-Za-z_][A-Za-z0-9_]*)/g)) {
    addToken((match.index ?? 0) + match[0].lastIndexOf(match[1]), match[1].length, "property");
  }
  return tokens
    .sort((left, right) => left.start - right.start || right.length - left.length)
    .filter((token, position, sorted) => {
      const previous = sorted[position - 1];
      return !previous || token.start >= previous.start + previous.length;
    });
}

function wordAt(document: TextDocument, line: number, character: number): string {
  const text = document.getText({
    start: { line, character: 0 },
    end: { line, character: Number.MAX_SAFE_INTEGER },
  });
  let start = Math.min(character, text.length);
  let end = Math.min(character, text.length);
  while (start > 0 && /[A-Za-z0-9_]/.test(text[start - 1])) start -= 1;
  while (end < text.length && /[A-Za-z0-9_]/.test(text[end])) end += 1;
  return text.slice(start, end);
}

function rangeForWord(document: TextDocument, line: number, character: number): Location["range"] {
  const text = document.getText({
    start: { line, character: 0 },
    end: { line, character: Number.MAX_SAFE_INTEGER },
  });
  let start = Math.min(character, text.length);
  let end = Math.min(character, text.length);
  while (start > 0 && /[A-Za-z0-9_]/.test(text[start - 1])) start -= 1;
  while (end < text.length && /[A-Za-z0-9_]/.test(text[end])) end += 1;
  return { start: { line, character: start }, end: { line, character: end } };
}

function completionContext(document: TextDocument, line: number, character: number): string {
  const text = document.getText({
    start: { line, character: 0 },
    end: { line, character },
  });
  const call = text.match(/([A-Za-z_][A-Za-z0-9_]*)\s*\([^()]*$/)?.[1] ?? "";
  return call;
}

function resourceSortText(context: string, type: string): string {
  const lower = type.toLowerCase();
  if (/draw_sprite/.test(context) && lower.includes("sprite")) return "00";
  if (/instance_create/.test(context) && lower.includes("object")) return "00";
  if (/room_goto/.test(context) && lower.includes("room")) return "00";
  if (/audio_play_sound/.test(context) && lower.includes("sound")) return "00";
  return "10";
}

function callContext(
  document: TextDocument,
  line: number,
  character: number,
): { name: string; argumentIndex: number } | undefined {
  const text = document.getText({
    start: { line, character: 0 },
    end: { line, character },
  });
  const open = text.lastIndexOf("(");
  if (open === -1) return undefined;
  const before = text.slice(0, open).match(/([A-Za-z_][A-Za-z0-9_]*)\s*$/);
  if (!before) return undefined;
  return {
    name: before[1],
    argumentIndex: splitArguments(text.slice(open + 1)).length - 1,
  };
}

function splitArguments(text: string): string[] {
  if (!text.trim()) return [""];
  let depth = 0;
  let quote: string | undefined;
  const args: string[] = [""];
  for (const char of text) {
    if (quote) {
      args[args.length - 1] += char;
      if (char === quote) quote = undefined;
      continue;
    }
    if (char === '"' || char === "'" || char === "`") {
      quote = char;
      args[args.length - 1] += char;
      continue;
    }
    if (char === "(" || char === "[" || char === "{") depth += 1;
    if (char === ")" || char === "]" || char === "}") depth -= 1;
    if (char === "," && depth === 0) args.push("");
    else args[args.length - 1] += char;
  }
  return args;
}

function stripLineComment(line: string): string {
  const index = line.indexOf("//");
  return index === -1 ? line : line.slice(0, index);
}

function dedupeLocations(symbols: GmlIndexedSymbol[]): GmlIndexedSymbol[] {
  const seen = new Set<string>();
  return symbols.filter((symbol) => {
    const key = `${symbol.file}:${symbol.line}:${symbol.column}:${symbol.name}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function locationFor(symbol: GmlIndexedSymbol): Location {
  return Location.create(pathToFileURL(symbol.file).href, rangeFor(symbol));
}

function rangeFor(symbol: GmlIndexedSymbol): Location["range"] {
  return {
    start: { line: Math.max(0, symbol.line - 1), character: Math.max(0, symbol.column - 1) },
    end: {
      line: Math.max(0, symbol.line - 1),
      character: Math.max(0, symbol.column - 1 + symbol.name.length),
    },
  };
}

function completionKind(symbol: GmlIndexedSymbol): CompletionItemKind {
  if (symbol.kind === "function") return CompletionItemKind.Function;
  if (symbol.kind === "macro") return CompletionItemKind.Constant;
  if (symbol.kind === "enum") return CompletionItemKind.Enum;
  if (symbol.kind === "builtin")
    return symbol.detail?.includes("(") ? CompletionItemKind.Function : CompletionItemKind.Keyword;
  if (symbol.kind === "variable") return CompletionItemKind.Variable;
  if (symbol.kind === "field") return CompletionItemKind.Field;
  return CompletionItemKind.Value;
}

function symbolKind(symbol: GmlIndexedSymbol): SymbolKind {
  if (symbol.kind === "function") return SymbolKind.Function;
  if (symbol.kind === "macro") return SymbolKind.Constant;
  if (symbol.kind === "enum") return SymbolKind.Enum;
  if (symbol.kind === "builtin") return SymbolKind.Function;
  if (symbol.kind === "variable") return SymbolKind.Variable;
  if (symbol.kind === "field") return SymbolKind.Field;
  return SymbolKind.Object;
}

function uriToPath(uri: string): string {
  return uri.startsWith("file:") ? fileURLToPath(uri) : uri;
}

function isGmlUri(uri: string): boolean {
  return uri.toLowerCase().endsWith(".gml");
}

documents.listen(connection);
connection.listen();
