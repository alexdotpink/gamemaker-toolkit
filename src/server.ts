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
  ProposedFeatures,
  SemanticTokensBuilder,
  SemanticTokensLegend,
  SymbolInformation,
  SymbolKind,
  TextDocumentPositionParams,
  TextDocuments,
  TextDocumentSyncKind,
  WorkspaceSymbolParams,
} from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";
import { analyzeGmlSource } from "./analysis";
import { findBuiltin, GML_BUILTINS } from "./gmlKnowledge";
import {
  buildGmlProjectIndex,
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
      definitionProvider: true,
      referencesProvider: true,
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

connection.onCompletion(async () => {
  await ensureProjectIndex();
  return [
    ...projectIndex.resources.map((resource) => ({
      label: resource.name,
      kind: CompletionItemKind.Value,
      detail: resource.type,
      documentation: resource.file,
    })),
    ...projectIndex.symbols
      .filter((symbol) => symbol.kind !== "resource")
      .map((symbol) => ({
        label: symbol.name,
        kind: completionKind(symbol),
        detail: symbol.detail ?? symbol.kind,
        documentation: symbol.file,
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
        value: `**${builtin.signature}**\n\n${builtin.description}`,
      },
    };
  }
  await ensureProjectIndex();
  const symbol = findSymbol(projectIndex, word);
  return symbol
    ? {
        contents: {
          kind: MarkupKind.Markdown,
          value: `**${symbol.name}**\n\n${symbol.detail ?? symbol.kind}`,
        },
      }
    : null;
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
  const lines = document.getText().split(/\r?\n/);
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    for (const token of semanticTokensForLine(lines[lineIndex])) {
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
  const diagnostics = report.findings
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
      message: `Unresolved GameMaker resource reference: ${reference.name}`,
      source: "GameMaker Toolkit",
      code: "unresolved-resource",
    });
  }
  connection.sendDiagnostics({ uri: document.uri, diagnostics });
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
): Array<{ start: number; length: number; type: string; modifiers?: number }> {
  const tokens: Array<{ start: number; length: number; type: string; modifiers?: number }> = [];
  const commentIndex = line.indexOf("//");
  const code = commentIndex === -1 ? line : line.slice(0, commentIndex);
  if (commentIndex !== -1)
    tokens.push({ start: commentIndex, length: line.length - commentIndex, type: "comment" });
  for (const match of code.matchAll(
    /\b(?:if|else|for|while|switch|case|default|break|continue|return|function|var|static|globalvar|enum|with|repeat|do|until|try|catch|finally|new|delete|exit)\b/g,
  )) {
    tokens.push({ start: match.index ?? 0, length: match[0].length, type: "keyword" });
  }
  for (const match of code.matchAll(/#macro\s+([A-Za-z_][A-Za-z0-9_]*)/g)) {
    tokens.push({
      start: (match.index ?? 0) + match[0].indexOf(match[1]),
      length: match[1].length,
      type: "macro",
      modifiers: 1,
    });
  }
  for (const match of code.matchAll(/\b([A-Za-z_][A-Za-z0-9_]*)\s*\(/g)) {
    const name = match[1];
    tokens.push({
      start: (match.index ?? 0) + match[0].indexOf(name),
      length: name.length,
      type: "function",
    });
  }
  for (const match of code.matchAll(/-?\d+(?:\.\d+)?/g)) {
    tokens.push({ start: match.index ?? 0, length: match[0].length, type: "number" });
  }
  for (const match of code.matchAll(/"([^"\\]|\\.)*"|'([^'\\]|\\.)*'|`([^`\\]|\\.)*`/g)) {
    tokens.push({ start: match.index ?? 0, length: match[0].length, type: "string" });
  }
  return tokens.sort((left, right) => left.start - right.start);
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
  return CompletionItemKind.Value;
}

function symbolKind(symbol: GmlIndexedSymbol): SymbolKind {
  if (symbol.kind === "function") return SymbolKind.Function;
  if (symbol.kind === "macro") return SymbolKind.Constant;
  if (symbol.kind === "enum") return SymbolKind.Enum;
  if (symbol.kind === "builtin") return SymbolKind.Function;
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
