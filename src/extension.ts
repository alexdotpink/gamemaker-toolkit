import * as vscode from "vscode";
import * as path from "node:path";
import {
  LanguageClient,
  TransportKind,
  type ServerOptions,
  type LanguageClientOptions,
} from "vscode-languageclient/node";
import {
  formatGmlDocument,
  formatGmlLexicalFallback,
  getGmlFormatterDebugInfo,
  type GmlFormatOptions,
} from "./formatter";
import {
  analyzeExpressionAtText,
  analyzeGmlSource,
  simplifyExpressionText,
  type GmlAnalysisReport,
  type GmlProjectRules,
} from "./analysis";
import {
  buildGmlProjectIndex,
  eventFromPath,
  referencesFor,
  type GmlProjectFile,
  type GmlProjectIndex,
} from "./projectIndex";

const EXTENSION_ID = "alexdotpink.gamemaker-toolkit";
const PRODUCT_NAME = "GameMaker Toolkit";
const OUTPUT_CHANNEL_NAME = "GameMaker Toolkit";

let languageClient: LanguageClient | undefined;

const GML_DOCUMENT_SELECTORS: vscode.DocumentFilter[] = [
  { pattern: "**/*.gml" },
  { pattern: "**/*.GML" },
  { language: "*", pattern: "**/*.gml" },
  { language: "*", pattern: "**/*.GML" },
  { scheme: "file", pattern: "**/*.gml" },
  { scheme: "file", pattern: "**/*.GML" },
  { scheme: "untitled", pattern: "**/*.gml" },
  { scheme: "untitled", pattern: "**/*.GML" },
  { language: "gml", scheme: "file" },
  { language: "gml", scheme: "untitled" },
  { language: "gamemaker", scheme: "file" },
  { language: "gamemaker", scheme: "untitled" },
  { language: "gamemaker-language", scheme: "file" },
  { language: "gamemaker-language", scheme: "untitled" },
  { language: "gml-gamemaker", scheme: "file" },
  { language: "gml-gamemaker", scheme: "untitled" },
];

export function activate(context: vscode.ExtensionContext): void {
  languageClient = startLanguageServer(context);
  const diagnostics = vscode.languages.createDiagnosticCollection("gmlFormatter");
  const projectDiagnostics = vscode.languages.createDiagnosticCollection("gmlProject");
  const output = vscode.window.createOutputChannel(OUTPUT_CHANNEL_NAME);
  const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 90);
  const projectIndexState: { index?: GmlProjectIndex; builtAt?: number } = {};
  statusBar.command = "gmlFormatter.diagnoseSetup";
  statusBar.tooltip = PRODUCT_NAME;
  const provider = vscode.languages.registerDocumentFormattingEditProvider(GML_DOCUMENT_SELECTORS, {
    async provideDocumentFormattingEdits(document, options) {
      return createFormattingEdits(document, options, diagnostics, output, {
        showParserErrors: true,
      });
    },
  });
  const rangeProvider = vscode.languages.registerDocumentRangeFormattingEditProvider(
    GML_DOCUMENT_SELECTORS,
    {
      async provideDocumentRangeFormattingEdits(document, range, options) {
        return createRangeFormattingEdits(document, range, options, diagnostics, output, {
          showParserErrors: true,
        });
      },
    },
  );

  const command = vscode.commands.registerTextEditorCommand(
    "gmlFormatter.formatDocument",
    async (editor) => {
      if (!isSupportedGmlDocument(editor.document)) {
        await vscode.window.showWarningMessage(
          `${PRODUCT_NAME} can only format .gml documents. Current language: ${editor.document.languageId}.`,
        );
        return;
      }

      const edit = new vscode.WorkspaceEdit();
      for (const textEdit of await createFormattingEdits(
        editor.document,
        editor.options,
        diagnostics,
        output,
        { showParserErrors: true },
      )) {
        edit.replace(editor.document.uri, textEdit.range, textEdit.newText);
      }
      await vscode.workspace.applyEdit(edit);
    },
  );
  const debugCommand = vscode.commands.registerTextEditorCommand(
    "gmlFormatter.showDebugInfo",
    async (editor) => {
      const debugInfo = await getGmlFormatterDebugInfo(editor.document.getText());
      const lines = [
        `${PRODUCT_NAME} Debug Info`,
        "",
        `Extension: ${EXTENSION_ID}`,
        `Document: ${editor.document.fileName}`,
        `Language ID: ${editor.document.languageId}`,
        `Root CST node: ${debugInfo.rootNode}`,
        `Top-level statements: ${debugInfo.topLevelStatements}`,
        `Parser tokens: ${debugInfo.tokenCount}`,
        `Parser errors: ${debugInfo.parserErrors.length}`,
        `Comments: ${debugInfo.comments.length}`,
        `Comment attachments: ${debugInfo.commentAttachments.length}`,
        `Semantic signature tokens: ${debugInfo.semanticSignature.length}`,
        "",
      ];
      if (debugInfo.parserErrors.length > 0) {
        lines.push(
          "Errors:",
          ...debugInfo.parserDiagnostics.map(
            (error) => `- ${error.line}:${error.column} ${error.message}`,
          ),
          "",
        );
      }
      if (debugInfo.commentAttachments.length > 0) {
        lines.push(
          "Comment Attachments:",
          ...debugInfo.commentAttachments.map(
            (comment) => `- ${comment.line} ${comment.attachment} ${comment.text}`,
          ),
          "",
        );
      }
      lines.push("Normalized AST:", ...debugInfo.normalizedAstSummary);
      const document = await vscode.workspace.openTextDocument({
        language: "plaintext",
        content: lines.join("\n"),
      });
      await vscode.window.showTextDocument(document, { preview: true });
    },
  );
  const lexicalFallbackCommand = vscode.commands.registerTextEditorCommand(
    "gmlFormatter.formatWithLexicalFallback",
    async (editor) => {
      const answer = await vscode.window.showWarningMessage(
        "Lexical fallback formatting does not fully understand GML syntax. Use it only for damaged snippets.",
        { modal: true },
        "Format Anyway",
      );
      if (answer !== "Format Anyway") return;
      const edit = new vscode.WorkspaceEdit();
      edit.replace(
        editor.document.uri,
        new vscode.Range(
          editor.document.positionAt(0),
          editor.document.positionAt(editor.document.getText().length),
        ),
        formatGmlLexicalFallback(
          editor.document.getText(),
          getFormatterOptions(editor.document, editor.options),
        ),
      );
      await vscode.workspace.applyEdit(edit);
    },
  );
  const defaultFormatterCommand = vscode.commands.registerTextEditorCommand(
    "gmlFormatter.configureDefaultFormatter",
    async (editor) => {
      const languageId = editor.document.languageId || "gml";
      const target = vscode.workspace.workspaceFolders?.length
        ? vscode.ConfigurationTarget.Workspace
        : vscode.ConfigurationTarget.Global;
      await vscode.workspace
        .getConfiguration()
        .update(`[${languageId}]`, { "editor.defaultFormatter": EXTENSION_ID }, target);
      void vscode.window.showInformationMessage(
        `${PRODUCT_NAME} is now the default formatter for language ID "${languageId}".`,
      );
    },
  );
  const diagnoseCommand = vscode.commands.registerTextEditorCommand(
    "gmlFormatter.diagnoseSetup",
    async (editor) => {
      await showSetupDiagnostics(editor.document, output);
    },
  );
  const explainSkippedCommand = vscode.commands.registerTextEditorCommand(
    "gmlFormatter.explainSkippedFormat",
    async (editor) => {
      await explainFormattingResult(editor.document, editor.options, output);
    },
  );
  const explainProblemCommand = vscode.commands.registerTextEditorCommand(
    "gmlFormatter.explainProblem",
    async (editor) => {
      await explainProblemAtCursor(editor);
    },
  );
  const diffCommand = vscode.commands.registerTextEditorCommand(
    "gmlFormatter.formatAndShowDiff",
    async (editor) => {
      await showFormattedDiff(editor.document, editor.options, output);
    },
  );
  const previewCommand = vscode.commands.registerTextEditorCommand(
    "gmlFormatter.previewFormatChanges",
    async (editor) => {
      await showFormatPreview(editor.document, editor.options);
    },
  );
  const dryRunCommand = vscode.commands.registerCommand(
    "gmlFormatter.workspaceDryRun",
    async () => {
      await runWorkspaceDryRun(output);
    },
  );
  const playgroundCommand = vscode.commands.registerCommand(
    "gmlFormatter.openPlayground",
    async () => {
      await openPlayground(context, output);
    },
  );
  const analyzeCommand = vscode.commands.registerTextEditorCommand(
    "gmlFormatter.analyzeCurrentFile",
    async (editor) => {
      await showAnalysisReport(editor.document);
    },
  );
  const projectDoctorCommand = vscode.commands.registerCommand(
    "gmlFormatter.projectDoctor",
    async () => {
      await showProjectDoctor(projectIndexState);
    },
  );
  const explainExpressionCommand = vscode.commands.registerTextEditorCommand(
    "gmlFormatter.explainExpression",
    async (editor) => {
      await showExpressionExplanation(editor);
    },
  );
  const simplifyExpressionCommand = vscode.commands.registerTextEditorCommand(
    "gmlFormatter.simplifyExpression",
    async (editor) => {
      await simplifySelectedExpression(editor);
    },
  );
  const sceneNotesCommand = vscode.commands.registerTextEditorCommand(
    "gmlFormatter.generateSceneNotes",
    async (editor) => {
      const report = await analyzeGmlSource(
        editor.document.getText(),
        getAnalysisOptions(editor.document),
      );
      const document = await vscode.workspace.openTextDocument({
        language: "markdown",
        content: report.sceneNotesMarkdown,
      });
      await vscode.window.showTextDocument(document, { preview: true });
    },
  );
  const stateMachineCommand = vscode.commands.registerTextEditorCommand(
    "gmlFormatter.analyzeStateMachine",
    async (editor) => {
      const report = await analyzeGmlSource(
        editor.document.getText(),
        getAnalysisOptions(editor.document),
      );
      const content = report.stateMachines.length
        ? report.stateMachines
            .map((machine) =>
              [
                `# State Machine: ${machine.variable}`,
                "",
                "```mermaid",
                machine.mermaid,
                "```",
                "",
                ...machine.warnings.map((warning) => `- ${warning}`),
              ].join("\n"),
            )
            .join("\n\n")
        : "No obvious state machine switch found.";
      const document = await vscode.workspace.openTextDocument({ language: "markdown", content });
      await vscode.window.showTextDocument(document, { preview: true });
    },
  );
  const sceneFlowCommand = vscode.commands.registerTextEditorCommand(
    "gmlFormatter.openSceneFlowView",
    async (editor) => {
      await openSceneFlowView(context, editor.document);
    },
  );
  const projectMapCommand = vscode.commands.registerCommand(
    "gmlFormatter.openProjectMap",
    async () => {
      await openProjectMap(context, projectIndexState);
    },
  );
  const rebuildProjectIndexCommand = vscode.commands.registerCommand(
    "gmlFormatter.rebuildProjectIndex",
    async () => {
      projectIndexState.index = await buildWorkspaceProjectIndex();
      projectIndexState.builtAt = Date.now();
      await updateProjectDiagnostics(projectIndexState.index, projectDiagnostics);
      void vscode.window.showInformationMessage(
        `GML project index rebuilt: ${projectIndexState.index.resources.length} resources, ${projectIndexState.index.symbols.length} symbols.`,
      );
    },
  );
  const goToResourceCommand = vscode.commands.registerCommand(
    "gmlFormatter.goToResource",
    async () => {
      const index = await ensureProjectIndex(projectIndexState);
      const picked = await vscode.window.showQuickPick(
        index.resources.map((resource) => ({
          label: resource.name,
          description: resource.type,
          detail: resource.file,
          resource,
        })),
        { placeHolder: "Open GameMaker resource" },
      );
      if (!picked) return;
      const document = await vscode.workspace.openTextDocument(
        vscode.Uri.file(picked.resource.file),
      );
      await vscode.window.showTextDocument(document, { preview: true });
    },
  );
  const exportDialogueCommand = vscode.commands.registerTextEditorCommand(
    "gmlFormatter.exportDialogueCsv",
    async (editor) => {
      const report = await analyzeGmlSource(
        editor.document.getText(),
        getAnalysisOptions(editor.document),
      );
      const csv = dialogueCsv(report);
      const document = await vscode.workspace.openTextDocument({ language: "csv", content: csv });
      await vscode.window.showTextDocument(document, { preview: true });
    },
  );
  const previewSafeCleanupCommand = vscode.commands.registerTextEditorCommand(
    "gmlFormatter.previewSafeCleanup",
    async (editor) => {
      await previewSafeCleanup(editor.document, editor.options);
    },
  );
  const applySafeCleanupCommand = vscode.commands.registerTextEditorCommand(
    "gmlFormatter.applySafeCleanup",
    async (editor) => {
      await applySafeCleanup(editor, editor.options);
    },
  );
  const makeReadableCommand = vscode.commands.registerTextEditorCommand(
    "gmlFormatter.makeCodeReadable",
    async (editor) => {
      await previewReadabilityUpgrade(editor.document, editor.options);
    },
  );
  const explainFileCommand = vscode.commands.registerTextEditorCommand(
    "gmlFormatter.explainCurrentFile",
    async (editor) => {
      await explainCurrentFile(editor.document);
    },
  );
  const reportFormatterBugCommand = vscode.commands.registerTextEditorCommand(
    "gmlFormatter.reportFormatterBug",
    async (editor) => {
      await reportFormatterBug(editor.document, editor.options);
    },
  );
  const installDoctorCommand = vscode.commands.registerTextEditorCommand(
    "gmlFormatter.installDoctor",
    async (editor) => {
      await showInstallDoctor(editor.document);
    },
  );
  const objectEventMapCommand = vscode.commands.registerCommand(
    "gmlFormatter.openObjectEventMap",
    async () => {
      await openObjectEventMap(projectIndexState);
    },
  );
  const cutsceneTimelineCommand = vscode.commands.registerTextEditorCommand(
    "gmlFormatter.openCutsceneTimeline",
    async (editor) => {
      await openCutsceneTimeline(editor.document);
    },
  );
  const stateEnumPreviewCommand = vscode.commands.registerTextEditorCommand(
    "gmlFormatter.previewStateEnum",
    async (editor) => {
      await previewStateEnum(editor.document);
    },
  );
  const resourceRenamePreviewCommand = vscode.commands.registerCommand(
    "gmlFormatter.previewResourceRename",
    async () => {
      await previewResourceRename(projectIndexState);
    },
  );
  const globalsReportCommand = vscode.commands.registerCommand(
    "gmlFormatter.openGlobalsReport",
    async () => {
      await openGlobalsReport(projectIndexState);
    },
  );
  const minimizeBugCommand = vscode.commands.registerTextEditorCommand(
    "gmlFormatter.minimizeFormatterBug",
    async (editor) => {
      await minimizeFormatterBug(editor.document, editor.options);
    },
  );
  const codeActionsProvider = vscode.languages.registerCodeActionsProvider(
    GML_DOCUMENT_SELECTORS,
    {
      provideCodeActions(document, range) {
        return createSmartCodeActions(document, range);
      },
    },
    {
      providedCodeActionKinds: [
        vscode.CodeActionKind.RefactorRewrite,
        vscode.CodeActionKind.QuickFix,
      ],
    },
  );
  const codeLensProvider = vscode.languages.registerCodeLensProvider(GML_DOCUMENT_SELECTORS, {
    async provideCodeLenses(document) {
      return createGmlCodeLenses(document);
    },
  });

  const validateActiveDocument = vscode.window.onDidChangeActiveTextEditor(async (editor) => {
    if (editor && isSupportedGmlDocument(editor.document)) {
      updateStatusBar(editor.document, statusBar);
      void maybeShowOnboarding(context, editor.document);
    } else {
      statusBar.hide();
    }
  });
  const validateChangedDocument = vscode.workspace.onDidChangeTextDocument(async (event) => {
    if (isSupportedGmlDocument(event.document)) {
      updateStatusBar(event.document, statusBar);
    }
  });
  if (
    vscode.window.activeTextEditor &&
    isSupportedGmlDocument(vscode.window.activeTextEditor.document)
  ) {
    updateStatusBar(vscode.window.activeTextEditor.document, statusBar);
    void maybeShowOnboarding(context, vscode.window.activeTextEditor.document);
  }
  void ensureProjectIndex(projectIndexState).then((index) =>
    updateProjectDiagnostics(index, projectDiagnostics),
  );

  context.subscriptions.push(
    diagnostics,
    projectDiagnostics,
    output,
    statusBar,
    provider,
    rangeProvider,
    command,
    lexicalFallbackCommand,
    debugCommand,
    defaultFormatterCommand,
    diagnoseCommand,
    explainSkippedCommand,
    explainProblemCommand,
    diffCommand,
    previewCommand,
    dryRunCommand,
    playgroundCommand,
    analyzeCommand,
    projectDoctorCommand,
    explainExpressionCommand,
    simplifyExpressionCommand,
    sceneNotesCommand,
    stateMachineCommand,
    sceneFlowCommand,
    projectMapCommand,
    rebuildProjectIndexCommand,
    goToResourceCommand,
    exportDialogueCommand,
    previewSafeCleanupCommand,
    applySafeCleanupCommand,
    makeReadableCommand,
    explainFileCommand,
    reportFormatterBugCommand,
    installDoctorCommand,
    objectEventMapCommand,
    cutsceneTimelineCommand,
    stateEnumPreviewCommand,
    resourceRenamePreviewCommand,
    globalsReportCommand,
    minimizeBugCommand,
    codeActionsProvider,
    codeLensProvider,
    validateActiveDocument,
    validateChangedDocument,
  );
}

export function deactivate(): void {
  void languageClient?.stop();
}

function startLanguageServer(context: vscode.ExtensionContext): LanguageClient {
  const serverModule = context.asAbsolutePath(path.join("dist", "server.js"));
  const serverOptions: ServerOptions = {
    run: { module: serverModule, transport: TransportKind.ipc },
    debug: { module: serverModule, transport: TransportKind.ipc },
  };
  const clientOptions: LanguageClientOptions = {
    documentSelector: ["gml", "gamemaker", "gamemaker-language", "gml-gamemaker"],
    synchronize: {
      fileEvents: vscode.workspace.createFileSystemWatcher("**/*.{gml,yy,yyp}"),
    },
  };
  const client = new LanguageClient("gamemakerToolkit", PRODUCT_NAME, serverOptions, clientOptions);
  void client.start();
  context.subscriptions.push(client);
  return client;
}

function createFormattingEdits(
  document: vscode.TextDocument,
  options: vscode.FormattingOptions | vscode.TextEditorOptions,
  diagnostics: vscode.DiagnosticCollection,
  output: vscode.OutputChannel,
  commandOptions: {
    showParserErrors: boolean;
  },
): Thenable<vscode.TextEdit[]> {
  return createFormattingEditsAsync(document, options, diagnostics, output, commandOptions);
}

async function createFormattingEditsAsync(
  document: vscode.TextDocument,
  options: vscode.FormattingOptions | vscode.TextEditorOptions,
  diagnostics: vscode.DiagnosticCollection,
  output: vscode.OutputChannel,
  commandOptions: {
    showParserErrors: boolean;
  },
): Promise<vscode.TextEdit[]> {
  const config = vscode.workspace.getConfiguration("gmlFormatter", document.uri);
  const formatterOptions = getFormatterOptions(document, options);

  const fullRange = new vscode.Range(
    document.positionAt(0),
    document.positionAt(document.getText().length),
  );

  const result = await formatGmlDocument(document.getText(), formatterOptions);
  if (result.parserErrors.length > 0) {
    setDiagnostics(document, diagnostics, result.parserDiagnostics);
    output.appendLine(`[skip:parse] ${document.fileName}`);
    output.appendLine(`  ${result.parserErrors[0]}`);
    if (commandOptions.showParserErrors) {
      await vscode.window.showWarningMessage(
        `${PRODUCT_NAME} skipped this file because @bscotch/gml-parser reported ${result.parserErrors.length} syntax error(s). First: ${result.parserErrors[0]}`,
      );
    }
    return [];
  }
  if (result.safetyErrors.length > 0) {
    output.appendLine(`[skip:safety] ${document.fileName}`);
    for (const diagnostic of result.safetyDiagnostics) output.appendLine(`  ${diagnostic}`);
    if (commandOptions.showParserErrors) {
      await vscode.window.showWarningMessage(
        `${PRODUCT_NAME} skipped this file because the safety check failed. First: ${result.safetyDiagnostics[0] ?? result.safetyErrors[0]}`,
      );
    }
    return [];
  }

  diagnostics.delete(document.uri);
  output.appendLine(
    `[format] ${document.fileName}${result.changed ? " changed" : " already formatted"}`,
  );
  return [vscode.TextEdit.replace(fullRange, result.formatted)];
}

async function createRangeFormattingEdits(
  document: vscode.TextDocument,
  range: vscode.Range,
  options: vscode.FormattingOptions | vscode.TextEditorOptions,
  diagnostics: vscode.DiagnosticCollection,
  output: vscode.OutputChannel,
  commandOptions: {
    showParserErrors: boolean;
  },
): Promise<vscode.TextEdit[]> {
  if (range.isEmpty) {
    return createFormattingEditsAsync(document, options, diagnostics, output, commandOptions);
  }

  const formatterOptions = getFormatterOptions(document, options);
  const result = await formatGmlDocument(document.getText(range), {
    ...formatterOptions,
    mode: "snippet",
  });
  if (result.parserErrors.length > 0) {
    return createFormattingEditsAsync(document, options, diagnostics, output, commandOptions);
  }
  return [vscode.TextEdit.replace(range, result.formatted)];
}

function getFormatterOptions(
  document: vscode.TextDocument,
  options: vscode.FormattingOptions | vscode.TextEditorOptions,
): GmlFormatOptions {
  const config = vscode.workspace.getConfiguration("gmlFormatter", document.uri);
  const tabSize =
    typeof options.tabSize === "number" ? options.tabSize : Number(options.tabSize) || 4;
  const insertSpaces = typeof options.insertSpaces === "boolean" ? options.insertSpaces : true;
  return {
    indentSize: config.get("indentSize", tabSize),
    useTabs: config.get("useTabs", !insertSpaces),
    printWidth: config.get("printWidth", 100),
    trailingCommas: config.get("trailingCommas", false),
    multilineFunctionCalls: config.get("multilineFunctionCalls", "auto"),
    style: config.get("style", "readable"),
    safety: config.get("safety", "ast-and-trivia"),
    mode: config.get("mode", "file"),
    trimTrailingWhitespace: config.get("trimTrailingWhitespace", true),
    maxBlankLines: config.get("maxBlankLines", 2),
    readableSpacing: config.get("readableSpacing", true),
  };
}

function setDiagnostics(
  document: vscode.TextDocument,
  diagnostics: vscode.DiagnosticCollection,
  parserDiagnostics: Array<{
    line: number;
    column: number;
    message: string;
    severity?: vscode.DiagnosticSeverity;
  }>,
): void {
  diagnostics.set(
    document.uri,
    parserDiagnostics.map((diagnostic) => {
      const line = Math.max(0, diagnostic.line - 1);
      const column = Math.max(0, diagnostic.column - 1);
      return new vscode.Diagnostic(
        new vscode.Range(line, column, line, column + 1),
        diagnostic.message,
        diagnostic.severity ?? vscode.DiagnosticSeverity.Warning,
      );
    }),
  );
}

function isSupportedGmlDocument(document: vscode.TextDocument): boolean {
  return (
    document.fileName.toLowerCase().endsWith(".gml") ||
    GML_DOCUMENT_SELECTORS.some(
      (selector) => typeof selector === "object" && selector.language === document.languageId,
    )
  );
}

function updateStatusBar(document: vscode.TextDocument, statusBar: vscode.StatusBarItem): void {
  if (!isSupportedGmlDocument(document)) {
    statusBar.hide();
    return;
  }
  const config = vscode.workspace.getConfiguration(undefined, document.uri);
  const languageConfig = config.get<Record<string, unknown>>(`[${document.languageId}]`);
  const defaultFormatter = languageConfig?.["editor.defaultFormatter"];
  statusBar.text =
    defaultFormatter === EXTENSION_ID ? `$(check) ${PRODUCT_NAME}` : `$(warning) ${PRODUCT_NAME}`;
  statusBar.tooltip =
    defaultFormatter === EXTENSION_ID
      ? `${PRODUCT_NAME} is the default formatter for this language ID.`
      : `${PRODUCT_NAME} is available, but defaultFormatter for "${document.languageId}" is ${String(defaultFormatter ?? "not set")}.`;
  statusBar.show();
}

async function showSetupDiagnostics(
  document: vscode.TextDocument,
  output: vscode.OutputChannel,
): Promise<void> {
  const config = vscode.workspace.getConfiguration(undefined, document.uri);
  const languageConfig = config.get<Record<string, unknown>>(`[${document.languageId}]`);
  const defaultFormatter = languageConfig?.["editor.defaultFormatter"];
  const formatterConfig = vscode.workspace.getConfiguration("gmlFormatter", document.uri);
  const lines = [
    `${PRODUCT_NAME} Setup Diagnostics`,
    "",
    `File: ${document.fileName}`,
    `Language ID: ${document.languageId}`,
    `Is .gml: ${document.fileName.toLowerCase().endsWith(".gml")}`,
    `Supported by extension: ${isSupportedGmlDocument(document)}`,
    `Default formatter for this language: ${String(defaultFormatter ?? "not set")}`,
    `Expected formatter id: ${EXTENSION_ID}`,
    `Style: ${formatterConfig.get("style", "readable")}`,
    `Safety: ${formatterConfig.get("safety", "ast-and-trivia")}`,
    `Print width: ${formatterConfig.get("printWidth", 100)}`,
    "",
    defaultFormatter === EXTENSION_ID
      ? "Normal Format Document should use this extension."
      : "Run GML: Make This The Default Formatter, then reload the VS Code window if Format Document still does not call this extension.",
  ];
  output.clear();
  output.appendLine(lines.join("\n"));
  output.show(true);
}

async function explainFormattingResult(
  document: vscode.TextDocument,
  options: vscode.TextEditorOptions,
  output: vscode.OutputChannel,
): Promise<void> {
  const result = await formatGmlDocument(
    document.getText(),
    getFormatterOptions(document, options),
  );
  output.clear();
  output.appendLine(`${PRODUCT_NAME} result for ${document.fileName}`);
  if (result.parserErrors.length > 0) {
    output.appendLine(`Skipped: parser reported ${result.parserErrors.length} error(s).`);
    result.parserDiagnostics.forEach((diagnostic) =>
      output.appendLine(`  ${diagnostic.line}:${diagnostic.column} ${diagnostic.message}`),
    );
  } else if (result.safetyErrors.length > 0) {
    output.appendLine(`Skipped: ${result.safetyErrors.join(" ")}`);
    result.safetyDiagnostics.forEach((diagnostic) => output.appendLine(`  ${diagnostic}`));
  } else {
    output.appendLine(
      result.changed ? "Formatting would change this file." : "File is already formatted.",
    );
  }
  output.show(true);
}

async function showFormattedDiff(
  document: vscode.TextDocument,
  options: vscode.TextEditorOptions,
  output: vscode.OutputChannel,
): Promise<void> {
  const result = await formatGmlDocument(
    document.getText(),
    getFormatterOptions(document, options),
  );
  if (result.parserErrors.length || result.safetyErrors.length) {
    await explainFormattingResult(document, options, output);
    return;
  }
  const formattedDocument = await vscode.workspace.openTextDocument({
    language: document.languageId,
    content: result.formatted,
  });
  await vscode.commands.executeCommand(
    "vscode.diff",
    document.uri,
    formattedDocument.uri,
    `${PRODUCT_NAME} Diff: ${document.uri.fsPath.split(/[\\/]/).pop() ?? "document"}`,
  );
}

async function showFormatPreview(
  document: vscode.TextDocument,
  options: vscode.TextEditorOptions,
): Promise<void> {
  const result = await formatGmlDocument(
    document.getText(),
    getFormatterOptions(document, options),
  );
  const report = await analyzeGmlSource(document.getText(), getAnalysisOptions(document));
  const content = [
    `# ${PRODUCT_NAME} Format Preview`,
    "",
    `File: \`${document.fileName}\``,
    "",
    "## Safety",
    `- Parser errors: ${result.parserErrors.length}`,
    `- Safety errors: ${result.safetyErrors.length}`,
    `- Comments/strings confidence: ${report.confidence.level}`,
    ...report.confidence.reasons.map((reason) => `- ${reason}`),
    "",
    "## Result",
    result.parserErrors.length
      ? `Formatting is blocked by parser errors. First: ${result.parserErrors[0]}`
      : result.safetyErrors.length
        ? `Formatting is blocked by the safety gate. First: ${result.safetyDiagnostics[0] ?? result.safetyErrors[0]}`
        : result.changed
          ? "Formatting would change this file. A diff is opening beside this preview."
          : "This file is already formatted.",
    "",
    "## Top Findings",
    ...report.findings.slice(0, 8).map((finding) => friendlyFindingBullet(finding)),
  ].join("\n");
  const previewDocument = await vscode.workspace.openTextDocument({
    language: "markdown",
    content,
  });
  await vscode.window.showTextDocument(previewDocument, {
    preview: true,
    viewColumn: vscode.ViewColumn.Beside,
  });
  if (!result.parserErrors.length && !result.safetyErrors.length && result.changed) {
    const formattedDocument = await vscode.workspace.openTextDocument({
      language: document.languageId,
      content: result.formatted,
    });
    await vscode.commands.executeCommand(
      "vscode.diff",
      document.uri,
      formattedDocument.uri,
      `${PRODUCT_NAME} Format Preview`,
    );
  }
}

async function runWorkspaceDryRun(output: vscode.OutputChannel): Promise<void> {
  const files = await vscode.workspace.findFiles("**/*.gml", "{**/node_modules/**,**/.git/**}");
  let changed = 0;
  let parserFailed = 0;
  let safetyFailed = 0;
  output.clear();
  output.appendLine(`${PRODUCT_NAME} workspace dry run: ${files.length} file(s)`);
  for (const uri of files) {
    const document = await vscode.workspace.openTextDocument(uri);
    const result = await formatGmlDocument(
      document.getText(),
      getFormatterOptions(document, { tabSize: 4, insertSpaces: true }),
    );
    if (result.parserErrors.length) {
      parserFailed += 1;
      output.appendLine(`[parse] ${uri.fsPath}: ${result.parserErrors[0]}`);
    } else if (result.safetyErrors.length) {
      safetyFailed += 1;
      output.appendLine(
        `[safety] ${uri.fsPath}: ${result.safetyDiagnostics[0] ?? result.safetyErrors[0]}`,
      );
    } else if (result.changed) {
      changed += 1;
      output.appendLine(`[change] ${uri.fsPath}`);
    }
  }
  output.appendLine("");
  output.appendLine(
    `Checked ${files.length}; would change ${changed}; parser failures ${parserFailed}; safety failures ${safetyFailed}.`,
  );
  output.show(true);
}

async function openPlayground(
  context: vscode.ExtensionContext,
  output: vscode.OutputChannel,
): Promise<void> {
  const panel = vscode.window.createWebviewPanel(
    "gmlFormatterPlayground",
    `${PRODUCT_NAME} Playground`,
    vscode.ViewColumn.Beside,
    { enableScripts: true },
  );
  const initial =
    vscode.window.activeTextEditor?.document.getText() ?? 'if x show_debug_message("hi")';
  panel.webview.html = playgroundHtml(initial);
  panel.webview.onDidReceiveMessage(
    async (message: {
      type: string;
      source?: string;
      printWidth?: number;
      style?: GmlFormatOptions["style"];
    }) => {
      if (message.type !== "format") return;
      const source = message.source ?? "";
      const result = await formatGmlDocument(source, {
        printWidth: message.printWidth ?? 100,
        style: message.style ?? "readable",
      });
      const debug = await getGmlFormatterDebugInfo(source);
      const analysis = await analyzeGmlSource(source);
      output.appendLine(
        `[playground] parser=${result.parserErrors.length} safety=${result.safetyErrors.length} changed=${result.changed}`,
      );
      await panel.webview.postMessage({
        type: "result",
        formatted: result.formatted,
        parserErrors: result.parserErrors,
        safetyErrors: result.safetyErrors,
        safetyDiagnostics: result.safetyDiagnostics,
        ast: debug.formatterAstSummary,
        comments: debug.commentAttachments,
        analysis: {
          confidence: analysis.confidence,
          metrics: analysis.metrics,
          findings: analysis.findings.slice(0, 30),
          stateMachines: analysis.stateMachines.length,
          dialogueCases: analysis.dialogueCases.length,
          assetReferences: analysis.assetReferences.length,
        },
      });
    },
    undefined,
    context.subscriptions,
  );
}

function playgroundHtml(initial: string): string {
  const escaped = JSON.stringify(initial);
  return `<!doctype html>
<meta charset="utf-8">
<title>GameMaker Toolkit Playground</title>
<style>
body{font-family:system-ui,-apple-system,BlinkMacSystemFont,sans-serif;margin:0;color:#1f2933;background:#f7f8fa}
header{display:flex;gap:12px;align-items:center;padding:12px 16px;border-bottom:1px solid #d8dee9;background:white}
main{display:grid;grid-template-columns:1fr 1fr;gap:12px;padding:12px}
textarea,pre{box-sizing:border-box;width:100%;height:56vh;margin:0;padding:12px;border:1px solid #c9d1dc;border-radius:6px;background:white;font:12px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;overflow:auto}
section{min-width:0}
.meta{display:grid;grid-template-columns:1fr 1fr;gap:12px;padding:0 12px 12px}
button,select,input{font:inherit}
button{padding:6px 10px}
h3{margin:0 0 6px;font-size:13px}
</style>
<header>
  <strong>GameMaker Toolkit Playground</strong>
  <label>Style <select id="style"><option>readable</option><option>compact</option><option>strict</option><option>repair</option><option>opinionated</option><option>minimal</option><option>preserve</option><option>gameMakerStudio</option></select></label>
  <label>Print width <input id="width" type="number" min="40" max="200" value="100"></label>
  <button id="format">Format</button>
</header>
<main>
  <section><h3>Input</h3><textarea id="input"></textarea></section>
  <section><h3>Formatted</h3><textarea id="output" readonly></textarea></section>
</main>
<div class="meta">
  <section><h3>Safety / comments</h3><pre id="status"></pre></section>
  <section><h3>Formatter AST</h3><pre id="ast"></pre></section>
  <section><h3>Analysis</h3><pre id="analysis"></pre></section>
</div>
<script>
const vscode = acquireVsCodeApi();
input.value = ${escaped};
format.onclick = () => vscode.postMessage({type:'format', source: input.value, printWidth: Number(width.value), style: style.value});
window.addEventListener('message', event => {
  const msg = event.data;
  if (msg.type !== 'result') return;
  output.value = msg.formatted;
  status.textContent = JSON.stringify({parserErrors: msg.parserErrors, safetyErrors: msg.safetyErrors, safetyDiagnostics: msg.safetyDiagnostics, comments: msg.comments}, null, 2);
  ast.textContent = msg.ast.join('\\n');
  analysis.textContent = JSON.stringify(msg.analysis, null, 2);
});
</script>`;
}

function collectDocumentSymbols(document: vscode.TextDocument): vscode.DocumentSymbol[] {
  const symbols: vscode.DocumentSymbol[] = [];
  for (let lineIndex = 0; lineIndex < document.lineCount; lineIndex += 1) {
    const line = document.lineAt(lineIndex);
    const text = line.text.trim();
    const functionMatch = text.match(/^function\s+([A-Za-z_][A-Za-z0-9_]*)/);
    const enumMatch = text.match(/^enum\s+([A-Za-z_][A-Za-z0-9_]*)/);
    const macroMatch = text.match(/^#macro\s+([A-Za-z_][A-Za-z0-9_]*)/);
    const match = functionMatch ?? enumMatch ?? macroMatch;
    if (!match) continue;
    const kind = functionMatch
      ? vscode.SymbolKind.Function
      : enumMatch
        ? vscode.SymbolKind.Enum
        : vscode.SymbolKind.Constant;
    symbols.push(
      new vscode.DocumentSymbol(
        match[1],
        functionMatch ? "function" : enumMatch ? "enum" : "macro",
        kind,
        line.range,
        line.range,
      ),
    );
  }
  return symbols;
}

function getAnalysisOptions(document: vscode.TextDocument): { projectRules: GmlProjectRules } {
  const config = vscode.workspace.getConfiguration("gmlFormatter", document.uri);
  return {
    projectRules: config.get("projectRules", {}),
  };
}

async function showAnalysisReport(document: vscode.TextDocument): Promise<void> {
  const report = await analyzeGmlSource(document.getText(), getAnalysisOptions(document));
  const content = analysisMarkdown(document.fileName, report);
  const analysisDocument = await vscode.workspace.openTextDocument({
    language: "markdown",
    content,
  });
  await vscode.window.showTextDocument(analysisDocument, { preview: true });
}

async function showExpressionExplanation(editor: vscode.TextEditor): Promise<void> {
  const text = selectedOrLineText(editor);
  const explanation = analyzeExpressionAtText(text);
  const document = await vscode.workspace.openTextDocument({
    language: "markdown",
    content: [
      "# GML Expression Explanation",
      "",
      "```gml",
      explanation.expression,
      "```",
      "",
      "## Plain English",
      explanation.plainEnglish,
      "",
      "## Fully Parenthesized",
      "```gml",
      explanation.fullyParenthesized,
      "```",
      "",
      "## Shape",
      ...explanation.shape.map((line) => `- ${line}`),
      "",
      "## Detected Patterns",
      ...(explanation.detectedPatterns.length
        ? explanation.detectedPatterns.map((line) => `- ${line}`)
        : ["- None"]),
      "",
      "## Suggestions",
      ...(explanation.suggestions.length
        ? explanation.suggestions.map((line) => `- ${line}`)
        : ["- None"]),
    ].join("\n"),
  });
  await vscode.window.showTextDocument(document, { preview: true });
}

async function explainProblemAtCursor(editor: vscode.TextEditor): Promise<void> {
  const report = await analyzeGmlSource(
    editor.document.getText(),
    getAnalysisOptions(editor.document),
  );
  const line = editor.selection.active.line + 1;
  const finding =
    report.findings.find((candidate) => candidate.line === line) ??
    report.findings.find((candidate) => Math.abs(candidate.line - line) <= 2);
  const content = finding
    ? friendlyFindingMarkdown(editor.document.fileName, finding)
    : [
        `# ${PRODUCT_NAME} Problem Explanation`,
        "",
        "No analyzer finding was found on or near the cursor.",
        "",
        "Try `GML: Analyze Current File` for the full report, or place the cursor on a warning.",
      ].join("\n");
  const document = await vscode.workspace.openTextDocument({ language: "markdown", content });
  await vscode.window.showTextDocument(document, {
    preview: true,
    viewColumn: vscode.ViewColumn.Beside,
  });
}

async function simplifySelectedExpression(editor: vscode.TextEditor): Promise<void> {
  const range = editor.selection.isEmpty
    ? editor.document.lineAt(editor.selection.active.line).range
    : editor.selection;
  const original = editor.document.getText(range);
  const simplified = simplifyExpressionText(original);
  if (simplified === original.trim()) {
    void vscode.window.showInformationMessage("No safe simplification found for this expression.");
    return;
  }
  await editor.edit((edit) => edit.replace(range, simplified));
}

function selectedOrLineText(editor: vscode.TextEditor): string {
  return editor.selection.isEmpty
    ? editor.document.lineAt(editor.selection.active.line).text.trim()
    : editor.document.getText(editor.selection);
}

function wrapInlineControlBody(line: string): string {
  const indent = line.match(/^\s*/)?.[0] ?? "";
  const trimmed = line.trim();
  const match = trimmed.match(/^((?:if|else\s+if|while|for)\b.*?\))\s+(.+?);?\s*$/);
  if (!match) return line;
  const body = match[2].endsWith(";") ? match[2] : `${match[2]};`;
  return `${indent}${match[1]} {\n${indent}    ${body}\n${indent}}`;
}

function shouldOfferSemicolon(trimmed: string): boolean {
  if (!trimmed || /[;{}:]$/.test(trimmed)) return false;
  if (/^(?:if|else|for|while|switch|case|default|#|\/\/|\/\*)\b/.test(trimmed)) return false;
  if (/^(?:var\s+)?[A-Za-z_][A-Za-z0-9_.\[\]]*\s*(?:=|\+=|-=|\*=|\/=|%=)/.test(trimmed))
    return true;
  if (/^[A-Za-z_][A-Za-z0-9_]*\s*\(.*\)$/.test(trimmed)) return true;
  return false;
}

function createSmartCodeActions(
  document: vscode.TextDocument,
  range: vscode.Range,
): vscode.CodeAction[] {
  const actions: vscode.CodeAction[] = [];
  const selected = document.getText(range).trim();
  if (selected) {
    const simplified = simplifyExpressionText(selected);
    if (simplified !== selected) {
      const action = new vscode.CodeAction(
        "GML: Simplify expression",
        vscode.CodeActionKind.RefactorRewrite,
      );
      const edit = new vscode.WorkspaceEdit();
      edit.replace(document.uri, range, simplified);
      action.edit = edit;
      actions.push(action);
    }
  }

  const wordRange = document.getWordRangeAtPosition(range.start, /-?\d+(?:\.\d+)?/);
  if (wordRange) {
    const number = document.getText(wordRange);
    if (!["0", "1", "2", "-1"].includes(number)) {
      const macroName = `VALUE_${number.replace(/^-/, "NEG_").replace(/\./g, "_")}`;
      const action = new vscode.CodeAction(
        `GML: Extract ${number} to #macro ${macroName}`,
        vscode.CodeActionKind.RefactorRewrite,
      );
      const edit = new vscode.WorkspaceEdit();
      edit.insert(document.uri, new vscode.Position(0, 0), `#macro ${macroName} ${number}\n`);
      edit.replace(document.uri, wordRange, macroName);
      action.edit = edit;
      actions.push(action);
    }
  }

  const line = document.lineAt(range.start.line);
  const trimmed = line.text.trim();
  const lineRange = line.range;
  if (/\/\/\S/.test(line.text)) {
    const action = new vscode.CodeAction(
      "GML: Add a space after //",
      vscode.CodeActionKind.QuickFix,
    );
    const edit = new vscode.WorkspaceEdit();
    edit.replace(document.uri, lineRange, line.text.replace(/\/\/(?=\S)/g, "// "));
    action.edit = edit;
    actions.push(action);
  }
  if (
    /^(?:if|else\s+if|while|for)\b.*\)\s+[^{;\s].*;?\s*$/.test(trimmed) &&
    !trimmed.includes("{")
  ) {
    const action = new vscode.CodeAction(
      "GML: Wrap inline body in braces",
      vscode.CodeActionKind.QuickFix,
    );
    const edit = new vscode.WorkspaceEdit();
    edit.replace(document.uri, lineRange, wrapInlineControlBody(line.text));
    action.edit = edit;
    actions.push(action);
  }
  if (shouldOfferSemicolon(trimmed)) {
    const action = new vscode.CodeAction(
      "GML: Add missing semicolon",
      vscode.CodeActionKind.QuickFix,
    );
    const edit = new vscode.WorkspaceEdit();
    edit.insert(document.uri, line.range.end, ";");
    action.edit = edit;
    actions.push(action);
  }
  const explain = new vscode.CodeAction(
    "GML: Explain problem on this line",
    vscode.CodeActionKind.QuickFix,
  );
  explain.command = {
    title: "Explain problem",
    command: "gmlFormatter.explainProblem",
  };
  actions.push(explain);
  const preview = new vscode.CodeAction(
    "GML: Preview format changes",
    vscode.CodeActionKind.RefactorRewrite,
  );
  preview.command = {
    title: "Preview format changes",
    command: "gmlFormatter.previewFormatChanges",
  };
  actions.push(preview);
  const safeCleanup = new vscode.CodeAction(
    "GML: Preview safe cleanup fixes",
    vscode.CodeActionKind.RefactorRewrite,
  );
  safeCleanup.command = {
    title: "Preview safe cleanup fixes",
    command: "gmlFormatter.previewSafeCleanup",
  };
  actions.push(safeCleanup);
  if (/^\s*case\s+-?\d+\s*:/.test(line.text)) {
    const sceneFlow = new vscode.CodeAction(
      "GML: Open scene flow for this state",
      vscode.CodeActionKind.RefactorRewrite,
    );
    sceneFlow.command = {
      title: "Open scene flow",
      command: "gmlFormatter.openSceneFlowView",
    };
    actions.push(sceneFlow);
  }
  return actions;
}

async function previewSafeCleanup(
  document: vscode.TextDocument,
  options: vscode.TextEditorOptions,
): Promise<void> {
  const cleaned = await createSafeCleanupText(document, options);
  const previewDocument = await vscode.workspace.openTextDocument({
    language: document.languageId,
    content: cleaned.text,
  });
  const summary = await vscode.workspace.openTextDocument({
    language: "markdown",
    content: [
      `# ${PRODUCT_NAME} Safe Cleanup Preview`,
      "",
      `File: \`${document.fileName}\``,
      "",
      "These are behavior-preserving cleanup passes only: comment spacing, missing semicolon repair, formatter safety, and required braces.",
      "",
      "## Planned Fixes",
      ...(cleaned.fixes.length ? cleaned.fixes.map((fix) => `- ${fix}`) : ["- No changes needed"]),
    ].join("\n"),
  });
  await vscode.window.showTextDocument(summary, {
    preview: true,
    viewColumn: vscode.ViewColumn.Beside,
  });
  if (cleaned.text !== document.getText()) {
    await vscode.commands.executeCommand(
      "vscode.diff",
      document.uri,
      previewDocument.uri,
      `${PRODUCT_NAME} Safe Cleanup Preview`,
    );
  }
}

async function applySafeCleanup(
  editor: vscode.TextEditor,
  options: vscode.TextEditorOptions,
): Promise<void> {
  const cleaned = await createSafeCleanupText(editor.document, options);
  if (cleaned.text === editor.document.getText()) {
    void vscode.window.showInformationMessage(`${PRODUCT_NAME}: no safe cleanup changes found.`);
    return;
  }
  await editor.edit((edit) =>
    edit.replace(
      new vscode.Range(
        editor.document.positionAt(0),
        editor.document.positionAt(editor.document.getText().length),
      ),
      cleaned.text,
    ),
  );
}

async function createSafeCleanupText(
  document: vscode.TextDocument,
  options: vscode.TextEditorOptions,
): Promise<{ text: string; fixes: string[] }> {
  const original = document.getText();
  const fixes = new Set<string>();
  const normalizedLines = original.split(/\r?\n/).map((line) => {
    let next = line;
    if (/\/\/\S/.test(next)) {
      next = next.replace(/\/\/(?=\S)/g, "// ");
      fixes.add("Add a space after // comments");
    }
    if (shouldOfferSemicolon(next.trim())) {
      next = `${next};`;
      fixes.add("Add missing semicolons to complete statements");
    }
    return next;
  });
  const normalized = normalizedLines.join(original.includes("\r\n") ? "\r\n" : "\n");
  const formatted = await formatGmlDocument(normalized, {
    ...getFormatterOptions(document, options),
    style: "opinionated",
    safety: "ast-and-trivia",
  });
  if (!formatted.parserErrors.length && !formatted.safetyErrors.length) {
    if (formatted.changed || normalized !== original)
      fixes.add("Run the safe AST/trivia formatter");
    return { text: formatted.formatted, fixes: [...fixes] };
  }
  return {
    text: normalized,
    fixes: [...fixes, "Formatter skipped because parser/safety checks failed"],
  };
}

async function previewReadabilityUpgrade(
  document: vscode.TextDocument,
  options: vscode.TextEditorOptions,
): Promise<void> {
  const cleanup = await createSafeCleanupText(document, options);
  const report = await analyzeGmlSource(cleanup.text, getAnalysisOptions(document));
  const content = [
    `# ${PRODUCT_NAME}: Make This Code Easier To Read`,
    "",
    "## Safe Cleanup",
    ...(cleanup.fixes.length
      ? cleanup.fixes.map((fix) => `- ${fix}`)
      : ["- No safe cleanup changes needed"]),
    "",
    "## Refactor Suggestions",
    ...readabilitySuggestions(report),
    "",
    "## Learning Notes",
    ...report.findings
      .slice(0, 8)
      .map(
        (finding) =>
          `- ${finding.title ?? finding.message}: ${finding.suggestion ?? finding.message}`,
      ),
  ].join("\n");
  const summary = await vscode.workspace.openTextDocument({ language: "markdown", content });
  await vscode.window.showTextDocument(summary, {
    preview: true,
    viewColumn: vscode.ViewColumn.Beside,
  });
  if (cleanup.text !== document.getText()) {
    const cleanedDocument = await vscode.workspace.openTextDocument({
      language: document.languageId,
      content: cleanup.text,
    });
    await vscode.commands.executeCommand(
      "vscode.diff",
      document.uri,
      cleanedDocument.uri,
      `${PRODUCT_NAME} Readability Preview`,
    );
  }
}

function readabilitySuggestions(report: GmlAnalysisReport): string[] {
  const suggestions: string[] = [];
  for (const machine of report.stateMachines) {
    suggestions.push(
      `- Convert numeric ${machine.variable} cases to a named enum when the scene is stable.`,
    );
  }
  for (const expression of report.repeatedExpressions.slice(0, 5)) {
    suggestions.push(`- Extract \`${expression.expression}\` to a local variable.`);
  }
  for (const contributor of report.branchContributors.slice(0, 5)) {
    if (contributor.score >= 4) {
      suggestions.push(
        `- Name the condition on line ${contributor.line} so it reads like a sentence.`,
      );
    }
  }
  return suggestions.length
    ? suggestions
    : ["- This file is already fairly readable by the current checks."];
}

async function explainCurrentFile(document: vscode.TextDocument): Promise<void> {
  const report = await analyzeGmlSource(document.getText(), getAnalysisOptions(document));
  const purpose = report.stateMachines.length
    ? `This file appears to control scene or gameplay flow through ${report.stateMachines.map((machine) => `\`${machine.variable}\``).join(", ")}.`
    : report.assetReferences.length
      ? "This file appears to reference/draw/create GameMaker resources."
      : "This file appears to contain general GML logic.";
  const content = [
    `# ${PRODUCT_NAME}: Explain This File`,
    "",
    `File: \`${document.fileName}\``,
    "",
    "## What It Seems To Do",
    purpose,
    "",
    "## Important Variables / Flow",
    ...(report.stateMachines.length
      ? report.stateMachines.flatMap((machine) =>
          machine.cases.map(
            (stateCase) =>
              `- ${machine.variable} ${stateCase.label}: ${stateCase.comment ?? "no comment"}`,
          ),
        )
      : ["- No obvious switch-based state machine was found."]),
    "",
    "## Possible Bugs",
    ...(report.findings.filter((finding) => finding.severity !== "info").length
      ? report.findings
          .filter((finding) => finding.severity !== "info")
          .map(
            (finding) => `- ${finding.line}:${finding.column} ${finding.title ?? finding.message}`,
          )
      : ["- No warning/error findings from the analyzer."]),
    "",
    "## Cleanup Steps",
    ...readabilitySuggestions(report),
  ].join("\n");
  const output = await vscode.workspace.openTextDocument({ language: "markdown", content });
  await vscode.window.showTextDocument(output, {
    preview: true,
    viewColumn: vscode.ViewColumn.Beside,
  });
}

async function reportFormatterBug(
  document: vscode.TextDocument,
  options: vscode.TextEditorOptions,
): Promise<void> {
  const result = await formatGmlDocument(
    document.getText(),
    getFormatterOptions(document, options),
  );
  const debug = await getGmlFormatterDebugInfo(document.getText());
  const content = [
    `# ${PRODUCT_NAME} Formatter Bug Report`,
    "",
    "Paste this into a GitHub issue after removing anything private.",
    "",
    "## Environment",
    `- Extension: ${EXTENSION_ID}`,
    `- File language ID: ${document.languageId}`,
    `- File path: ${document.fileName}`,
    "",
    "## Result",
    `- Parser errors: ${result.parserErrors.length}`,
    `- Safety errors: ${result.safetyErrors.length}`,
    `- Changed: ${result.changed}`,
    "",
    "## First Diagnostics",
    ...result.parserDiagnostics
      .slice(0, 5)
      .map((diagnostic) => `- ${diagnostic.line}:${diagnostic.column} ${diagnostic.message}`),
    ...result.safetyDiagnostics.slice(0, 10).map((diagnostic) => `- ${diagnostic}`),
    "",
    "## Original Snippet",
    "```gml",
    document.getText().slice(0, 8000),
    "```",
    "",
    "## Formatted Snippet",
    "```gml",
    result.formatted.slice(0, 8000),
    "```",
    "",
    "## Parser Summary",
    "```text",
    debug.formatterAstSummary.slice(0, 80).join("\n"),
    "```",
  ].join("\n");
  const output = await vscode.workspace.openTextDocument({ language: "markdown", content });
  await vscode.window.showTextDocument(output, { preview: true });
}

async function showInstallDoctor(document: vscode.TextDocument): Promise<void> {
  const commands = new Set(await vscode.commands.getCommands(true));
  const config = vscode.workspace.getConfiguration(undefined, document.uri);
  const languageConfig = config.get<Record<string, unknown>>(`[${document.languageId}]`);
  const defaultFormatter = languageConfig?.["editor.defaultFormatter"];
  const content = [
    `# ${PRODUCT_NAME} Install Doctor`,
    "",
    "## Checks",
    `- File is .gml: ${document.fileName.toLowerCase().endsWith(".gml") ? "yes" : "no"}`,
    `- Language ID: \`${document.languageId}\``,
    `- Supported by extension: ${isSupportedGmlDocument(document) ? "yes" : "no"}`,
    `- Default formatter: \`${String(defaultFormatter ?? "not set")}\``,
    `- Expected formatter: \`${EXTENSION_ID}\``,
    `- Format command registered: ${commands.has("gmlFormatter.formatDocument") ? "yes" : "no"}`,
    `- Project Doctor command registered: ${commands.has("gmlFormatter.projectDoctor") ? "yes" : "no"}`,
    `- Language server started: ${languageClient ? "yes" : "no"}`,
    "",
    "## Fixes",
    defaultFormatter === EXTENSION_ID
      ? "- Normal Format Document should use GameMaker Toolkit."
      : "- Run `GML: Make This The Default Formatter`, then reload VS Code if the normal Format Document command still uses another extension.",
    "- If another GML extension owns formatting, use `Format Document With...` once and pick GameMaker Toolkit.",
    "- On Windows, install from Marketplace first; use the VSIX only for testing pre-release builds.",
  ].join("\n");
  const output = await vscode.workspace.openTextDocument({ language: "markdown", content });
  await vscode.window.showTextDocument(output, {
    preview: true,
    viewColumn: vscode.ViewColumn.Beside,
  });
}

async function openObjectEventMap(state: {
  index?: GmlProjectIndex;
  builtAt?: number;
}): Promise<void> {
  const index = await ensureProjectIndex(state);
  const byObject = new Map<string, string[]>();
  for (const event of index.objectEvents) {
    const list = byObject.get(event.objectName) ?? [];
    list.push(`${event.eventName}: ${event.file}`);
    byObject.set(event.objectName, list);
  }
  const content = [
    `# ${PRODUCT_NAME} Object Event Map`,
    "",
    ...(byObject.size
      ? [...byObject.entries()].flatMap(([objectName, events]) => [
          `## ${objectName}`,
          "",
          ...events.sort().map((event) => `- ${event}`),
          "",
        ])
      : ["No object event files were found under `objects/<object>/<Event>_*.gml`."]),
    "## Maybe Uninitialized Instance Variables",
    ...(index.graph.maybeUninitializedVariables.length
      ? index.graph.maybeUninitializedVariables.map(
          (entry) =>
            `- ${entry.objectName}.${entry.variable} is read in ${entry.readFiles.length} file(s) but not obviously assigned in Create.`,
        )
      : ["- None"]),
  ].join("\n");
  const document = await vscode.workspace.openTextDocument({ language: "markdown", content });
  await vscode.window.showTextDocument(document, {
    preview: true,
    viewColumn: vscode.ViewColumn.Beside,
  });
}

async function openCutsceneTimeline(document: vscode.TextDocument): Promise<void> {
  const report = await analyzeGmlSource(document.getText(), getAnalysisOptions(document));
  const content = [
    `# ${PRODUCT_NAME} Cutscene Timeline`,
    "",
    ...(report.stateMachines.length
      ? report.stateMachines.flatMap((machine) => [
          `## ${machine.variable}`,
          "",
          ...machine.cases.map((stateCase) =>
            [
              `### ${machine.variable} ${stateCase.label}`,
              stateCase.comment ? `- Meaning: ${stateCase.comment}` : "- Meaning: no comment found",
              stateCase.transitions.length
                ? `- Next: ${stateCase.transitions.join(", ")}`
                : "- Next: no detected transition",
              `- Break: ${stateCase.hasBreak ? "yes" : "no"}`,
              "",
            ].join("\n"),
          ),
        ])
      : ["No switch-based scene/state flow was found."]),
  ].join("\n");
  const output = await vscode.workspace.openTextDocument({ language: "markdown", content });
  await vscode.window.showTextDocument(output, {
    preview: true,
    viewColumn: vscode.ViewColumn.Beside,
  });
}

async function previewStateEnum(document: vscode.TextDocument): Promise<void> {
  const report = await analyzeGmlSource(document.getText(), getAnalysisOptions(document));
  const lines = [`# ${PRODUCT_NAME} State Enum Preview`, ""];
  for (const machine of report.stateMachines) {
    lines.push(
      `## ${machine.variable}`,
      "",
      "```gml",
      `enum ${pascalCase(machine.variable)}State {`,
    );
    for (const stateCase of machine.cases) {
      lines.push(
        `    ${stateNameFromCase(stateCase.comment, stateCase.label)} = ${stateCase.label},`,
      );
    }
    lines.push("}", "```", "");
  }
  if (report.stateMachines.length === 0) lines.push("No numeric switch-based state machine found.");
  const output = await vscode.workspace.openTextDocument({
    language: "markdown",
    content: lines.join("\n"),
  });
  await vscode.window.showTextDocument(output, {
    preview: true,
    viewColumn: vscode.ViewColumn.Beside,
  });
}

async function previewResourceRename(state: {
  index?: GmlProjectIndex;
  builtAt?: number;
}): Promise<void> {
  const index = await ensureProjectIndex(state);
  const picked = await vscode.window.showQuickPick(
    index.resources.map((resource) => ({
      label: resource.name,
      description: resource.type,
      resource,
    })),
    { placeHolder: "Choose a GameMaker resource to rename-preview" },
  );
  if (!picked) return;
  const nextName = await vscode.window.showInputBox({
    prompt: `Preview renaming ${picked.resource.name} to...`,
    value: picked.resource.name,
    validateInput: (value) =>
      /^[A-Za-z_][A-Za-z0-9_]*$/.test(value) ? undefined : "Use a valid GML identifier.",
  });
  if (!nextName || nextName === picked.resource.name) return;
  const references = referencesFor(index, picked.resource.name);
  const definition = index.symbols.filter(
    (symbol) => symbol.name === picked.resource.name && symbol.kind === "resource",
  );
  const content = [
    `# ${PRODUCT_NAME} Resource Rename Preview`,
    "",
    `Rename \`${picked.resource.name}\` to \`${nextName}\`.`,
    "",
    `This preview found ${definition.length} definition location(s) and ${references.length} code reference(s).`,
    "",
    "## Locations",
    ...[...definition, ...references].map(
      (symbol) =>
        `- ${symbol.file}:${symbol.line}:${symbol.column} (${symbol.detail ?? symbol.kind})`,
    ),
    "",
    "No files were changed. Use VS Code Rename Symbol or a future confirmed multi-file rename to apply.",
  ].join("\n");
  const output = await vscode.workspace.openTextDocument({ language: "markdown", content });
  await vscode.window.showTextDocument(output, { preview: true });
}

async function openGlobalsReport(state: {
  index?: GmlProjectIndex;
  builtAt?: number;
}): Promise<void> {
  const index = await ensureProjectIndex(state);
  const globals = index.identifierReferences.filter((reference) => reference.name === "global");
  const globalFields = new Map<string, Set<string>>();
  for (const reference of index.identifierReferences) {
    if (!reference.name.startsWith("global.")) continue;
    const files = globalFields.get(reference.name) ?? new Set<string>();
    files.add(`${reference.file}:${reference.line}`);
    globalFields.set(reference.name, files);
  }
  const content = [
    `# ${PRODUCT_NAME} Global Variables Report`,
    "",
    `Raw \`global\` namespace mentions: ${globals.length}`,
    "",
    ...(globalFields.size
      ? [...globalFields.entries()].map(
          ([name, files]) =>
            `- ${name}: ${files.size} location(s) (${[...files].slice(0, 5).join(", ")})`,
        )
      : [
          "No dotted `global.name` references were indexed yet. The tokenizer still records raw `global` mentions.",
        ]),
  ].join("\n");
  const output = await vscode.workspace.openTextDocument({ language: "markdown", content });
  await vscode.window.showTextDocument(output, { preview: true });
}

async function minimizeFormatterBug(
  document: vscode.TextDocument,
  options: vscode.TextEditorOptions,
): Promise<void> {
  const original = document.getText();
  const baseline = await formatGmlDocument(original, getFormatterOptions(document, options));
  const targetFails = baseline.parserErrors.length > 0 || baseline.safetyErrors.length > 0;
  let best = original;
  if (targetFails) {
    const lines = original.split(/\r?\n/);
    for (
      let size = Math.max(1, Math.floor(lines.length / 2));
      size >= 1;
      size = Math.floor(size / 2)
    ) {
      for (let start = 0; start + size <= lines.length; start += 1) {
        const candidate = lines.slice(start, start + size).join("\n");
        const result = await formatGmlDocument(candidate, getFormatterOptions(document, options));
        if (
          (baseline.parserErrors.length > 0 && result.parserErrors.length > 0) ||
          (baseline.safetyErrors.length > 0 && result.safetyErrors.length > 0)
        ) {
          best = candidate;
          break;
        }
      }
    }
  }
  const content = [
    `# ${PRODUCT_NAME} Formatter Bug Minimizer`,
    "",
    targetFails
      ? "A smaller candidate snippet was found. Review it before filing an issue."
      : "The current file does not reproduce a parser/safety failure, so the full first snippet is shown.",
    "",
    "```gml",
    best.slice(0, 8000),
    "```",
  ].join("\n");
  const output = await vscode.workspace.openTextDocument({ language: "markdown", content });
  await vscode.window.showTextDocument(output, { preview: true });
}

function stateNameFromCase(comment: string | undefined, label: string): string {
  const base = comment ?? `State ${label}`;
  const name = pascalCase(base).replace(/^\d+/, "");
  return name || `State${label.replace(/\W/g, "")}`;
}

function pascalCase(value: string): string {
  return value
    .replace(/[^A-Za-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join("");
}

async function createGmlCodeLenses(document: vscode.TextDocument): Promise<vscode.CodeLens[]> {
  if (!isSupportedGmlDocument(document)) return [];
  const report = await analyzeGmlSource(document.getText(), getAnalysisOptions(document));
  const lenses: vscode.CodeLens[] = [];
  for (const machine of report.stateMachines) {
    for (const stateCase of machine.cases) {
      const range = new vscode.Range(
        Math.max(0, stateCase.line - 1),
        0,
        Math.max(0, stateCase.line - 1),
        0,
      );
      lenses.push(
        new vscode.CodeLens(range, {
          title: `${machine.variable} ${stateCase.label}: ${stateCase.transitions.length} transition${stateCase.transitions.length === 1 ? "" : "s"}`,
          command: "gmlFormatter.openSceneFlowView",
        }),
      );
    }
  }
  for (const contributor of report.branchContributors.slice(0, 8)) {
    if (contributor.score < 4) continue;
    const range = new vscode.Range(
      Math.max(0, contributor.line - 1),
      0,
      Math.max(0, contributor.line - 1),
      0,
    );
    lenses.push(
      new vscode.CodeLens(range, {
        title: `${contributor.score} checks: explain readability`,
        command: "gmlFormatter.explainProblem",
      }),
    );
  }
  for (const expression of report.repeatedExpressions.slice(0, 8)) {
    const line = Math.max(0, expression.lines[0] - 1);
    lenses.push(
      new vscode.CodeLens(new vscode.Range(line, 0, line, 0), {
        title: `Repeated expression: extract variable`,
        command: "gmlFormatter.makeCodeReadable",
      }),
    );
  }
  return lenses;
}

function friendlyFindingBullet(finding: GmlAnalysisReport["findings"][number]): string {
  return `- **${finding.title ?? finding.code}** at ${finding.line}:${finding.column}: ${finding.message}`;
}

function friendlyFindingMarkdown(
  fileName: string,
  finding: GmlAnalysisReport["findings"][number],
): string {
  return [
    `# ${finding.title ?? finding.code}`,
    "",
    `File: \`${fileName}\``,
    `Location: ${finding.line}:${finding.column}`,
    `Severity: ${finding.severity}`,
    "",
    "## What Happened",
    finding.message,
    "",
    "## What It Means",
    finding.explanation ?? "GameMaker Toolkit found something worth reviewing.",
    "",
    "## Why It Matters",
    finding.whyItMatters ?? "This can make the file harder to read or debug.",
    "",
    "## What To Do",
    finding.suggestion ?? "Review this line and choose the smallest fix that matches your intent.",
    "",
    "## Useful Actions",
    ...(finding.quickFixes?.length ? finding.quickFixes : ["Analyze current file"]).map(
      (fix) => `- ${fix}`,
    ),
  ].join("\n");
}

async function showProjectDoctor(state: {
  index?: GmlProjectIndex;
  builtAt?: number;
}): Promise<void> {
  const index = await ensureProjectIndex(state);
  const files = await vscode.workspace.findFiles("**/*.gml", "{**/node_modules/**,**/.git/**}");
  const reports: Array<{ file: string; report: GmlAnalysisReport }> = [];
  for (const uri of files.slice(0, 120)) {
    const document = await vscode.workspace.openTextDocument(uri);
    reports.push({
      file: uri.fsPath,
      report: await analyzeGmlSource(document.getText(), getAnalysisOptions(document)),
    });
  }
  const findings = reports.flatMap((entry) =>
    entry.report.findings.map((finding) => ({ file: entry.file, finding })),
  );
  const content = [
    `# ${PRODUCT_NAME} Project Doctor`,
    "",
    "This report uses beginner-friendly checks: formatting safety, project resources, scene flow, expression readability, setup health, and optional project-pattern rules.",
    "",
    "## Project",
    `- GML files checked: ${reports.length}${files.length > reports.length ? ` of ${files.length}` : ""}`,
    `- Indexed resources: ${index.resources.length}`,
    `- Indexed symbols: ${index.symbols.length}`,
    `- Resource references: ${index.resourceReferences.length}`,
    `- Missing resources: ${index.unresolvedReferences.length}`,
    `- Rooms indexed: ${index.rooms.length}`,
    `- Unused resources: ${index.graph.unusedResources.length}`,
    `- Resource type mismatches: ${index.graph.resourceTypeMismatches.length}`,
    "",
    "## Formatting Confidence",
    `- High confidence files: ${reports.filter((entry) => entry.report.confidence.level === "high").length}`,
    `- Medium confidence files: ${reports.filter((entry) => entry.report.confidence.level === "medium").length}`,
    `- Low confidence files: ${reports.filter((entry) => entry.report.confidence.level === "low").length}`,
    "",
    "## Missing Resources",
    ...(index.unresolvedReferences.length
      ? index.unresolvedReferences.slice(0, 30).map((reference) => {
          const suggestions = reference.suggestions?.length
            ? ` Did you mean ${reference.suggestions.join(", ")}?`
            : "";
          return `- ${reference.name} in ${reference.file}:${reference.line}.${suggestions}`;
        })
      : ["- None"]),
    "",
    "## Things That May Break The Game",
    ...(index.graph.resourceTypeMismatches.length
      ? index.graph.resourceTypeMismatches
          .slice(0, 30)
          .map(
            (mismatch) =>
              `- ${mismatch.file}:${mismatch.line} \`${mismatch.name}\` is a ${mismatch.actual}, but this call expects ${mismatch.expected}.`,
          )
      : ["- No resource type mismatches found."]),
    ...(index.graph.missingLayerReferences.length
      ? index.graph.missingLayerReferences
          .slice(0, 30)
          .map(
            (layer) =>
              `- ${layer.file}:${layer.line} layer "${layer.layerName}" was not found in indexed rooms.`,
          )
      : []),
    "",
    "## Assets",
    ...(index.graph.unusedResources.length
      ? index.graph.unusedResources
          .slice(0, 40)
          .map((resource) => `- Possibly unused ${resource.type}: ${resource.name}`)
      : ["- No obviously unused resources found."]),
    "",
    "## Rooms",
    ...(index.rooms.length
      ? index.rooms
          .slice(0, 30)
          .map(
            (room) =>
              `- ${room.name}: ${room.layers.length} layer(s), ${room.instances.length} instance(s)`,
          )
      : ["- No room .yy files were indexed."]),
    "",
    "## Safe Auto-Fixes",
    "- `GML: Preview Safe Cleanup Fixes` shows comment spacing, semicolon repair, brace normalization, and formatter changes before applying them.",
    "- `GML: Apply Safe Cleanup Fixes` applies only parser/safety-checked cleanup.",
    "- `GML: Make This Code Easier To Read` opens grouped safe cleanup, refactor suggestions, and learning notes.",
    "",
    "## Most Helpful Fixes",
    ...findings
      .filter((entry) => entry.finding.severity !== "info")
      .slice(0, 30)
      .map(
        (entry) =>
          `- ${entry.file}:${entry.finding.line} ${entry.finding.title ?? entry.finding.message}`,
      ),
    "",
    "## Branchiest Lines",
    ...reports
      .flatMap((entry) =>
        entry.report.branchContributors.slice(0, 3).map((contributor) => ({
          file: entry.file,
          contributor,
        })),
      )
      .sort((left, right) => right.contributor.score - left.contributor.score)
      .slice(0, 20)
      .map(
        (entry) =>
          `- ${entry.file}:${entry.contributor.line} score ${entry.contributor.score} (${entry.contributor.reason}) \`${entry.contributor.code}\``,
      ),
  ].join("\n");
  const document = await vscode.workspace.openTextDocument({ language: "markdown", content });
  await vscode.window.showTextDocument(document, { preview: true });
}

async function openProjectMap(
  context: vscode.ExtensionContext,
  state: { index?: GmlProjectIndex; builtAt?: number },
): Promise<void> {
  const index = await ensureProjectIndex(state);
  const panel = vscode.window.createWebviewPanel(
    "gmlProjectMap",
    "GameMaker Project Map",
    vscode.ViewColumn.Beside,
    { enableScripts: true },
  );
  panel.webview.html = projectMapHtml(index);
  context.subscriptions.push(panel);
}

async function openSceneFlowView(
  context: vscode.ExtensionContext,
  document: vscode.TextDocument,
): Promise<void> {
  const report = await analyzeGmlSource(document.getText(), getAnalysisOptions(document));
  const panel = vscode.window.createWebviewPanel(
    "gmlSceneFlow",
    "GML Scene Flow",
    vscode.ViewColumn.Beside,
    { enableScripts: true },
  );
  panel.webview.html = sceneFlowHtml(report);
  context.subscriptions.push(panel);
}

async function maybeShowOnboarding(
  context: vscode.ExtensionContext,
  document: vscode.TextDocument,
): Promise<void> {
  const enabled = vscode.workspace
    .getConfiguration("gmlFormatter", document.uri)
    .get("onboarding.enabled", true);
  if (!enabled) return;
  const key = `onboarded:${document.languageId}`;
  if (context.globalState.get(key)) return;
  const config = vscode.workspace.getConfiguration(undefined, document.uri);
  const languageConfig = config.get<Record<string, unknown>>(`[${document.languageId}]`);
  if (languageConfig?.["editor.defaultFormatter"] === EXTENSION_ID) {
    await context.globalState.update(key, true);
    return;
  }
  const answer = await vscode.window.showInformationMessage(
    `${PRODUCT_NAME} can format and analyze this .gml file. Make it the default formatter for "${document.languageId}"?`,
    "Make Default",
    "Project Doctor",
    "Not Now",
  );
  if (answer === "Make Default") {
    await vscode.commands.executeCommand("gmlFormatter.configureDefaultFormatter");
    await context.globalState.update(key, true);
  } else if (answer === "Project Doctor") {
    await vscode.commands.executeCommand("gmlFormatter.projectDoctor");
  } else if (answer === "Not Now") {
    await context.globalState.update(key, true);
  }
}

async function ensureProjectIndex(state: {
  index?: GmlProjectIndex;
  builtAt?: number;
}): Promise<GmlProjectIndex> {
  if (!state.index || !state.builtAt || Date.now() - state.builtAt > 30_000) {
    state.index = await buildWorkspaceProjectIndex();
    state.builtAt = Date.now();
  }
  return state.index;
}

async function buildWorkspaceProjectIndex(): Promise<GmlProjectIndex> {
  const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? "";
  const uris = await vscode.workspace.findFiles(
    "**/*.{gml,yy,yyp}",
    "{**/node_modules/**,**/.git/**}",
  );
  const files: GmlProjectFile[] = [];
  for (const uri of uris) {
    try {
      files.push({
        path: uri.fsPath,
        content: Buffer.from(await vscode.workspace.fs.readFile(uri)).toString("utf8"),
      });
    } catch {
      // Ignore files that changed while indexing.
    }
  }
  return buildGmlProjectIndex(root, files);
}

async function updateProjectDiagnostics(
  index: GmlProjectIndex,
  diagnostics: vscode.DiagnosticCollection,
): Promise<void> {
  const grouped = new Map<string, vscode.Diagnostic[]>();
  for (const reference of index.unresolvedReferences) {
    const list = grouped.get(reference.file) ?? [];
    list.push(
      new vscode.Diagnostic(
        new vscode.Range(
          Math.max(0, reference.line - 1),
          Math.max(0, reference.column - 1),
          Math.max(0, reference.line - 1),
          Math.max(0, reference.column - 1 + reference.name.length),
        ),
        `Unresolved GameMaker resource reference: ${reference.name}`,
        vscode.DiagnosticSeverity.Warning,
      ),
    );
    grouped.set(reference.file, list);
  }
  diagnostics.clear();
  for (const [file, list] of grouped) {
    diagnostics.set(vscode.Uri.file(file), list);
  }
}

function projectMapHtml(index: GmlProjectIndex): string {
  const rows = index.resources
    .map(
      (resource) =>
        `<tr><td>${escapeHtml(resource.type)}</td><td>${escapeHtml(resource.name)}</td><td>${escapeHtml(resource.file)}</td></tr>`,
    )
    .join("");
  const unresolved = index.unresolvedReferences
    .map(
      (reference) =>
        `<li>${escapeHtml(reference.name)} in ${escapeHtml(reference.file)}:${reference.line}</li>`,
    )
    .join("");
  const mismatches = index.graph.resourceTypeMismatches
    .map(
      (mismatch) =>
        `<li>${escapeHtml(mismatch.name)} expects ${escapeHtml(mismatch.expected)} but is ${escapeHtml(mismatch.actual)} in ${escapeHtml(mismatch.file)}:${mismatch.line}</li>`,
    )
    .join("");
  const rooms = index.rooms
    .map(
      (room) =>
        `<tr><td>room</td><td>${escapeHtml(room.name)}</td><td>${room.layers.length} layer(s), ${room.instances.length} instance(s)</td></tr>`,
    )
    .join("");
  return `<!doctype html>
<meta charset="utf-8">
<style>
body{font-family:system-ui,-apple-system,BlinkMacSystemFont,sans-serif;margin:16px;color:#1f2933}
table{width:100%;border-collapse:collapse}
td,th{border-bottom:1px solid #d8dee9;padding:6px 8px;text-align:left;font-size:12px}
th{background:#f7f8fa}
.summary{display:flex;gap:16px;margin:12px 0}
.summary strong{display:block;font-size:18px}
</style>
<h1>GameMaker Project Map</h1>
<div class="summary">
  <span><strong>${index.resources.length}</strong>resources</span>
  <span><strong>${index.symbols.length}</strong>symbols</span>
  <span><strong>${index.resourceReferences.length}</strong>resource references</span>
  <span><strong>${index.unresolvedReferences.length}</strong>unresolved</span>
  <span><strong>${index.rooms.length}</strong>rooms</span>
  <span><strong>${index.graph.unusedResources.length}</strong>possibly unused</span>
</div>
${index.unresolvedReferences.length ? `<h2>Unresolved References</h2><ul>${unresolved}</ul>` : ""}
${index.graph.resourceTypeMismatches.length ? `<h2>Resource Type Mismatches</h2><ul>${mismatches}</ul>` : ""}
<h2>Rooms</h2>
<table><thead><tr><th>Kind</th><th>Name</th><th>Details</th></tr></thead><tbody>${rooms || `<tr><td colspan="3">No rooms indexed</td></tr>`}</tbody></table>
<h2>Resources</h2>
<table><thead><tr><th>Kind</th><th>Name</th><th>Path</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function sceneFlowHtml(report: GmlAnalysisReport): string {
  const machines = report.stateMachines
    .map((machine) => {
      const rows = machine.cases
        .map(
          (stateCase) =>
            `<tr><td>${escapeHtml(stateCase.label)}</td><td>${escapeHtml(stateCase.comment ?? "")}</td><td>${escapeHtml(stateCase.transitions.join(", ") || "no detected transition")}</td><td>${stateCase.hasBreak ? "yes" : "no"}</td></tr>`,
        )
        .join("");
      const warnings = machine.warnings.length
        ? `<ul>${machine.warnings.map((warning) => `<li>${escapeHtml(warning)}</li>`).join("")}</ul>`
        : "<p>No obvious scene-flow warnings.</p>";
      return `<section>
<h2>${escapeHtml(machine.variable)}</h2>
${warnings}
<pre class="mermaid">${escapeHtml(machine.mermaid)}</pre>
<table><thead><tr><th>Case</th><th>Comment</th><th>Transitions</th><th>Break</th></tr></thead><tbody>${rows}</tbody></table>
</section>`;
    })
    .join("");
  return `<!doctype html>
<meta charset="utf-8">
<style>
body{font-family:system-ui,-apple-system,BlinkMacSystemFont,sans-serif;margin:16px;color:#1f2933}
section{margin:0 0 24px}
table{width:100%;border-collapse:collapse;margin-top:12px}
td,th{border-bottom:1px solid #d8dee9;padding:6px 8px;text-align:left;font-size:12px;vertical-align:top}
th{background:#f7f8fa}
pre{white-space:pre-wrap;background:#f7f8fa;border:1px solid #d8dee9;padding:10px;border-radius:6px}
</style>
<h1>GML Scene Flow</h1>
${machines || "<p>No obvious switch-based scene flow found.</p>"}`;
}

function analysisMarkdown(fileName: string, report: GmlAnalysisReport): string {
  return [
    `# GML Analysis: ${fileName.split(/[\\/]/).pop() ?? fileName}`,
    "",
    `Confidence: **${report.confidence.level}**`,
    ...report.confidence.reasons.map((reason) => `- ${reason}`),
    "",
    "## Metrics",
    `- Lines: ${report.metrics.lineCount} total, ${report.metrics.codeLineCount} code, ${report.metrics.commentLineCount} with comments`,
    `- Functions: ${report.metrics.functionCount}`,
    `- Branch and condition score: ${report.metrics.cyclomaticComplexity}`,
    `- Max brace depth: ${report.metrics.maxBraceDepth}`,
    "",
    "## Findings",
    ...(report.findings.length
      ? report.findings.map((finding) => friendlyFindingBullet(finding))
      : ["- None"]),
    "",
    "## Branchiest Lines",
    ...(report.branchContributors.length
      ? report.branchContributors
          .slice(0, 15)
          .map(
            (entry) =>
              `- line ${entry.line}: score ${entry.score} (${entry.reason}) \`${entry.code}\``,
          )
      : ["- None"]),
    "",
    "## TODO / Notes",
    ...(report.todoComments.length
      ? report.todoComments.map((comment) => `- ${comment.tag} ${comment.line}: ${comment.text}`)
      : ["- None"]),
    "",
    "## State Machines",
    ...(report.stateMachines.length
      ? report.stateMachines.map(
          (machine) =>
            `- ${machine.variable} at line ${machine.line}: ${machine.cases.length} case(s), ${machine.warnings.length} warning(s)`,
        )
      : ["- None"]),
    "",
    "## Project Pattern Analysis",
    "Dialogue/localization checks are opt-in project-pattern checks, not built-in GameMaker rules.",
    "",
    "## Dialogue / Localization Patterns",
    ...(report.dialogueCases.length
      ? report.dialogueCases.map(
          (dialogue) =>
            `- ${dialogue.room ?? "unknown"} / txt_num ${dialogue.txtNum}: ${dialogue.warnings.length ? dialogue.warnings.join("; ") : "ok"}`,
        )
      : ["- None"]),
    "",
    "## Magic Numbers",
    ...report.magicNumbers
      .slice(0, 20)
      .map((number) => `- ${number.value}: ${number.count} line(s) (${number.lines.join(", ")})`),
    "",
    "## Suspicious Names",
    ...(report.suspiciousNames.length
      ? report.suspiciousNames.map(
          (name) => `- ${name.name} -> ${name.suggestion} (${name.lines.join(", ")})`,
        )
      : ["- None"]),
    "",
    "## Constant Expressions",
    ...(report.constantExpressions.length
      ? report.constantExpressions.map(
          (expression) => `- ${expression.line}: ${expression.suggestion}`,
        )
      : ["- None"]),
    "",
    "## Repeated Expressions",
    ...(report.repeatedExpressions.length
      ? report.repeatedExpressions.map(
          (expression) => `- ${expression.expression}: ${expression.suggestion}`,
        )
      : ["- None"]),
    "",
    "## Asset References",
    ...(report.assetReferences.length
      ? report.assetReferences
          .slice(0, 80)
          .map(
            (reference) =>
              `- ${reference.kind} ${reference.name} at line ${reference.line} (${reference.context})`,
          )
      : ["- None"]),
    "",
    "## Scene Notes",
    report.sceneNotesMarkdown,
  ].join("\n");
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function dialogueCsv(report: GmlAnalysisReport): string {
  const rows = [
    [
      "room",
      "txt_num",
      "line",
      "len",
      "text_count",
      "face_count",
      "choice_count",
      "choice_target_count",
      "missing_languages",
      "warnings",
    ],
  ];
  for (const dialogue of report.dialogueCases) {
    rows.push([
      dialogue.room ?? "",
      dialogue.txtNum,
      String(dialogue.line),
      dialogue.len === undefined ? "" : String(dialogue.len),
      dialogue.textCount === undefined ? "" : String(dialogue.textCount),
      dialogue.faceCount === undefined ? "" : String(dialogue.faceCount),
      dialogue.choiceCount === undefined ? "" : String(dialogue.choiceCount),
      dialogue.choiceTargetCount === undefined ? "" : String(dialogue.choiceTargetCount),
      dialogue.missingLanguages.join("|"),
      dialogue.warnings.join(" | "),
    ]);
  }
  return rows.map((row) => row.map(csvCell).join(",")).join("\n") + "\n";
}

function csvCell(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}
