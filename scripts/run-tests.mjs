import { readdirSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const testDir = join(process.cwd(), "dist", "test");
const testFiles = readdirSync(testDir)
  .filter((name) => name.endsWith(".test.js"))
  .sort()
  .map((name) => join(testDir, name));

if (testFiles.length === 0) {
  console.error("No compiled test files found in dist/test.");
  process.exit(1);
}

const result = spawnSync(process.execPath, ["--test", ...testFiles], {
  stdio: "inherit",
  env: {
    ...process.env,
    GML_FORMATTER_LOAD_FROM_NODE_MODULES: "1",
  },
});

process.exit(result.status ?? 1);
