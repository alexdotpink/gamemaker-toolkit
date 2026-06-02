#!/usr/bin/env node
import { runTests } from "@vscode/test-electron";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

await runTests({
  extensionDevelopmentPath: repoRoot,
  extensionTestsPath: path.join(repoRoot, "test", "extension-host", "smoke.js"),
  launchArgs: [
    path.join(repoRoot, "public-fixtures"),
    "--disable-extensions",
    "--user-data-dir",
    path.join(repoRoot, ".vscode-test", "user-data"),
  ],
});
