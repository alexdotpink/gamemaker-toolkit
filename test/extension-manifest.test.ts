import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

test("extension manifest exposes formatter commands and settings", async () => {
  await assertExtensionManifest();
});

async function assertExtensionManifest(): Promise<void> {
  const packageJson = JSON.parse(
    await readFile(path.join(__dirname, "..", "..", "package.json"), "utf8"),
  ) as {
    name: string;
    displayName: string;
    publisher: string;
    author: string;
    main: string;
    scripts: Record<string, string>;
    contributes: {
      commands: Array<{ command: string }>;
      configurationDefaults: Record<string, { "editor.defaultFormatter"?: string }>;
      configuration: { properties: Record<string, { enum?: string[]; default?: unknown }> };
      grammars: Array<{ language: string; scopeName: string; path: string }>;
      snippets: Array<{ language: string; path: string }>;
    };
    activationEvents: string[];
  };
  const commands = new Set(packageJson.contributes.commands.map((command) => command.command));
  assert.equal(packageJson.name, "gamemaker-toolkit");
  assert.equal(packageJson.displayName, "GameMaker Toolkit");
  assert.equal(packageJson.publisher, "alexdotpink");
  assert.equal(packageJson.author, "alexdotpink");
  assert.equal(packageJson.main, "./dist/extension.js");
  assert.equal(
    packageJson.contributes.configurationDefaults["[gml]"]["editor.defaultFormatter"],
    "alexdotpink.gamemaker-toolkit",
  );
  assert.ok(commands.has("gmlFormatter.formatDocument"));
  assert.ok(commands.has("gmlFormatter.formatWithLexicalFallback"));
  assert.ok(commands.has("gmlFormatter.showDebugInfo"));
  assert.ok(commands.has("gmlFormatter.configureDefaultFormatter"));
  assert.ok(commands.has("gmlFormatter.diagnoseSetup"));
  assert.ok(commands.has("gmlFormatter.explainSkippedFormat"));
  assert.ok(commands.has("gmlFormatter.explainProblem"));
  assert.ok(commands.has("gmlFormatter.formatAndShowDiff"));
  assert.ok(commands.has("gmlFormatter.previewFormatChanges"));
  assert.ok(commands.has("gmlFormatter.workspaceDryRun"));
  assert.ok(commands.has("gmlFormatter.openPlayground"));
  assert.ok(commands.has("gmlFormatter.analyzeCurrentFile"));
  assert.ok(commands.has("gmlFormatter.projectDoctor"));
  assert.ok(commands.has("gmlFormatter.explainExpression"));
  assert.ok(commands.has("gmlFormatter.simplifyExpression"));
  assert.ok(commands.has("gmlFormatter.generateSceneNotes"));
  assert.ok(commands.has("gmlFormatter.analyzeStateMachine"));
  assert.ok(commands.has("gmlFormatter.openSceneFlowView"));
  assert.ok(commands.has("gmlFormatter.openProjectMap"));
  assert.ok(commands.has("gmlFormatter.rebuildProjectIndex"));
  assert.ok(commands.has("gmlFormatter.goToResource"));
  assert.ok(commands.has("gmlFormatter.exportDialogueCsv"));
  assert.ok(commands.has("gmlFormatter.previewSafeCleanup"));
  assert.ok(commands.has("gmlFormatter.applySafeCleanup"));
  assert.ok(commands.has("gmlFormatter.makeCodeReadable"));
  assert.ok(commands.has("gmlFormatter.explainCurrentFile"));
  assert.ok(commands.has("gmlFormatter.reportFormatterBug"));
  assert.ok(commands.has("gmlFormatter.installDoctor"));
  assert.ok(commands.has("gmlFormatter.openObjectEventMap"));
  assert.ok(commands.has("gmlFormatter.openCutsceneTimeline"));
  assert.ok(commands.has("gmlFormatter.previewStateEnum"));
  assert.ok(commands.has("gmlFormatter.previewResourceRename"));
  assert.ok(commands.has("gmlFormatter.openGlobalsReport"));
  assert.ok(commands.has("gmlFormatter.minimizeFormatterBug"));
  assert.ok(packageJson.activationEvents.includes("onCommand:gmlFormatter.openPlayground"));
  assert.ok(packageJson.activationEvents.includes("onCommand:gmlFormatter.projectDoctor"));
  assert.ok(packageJson.activationEvents.includes("onCommand:gmlFormatter.analyzeCurrentFile"));
  assert.ok(packageJson.activationEvents.includes("onCommand:gmlFormatter.openSceneFlowView"));
  assert.ok(packageJson.activationEvents.includes("onCommand:gmlFormatter.rebuildProjectIndex"));
  assert.ok(packageJson.activationEvents.includes("onCommand:gmlFormatter.makeCodeReadable"));
  assert.ok(packageJson.activationEvents.includes("onCommand:gmlFormatter.installDoctor"));
  assert.ok(packageJson.activationEvents.includes("onCommand:gmlFormatter.openObjectEventMap"));
  assert.ok(packageJson.activationEvents.includes("onCommand:gmlFormatter.openCutsceneTimeline"));
  assert.ok(packageJson.activationEvents.includes("onCommand:gmlFormatter.previewStateEnum"));
  assert.ok(packageJson.activationEvents.includes("onCommand:gmlFormatter.previewResourceRename"));
  assert.ok(packageJson.activationEvents.includes("onCommand:gmlFormatter.openGlobalsReport"));
  assert.ok(packageJson.activationEvents.includes("onCommand:gmlFormatter.minimizeFormatterBug"));
  assert.ok(packageJson.activationEvents.includes("onStartupFinished"));
  assert.ok("gmlFormatter.printWidth" in packageJson.contributes.configuration.properties);
  assert.ok("gmlFormatter.mode" in packageJson.contributes.configuration.properties);
  assert.ok("gmlFormatter.style" in packageJson.contributes.configuration.properties);
  assert.ok("gmlFormatter.safety" in packageJson.contributes.configuration.properties);
  assert.equal(
    packageJson.contributes.configuration.properties["gmlFormatter.safety"].default,
    "ast-and-trivia",
  );
  assert.equal(
    packageJson.contributes.configuration.properties["gmlFormatter.style"].default,
    "readable",
  );
  assert.ok(
    packageJson.contributes.configuration.properties["gmlFormatter.style"].enum?.includes(
      "compact",
    ),
  );
  assert.ok(
    packageJson.contributes.configuration.properties["gmlFormatter.style"].enum?.includes("repair"),
  );
  assert.ok(
    packageJson.contributes.configuration.properties["gmlFormatter.safety"].enum?.includes(
      "trivia-strict",
    ),
  );
  assert.ok("gmlFormatter.smartSimplify" in packageJson.contributes.configuration.properties);
  assert.ok("gmlFormatter.projectRules" in packageJson.contributes.configuration.properties);
  assert.deepEqual(
    packageJson.contributes.configuration.properties["gmlFormatter.projectRules"].default,
    {
      enableProjectPatternAnalysis: false,
      stateVariables: ["fase", "phase", "state"],
      languageVariables: [],
      requiredLanguages: [],
      dialogueObjects: [],
    },
  );
  assert.equal(
    packageJson.contributes.configuration.properties["gmlFormatter.readableSpacing"].default,
    true,
  );
  assert.equal(
    packageJson.contributes.configuration.properties["gmlFormatter.onboarding.enabled"].default,
    true,
  );
  assert.ok(packageJson.scripts.check.includes("formatter-tools.mjs check"));
  assert.ok(packageJson.scripts["format:check"].includes("prettier --check"));
  assert.ok(packageJson.scripts.write.includes("formatter-tools.mjs write"));
  assert.ok(packageJson.scripts.fuzz.includes("formatter-tools.mjs fuzz"));
  assert.ok(packageJson.scripts.analyze.includes("formatter-tools.mjs analyze"));
  assert.ok(packageJson.scripts["project-index"].includes("formatter-tools.mjs project-index"));
  assert.ok(packageJson.scripts["dialogue-export"].includes("formatter-tools.mjs dialogue-export"));
  assert.equal(
    packageJson.scripts["generate:gml-knowledge"],
    "node scripts/generate-gml-knowledge.mjs",
  );
  assert.ok(packageJson.scripts.build.includes("generate:gml-knowledge"));
  assert.ok(packageJson.scripts["snapshot:create"].includes("formatter-tools.mjs snapshot:create"));
  assert.ok(packageJson.scripts["snapshot:test"].includes("formatter-tools.mjs snapshot:test"));
  assert.ok(packageJson.scripts["snapshot:update"].includes("formatter-tools.mjs snapshot:update"));
  assert.deepEqual(packageJson.contributes.grammars[0], {
    language: "gml",
    scopeName: "source.gml",
    path: "./syntaxes/gml.tmLanguage.json",
  });
  assert.equal(packageJson.contributes.snippets[0].path, "./snippets/gml.code-snippets");
}
