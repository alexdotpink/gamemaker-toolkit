const assert = require("node:assert/strict");
const path = require("node:path");
const vscode = require("vscode");

async function activateExtension() {
  const extension = vscode.extensions.getExtension("alexdotpink.gamemaker-toolkit");
  assert.ok(extension, "extension should be installed in the extension host");
  await extension.activate();
  return extension;
}

module.exports.run = async function run() {
  await activateExtension();
  const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  assert.ok(root, "fixture workspace should be open");

  const document = await vscode.workspace.openTextDocument(
    path.join(root, "objects", "OBJ_CONTROLLER", "Step_0.gml"),
  );
  await vscode.window.showTextDocument(document);

  const commands = new Set(await vscode.commands.getCommands(true));
  assert.ok(commands.has("gmlFormatter.formatDocument"));
  assert.ok(commands.has("gmlFormatter.previewFormatChanges"));
  assert.ok(commands.has("gmlFormatter.projectDoctor"));
  assert.ok(commands.has("gmlFormatter.openSceneFlowView"));
  assert.ok(commands.has("gmlFormatter.previewSafeCleanup"));
  assert.ok(commands.has("gmlFormatter.makeCodeReadable"));
  assert.ok(commands.has("gmlFormatter.installDoctor"));
  assert.ok(commands.has("gmlFormatter.openObjectEventMap"));
  assert.ok(commands.has("gmlFormatter.openCutsceneTimeline"));
  assert.ok(commands.has("gmlFormatter.previewStateEnum"));
  assert.ok(commands.has("gmlFormatter.previewResourceRename"));
  assert.ok(commands.has("gmlFormatter.openGlobalsReport"));
  assert.ok(commands.has("gmlFormatter.minimizeFormatterBug"));

  const edits = await vscode.commands.executeCommand(
    "vscode.executeFormatDocumentProvider",
    document.uri,
    { tabSize: 4, insertSpaces: true },
  );
  assert.ok(Array.isArray(edits), "format provider should return an edit array");

  await vscode.commands.executeCommand("gmlFormatter.rebuildProjectIndex");

  const completionDocument = await vscode.workspace.openTextDocument({
    language: "gml",
    content: "draw_sprite(",
  });
  const completions = await vscode.commands.executeCommand(
    "vscode.executeCompletionItemProvider",
    completionDocument.uri,
    new vscode.Position(0, "draw_sprite(".length),
  );
  assert.ok(completions.items.some((item) => item.label === "draw_sprite"));

  const hovers = await retryProvider(() =>
    vscode.commands.executeCommand(
      "vscode.executeHoverProvider",
      document.uri,
      new vscode.Position(7, 10),
    ),
  );
  assert.ok(hovers.length > 0, "hover provider should explain generated built-ins");
};

async function retryProvider(run) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const result = await run();
    if (result?.length) return result;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  return [];
}
