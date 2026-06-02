import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

test("extension starts language server and keeps project commands", async () => {
  const extensionSource = await readFile(
    path.join(__dirname, "..", "..", "src", "extension.ts"),
    "utf8",
  );
  const serverSource = await readFile(path.join(__dirname, "..", "..", "src", "server.ts"), "utf8");
  assert.match(extensionSource, /new LanguageClient/);
  assert.match(extensionSource, /dist", "server\.js"/);
  assert.match(extensionSource, /gmlFormatter\.rebuildProjectIndex/);
  assert.match(extensionSource, /gmlFormatter\.goToResource/);
  assert.match(extensionSource, /gmlFormatter\.exportDialogueCsv/);
  assert.match(extensionSource, /gmlFormatter\.projectDoctor/);
  assert.match(extensionSource, /gmlFormatter\.previewFormatChanges/);
  assert.match(extensionSource, /gmlFormatter\.explainProblem/);
  assert.match(extensionSource, /gmlFormatter\.openSceneFlowView/);
  assert.match(extensionSource, /gmlFormatter\.previewSafeCleanup/);
  assert.match(extensionSource, /gmlFormatter\.applySafeCleanup/);
  assert.match(extensionSource, /gmlFormatter\.makeCodeReadable/);
  assert.match(extensionSource, /gmlFormatter\.explainCurrentFile/);
  assert.match(extensionSource, /gmlFormatter\.reportFormatterBug/);
  assert.match(extensionSource, /gmlFormatter\.installDoctor/);
  assert.match(extensionSource, /gmlFormatter\.openObjectEventMap/);
  assert.match(extensionSource, /gmlFormatter\.openCutsceneTimeline/);
  assert.match(extensionSource, /gmlFormatter\.previewStateEnum/);
  assert.match(extensionSource, /gmlFormatter\.previewResourceRename/);
  assert.match(extensionSource, /gmlFormatter\.openGlobalsReport/);
  assert.match(extensionSource, /gmlFormatter\.minimizeFormatterBug/);
  assert.match(extensionSource, /registerCodeLensProvider/);
  assert.match(extensionSource, /maybeShowOnboarding/);
  assert.match(serverSource, /onCompletion/);
  assert.match(serverSource, /onHover/);
  assert.match(serverSource, /onDefinition/);
  assert.match(serverSource, /onReferences/);
  assert.match(serverSource, /onSignatureHelp/);
  assert.match(serverSource, /onRenameRequest/);
  assert.match(serverSource, /onWorkspaceSymbol/);
  assert.match(serverSource, /semanticTokens/);
  assert.match(serverSource, /closestResourceNames/);
  assert.match(serverSource, /argumentCountDiagnostics/);
  assert.match(serverSource, /eventAwareDiagnostics/);
  assert.match(serverSource, /maybe-uninitialized-instance-variable/);
  assert.match(serverSource, /draw-call-in-step/);
});

test("GameMaker knowledge is generated from data", async () => {
  const knowledgeSource = await readFile(
    path.join(__dirname, "..", "..", "src", "gmlKnowledge.ts"),
    "utf8",
  );
  const generatorSource = await readFile(
    path.join(__dirname, "..", "..", "scripts", "generate-gml-knowledge.mjs"),
    "utf8",
  );
  assert.match(knowledgeSource, /GENERATED_GML_BUILTINS/);
  assert.match(generatorSource, /gml-builtins\.seed\.json/);
  assert.match(generatorSource, /GENERATED_GML_EVENTS/);
});
