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
  assert.match(serverSource, /onCompletion/);
  assert.match(serverSource, /onHover/);
  assert.match(serverSource, /onDefinition/);
  assert.match(serverSource, /onReferences/);
  assert.match(serverSource, /onWorkspaceSymbol/);
  assert.match(serverSource, /semanticTokens/);
});
