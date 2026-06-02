#!/usr/bin/env node
import { createServer } from "node:http";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

process.env.GML_FORMATTER_LOAD_FROM_NODE_MODULES = "1";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { formatGml, formatGmlDocument, getGmlFormatterDebugInfo } =
  await import("../dist/src/formatter.js");
const { analyzeGmlSource, simplifyExpressionText, analyzeExpressionAtText } =
  await import("../dist/src/analysis.js");
const { buildGmlProjectIndex } = await import("../dist/src/projectIndex.js");
const command = process.argv[2];

if (!command || ["-h", "--help", "help"].includes(command)) {
  printHelp();
  process.exit(command ? 0 : 1);
}

if (command === "fixtures:test") {
  await testFixtures(false);
} else if (command === "fixtures:update") {
  await testFixtures(true);
} else if (command === "corpus") {
  await runCorpus(process.argv.slice(3));
} else if (command === "check") {
  await checkOrWrite(process.argv.slice(3), false);
} else if (command === "write") {
  await checkOrWrite(process.argv.slice(3), true);
} else if (command === "fuzz") {
  await runFuzz(Number(process.argv[3] ?? 1));
} else if (command === "analyze") {
  await analyzeTarget(process.argv[3]);
} else if (command === "project-index") {
  await projectIndexTarget(process.argv[3]);
} else if (command === "dialogue-export") {
  await dialogueExportTarget(process.argv[3]);
} else if (command === "simplify-expression") {
  simplifyExpression(process.argv.slice(3).join(" "));
} else if (command === "snapshot:create") {
  await createSnapshot(process.argv[3], process.argv[4]);
} else if (command === "snapshot:test") {
  await testSnapshot(process.argv[3], false);
} else if (command === "snapshot:update") {
  await testSnapshot(process.argv[3], true);
} else if (command === "debug-format") {
  await debugFormat(process.argv[3]);
} else if (command === "playground") {
  await startPlayground(Number(process.argv[3] ?? 7331));
} else {
  console.error(`Unknown command: ${command}`);
  printHelp();
  process.exit(1);
}

function printHelp() {
  console.log(`Usage:
  pnpm fixtures:test
  pnpm fixtures:update
  pnpm corpus <project-or-folder> [--safety ast-equivalence]
  pnpm check <project-or-folder> [--json] [--safety ast-equivalence]
  pnpm write <project-or-folder>
  pnpm fuzz [rounds]
  pnpm analyze <file-or-folder>
  pnpm project-index <project-or-folder>
  pnpm dialogue-export <file-or-folder>
  pnpm simplify-expression <expression>
  pnpm snapshot:create <project-or-folder> <name>
  pnpm snapshot:test <name>
  pnpm snapshot:update <name>
  pnpm debug-format <file.gml>
  pnpm playground [port]`);
}

async function projectIndexTarget(target) {
  if (!target) throw new Error("project-index requires a project/folder path");
  const resolved = path.resolve(target);
  const files = await findProjectFiles(resolved);
  const index = buildGmlProjectIndex(resolved, await readProjectFiles(files));
  console.log(
    JSON.stringify(
      {
        root: index.root,
        resources: index.resources.length,
        symbols: index.symbols.length,
        resourceReferences: index.resourceReferences.length,
        unresolvedReferences: index.unresolvedReferences,
      },
      null,
      2,
    ),
  );
}

async function dialogueExportTarget(target) {
  if (!target) throw new Error("dialogue-export requires a .gml file or folder path");
  const resolved = path.resolve(target);
  const info = await stat(resolved);
  const files = info.isDirectory() ? await findGmlFiles(resolved) : [resolved];
  const rows = [
    [
      "file",
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
  for (const file of files) {
    const report = await analyzeGmlSource(await readFile(file, "utf8"));
    for (const dialogue of report.dialogueCases) {
      rows.push([
        file,
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
  }
  console.log(rows.map((row) => row.map(csvCell).join(",")).join("\n"));
}

async function analyzeTarget(target) {
  if (!target) throw new Error("analyze requires a .gml file or folder path");
  const resolved = path.resolve(target);
  const info = await stat(resolved);
  const files = info.isDirectory() ? await findGmlFiles(resolved) : [resolved];
  const reports = [];
  for (const file of files) {
    const report = await analyzeGmlSource(await readFile(file, "utf8"));
    reports.push({
      file,
      confidence: report.confidence,
      metrics: report.metrics,
      findings: report.findings,
      todoComments: report.todoComments,
      stateMachines: report.stateMachines.map((machine) => ({
        variable: machine.variable,
        line: machine.line,
        cases: machine.cases.length,
        warnings: machine.warnings,
      })),
      dialogueCases: report.dialogueCases.map((dialogue) => ({
        room: dialogue.room,
        txtNum: dialogue.txtNum,
        line: dialogue.line,
        warnings: dialogue.warnings,
      })),
      magicNumbers: report.magicNumbers.slice(0, 20),
      suspiciousNames: report.suspiciousNames,
      assetReferences: report.assetReferences,
      constantExpressions: report.constantExpressions,
      repeatedExpressions: report.repeatedExpressions,
    });
  }
  console.log(JSON.stringify({ scanned: files.length, reports }, null, 2));
}

function csvCell(value) {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function simplifyExpression(expression) {
  const simplified = simplifyExpressionText(expression);
  const explanation = analyzeExpressionAtText(expression);
  console.log(JSON.stringify({ expression, simplified, explanation }, null, 2));
}

async function testFixtures(update) {
  const fixturesDir = path.join(repoRoot, "test", "fixtures");
  const inputs = (await readdir(fixturesDir)).filter((file) => file.endsWith(".input.gml"));
  let failures = 0;
  for (const inputFile of inputs) {
    const baseName = inputFile.replace(".input.gml", "");
    const input = await readFile(path.join(fixturesDir, inputFile), "utf8");
    const expectedPath = path.join(fixturesDir, `${baseName}.expected.gml`);
    const formatted = await formatGml(input, { printWidth: 80 });
    if (update) {
      await writeFile(expectedPath, formatted);
      console.log(`updated ${baseName}`);
      continue;
    }
    const expected = await readFile(expectedPath, "utf8");
    if (formatted !== expected) {
      failures += 1;
      console.error(`fixture mismatch: ${baseName}`);
    } else {
      console.log(`ok ${baseName}`);
    }
  }
  if (failures) process.exit(1);
}

async function runCorpus(args) {
  const target = args.find((arg) => !arg.startsWith("--"));
  const formatOptions = parseFormatOptions(args);
  if (!target) {
    throw new Error("corpus requires a project or folder path");
  }
  const files = await findGmlFiles(path.resolve(target));
  let parsed = 0;
  let parserFailed = 0;
  let changed = 0;
  let nonIdempotent = 0;
  let reparseFailed = 0;
  let safetyFailed = 0;

  for (const file of files) {
    const source = await readFile(file, "utf8");
    const first = await formatGmlDocument(source, formatOptions);
    if (first.parserErrors.length) {
      parserFailed += 1;
      console.log(`parse failed ${file}: ${first.parserErrors[0]}`);
      continue;
    }
    if (first.safetyErrors.length) {
      safetyFailed += 1;
      console.log(`safety failed ${file}: ${first.safetyDiagnostics[0] ?? first.safetyErrors[0]}`);
      continue;
    }
    parsed += 1;
    if (first.changed) changed += 1;
    const second = await formatGmlDocument(first.formatted, formatOptions);
    if (second.parserErrors.length) {
      reparseFailed += 1;
      console.log(`reparse failed ${file}: ${second.parserErrors[0]}`);
    } else if (second.safetyErrors.length) {
      safetyFailed += 1;
      console.log(
        `second-pass safety failed ${file}: ${second.safetyDiagnostics[0] ?? second.safetyErrors[0]}`,
      );
    } else if (second.formatted !== first.formatted) {
      nonIdempotent += 1;
      console.log(`non-idempotent ${file}`);
    }
  }

  console.log(
    JSON.stringify(
      {
        scanned: files.length,
        parsed,
        parserFailed,
        formatted: parsed,
        reparseFailed,
        safetyFailed,
        nonIdempotent,
        changed,
      },
      null,
      2,
    ),
  );
  if (parserFailed || reparseFailed || safetyFailed || nonIdempotent) process.exit(1);
}

async function checkOrWrite(args, write) {
  const target = args.find((arg) => !arg.startsWith("--"));
  const json = args.includes("--json");
  const formatOptions = parseFormatOptions(args);
  if (!target) {
    throw new Error(`${write ? "write" : "check"} requires a project or folder path`);
  }

  const files = await findGmlFiles(path.resolve(target));
  const result = {
    scanned: files.length,
    changed: 0,
    written: 0,
    parserFailed: 0,
    safetyFailed: 0,
    nonIdempotent: 0,
    failures: [],
  };

  for (const file of files) {
    const source = await readFile(file, "utf8");
    const first = await formatGmlDocument(source, formatOptions);
    if (first.parserErrors.length) {
      result.parserFailed += 1;
      result.failures.push({ file, kind: "parse", message: first.parserErrors[0] });
      continue;
    }
    if (first.safetyErrors.length) {
      result.safetyFailed += 1;
      result.failures.push({
        file,
        kind: "safety",
        message: first.safetyDiagnostics[0] ?? first.safetyErrors[0],
      });
      continue;
    }
    const second = await formatGmlDocument(first.formatted, formatOptions);
    if (
      second.formatted !== first.formatted ||
      second.parserErrors.length ||
      second.safetyErrors.length
    ) {
      result.nonIdempotent += 1;
      result.failures.push({
        file,
        kind: "idempotency",
        message:
          second.parserErrors[0] ?? second.safetyDiagnostics[0] ?? "second format changed output",
      });
      continue;
    }
    if (first.changed) {
      result.changed += 1;
      if (write) {
        await writeFile(file, first.formatted);
        result.written += 1;
      }
      if (!json) console.log(`${write ? "wrote" : "would change"} ${file}`);
    }
  }

  if (json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(
      `${write ? "write" : "check"} complete: scanned ${result.scanned}, changed ${result.changed}, written ${result.written}, parserFailed ${result.parserFailed}, safetyFailed ${result.safetyFailed}, nonIdempotent ${result.nonIdempotent}`,
    );
    for (const failure of result.failures.slice(0, 20)) {
      console.log(`${failure.kind} ${failure.file}: ${failure.message}`);
    }
  }
  if (!write && result.changed > 0) process.exitCode = 1;
  if (result.parserFailed || result.safetyFailed || result.nonIdempotent) process.exitCode = 1;
}

function parseFormatOptions(args) {
  const safetyIndex = args.indexOf("--safety");
  return safetyIndex === -1 ? {} : { safety: args[safetyIndex + 1] };
}

async function runFuzz(rounds) {
  const seeds = [
    "if (a) b = -1",
    "if (a) if (b) c = 1 else c = 2",
    "switch (x) { case -1: y *= -1 break }",
    "arr = [1,-2,foo(-3)]",
    "obj = {a:-1,b:x*-2}",
    "for (var i=0;i<10;i++) show_debug_message(i)",
    "do value+=1 until value>=10",
    "with (obj_enemy) hp-=1",
    "return ((a+b)*(c-d))",
  ];
  const generated = generateFuzzSnippets(rounds * 50);
  let checked = 0;
  for (let round = 0; round < rounds; round += 1) {
    for (const seed of [...seeds, ...generated]) {
      checked += 1;
      const result = await formatGmlDocument(seed);
      if (result.parserErrors.length || result.safetyErrors.length) {
        console.error(`fuzz failed: ${seed}`);
        console.error(
          result.parserErrors[0] ?? result.safetyDiagnostics[0] ?? result.safetyErrors[0],
        );
        process.exit(1);
      }
      const second = await formatGmlDocument(result.formatted);
      if (second.formatted !== result.formatted) {
        console.error(`fuzz non-idempotent: ${seed}`);
        process.exit(1);
      }
    }
  }
  console.log(`fuzz ok: ${checked} snippets`);
}

function generateFuzzSnippets(count) {
  const ids = ["a", "b", "c", "hp", "speed", "value", "index", "state"];
  const calls = ["foo", "bar", "show_debug_message", "draw_sprite"];
  const snippets = [];
  for (let index = 0; index < count; index += 1) {
    const a = ids[index % ids.length];
    const b = ids[(index + 3) % ids.length];
    const call = calls[index % calls.length];
    const n = (index % 7) + 1;
    snippets.push(`${a} = (${b} + ${n}) * -${n}`);
    snippets.push(`if (${a} > -${n}) ${call}(${a}, [1,-2,${n}])`);
    snippets.push(
      `switch (${a}) { case -${n}: ${b} += ${n}; break; default: ${b} = {value:${n}, alt:-${n}}; }`,
    );
    snippets.push(`for (var i=0;i<${n + 2};i++) ${a}[i] = ${call}(i, -${n})`);
  }
  return snippets;
}

async function createSnapshot(target, name) {
  if (!target || !name) {
    throw new Error("snapshot:create requires a project/folder path and a snapshot name");
  }
  const snapshotRoot = path.join(repoRoot, "test", "corpus-snapshots", name);
  await mkdir(snapshotRoot, { recursive: true });
  const files = await findGmlFiles(path.resolve(target));
  const manifest = [];
  for (const file of files) {
    const source = await readFile(file, "utf8");
    const result = await formatGmlDocument(source);
    if (result.parserErrors.length || result.safetyErrors.length) {
      throw new Error(
        `cannot snapshot ${file}: ${result.parserErrors[0] ?? result.safetyDiagnostics[0] ?? result.safetyErrors[0]}`,
      );
    }
    const relative = path.relative(path.resolve(target), file);
    const outputPath = path.join(snapshotRoot, `${relative}.formatted.gml`);
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, result.formatted);
    manifest.push({ source: relative, snapshot: `${relative}.formatted.gml` });
  }
  await writeFile(
    path.join(snapshotRoot, "manifest.json"),
    JSON.stringify({ target: path.resolve(target), files: manifest }, null, 2),
  );
  console.log(`snapshot ${name} created with ${manifest.length} file(s)`);
}

async function testSnapshot(name, update) {
  if (!name) {
    throw new Error(`${update ? "snapshot:update" : "snapshot:test"} requires a snapshot name`);
  }
  const snapshotRoot = path.join(repoRoot, "test", "corpus-snapshots", name);
  const manifest = JSON.parse(await readFile(path.join(snapshotRoot, "manifest.json"), "utf8"));
  let failures = 0;
  for (const entry of manifest.files) {
    const sourcePath = path.join(manifest.target, entry.source);
    const snapshotPath = path.join(snapshotRoot, entry.snapshot);
    const result = await formatGmlDocument(await readFile(sourcePath, "utf8"));
    if (result.parserErrors.length || result.safetyErrors.length) {
      failures += 1;
      console.error(
        `snapshot failed ${entry.source}: ${result.parserErrors[0] ?? result.safetyDiagnostics[0] ?? result.safetyErrors[0]}`,
      );
      continue;
    }
    if (update) {
      await writeFile(snapshotPath, result.formatted);
      console.log(`updated ${entry.source}`);
      continue;
    }
    const expected = await readFile(snapshotPath, "utf8");
    if (result.formatted !== expected) {
      failures += 1;
      console.error(`snapshot mismatch ${entry.source}`);
    }
  }
  if (failures) process.exit(1);
  console.log(
    `${update ? "snapshot update" : "snapshot test"} ok: ${manifest.files.length} file(s)`,
  );
}

async function debugFormat(filePath) {
  if (!filePath) throw new Error("debug-format requires a file");
  const source = await readFile(path.resolve(filePath), "utf8");
  const debug = await getGmlFormatterDebugInfo(source);
  const result = await formatGmlDocument(source, { printWidth: 80 });
  console.log("DEBUG");
  console.log(JSON.stringify(debug, null, 2));
  console.log("\nFORMATTED");
  console.log(result.formatted);
}

async function startPlayground(port) {
  const server = createServer(async (request, response) => {
    if (request.method === "POST" && request.url === "/format") {
      let body = "";
      request.on("data", (chunk) => (body += chunk));
      request.on("end", async () => {
        const result = await formatGmlDocument(body, { printWidth: 80 });
        response.writeHead(result.parserErrors.length ? 400 : 200, {
          "content-type": "text/plain",
        });
        response.end(
          result.parserErrors.length ? result.parserErrors.join("\n") : result.formatted,
        );
      });
      return;
    }
    response.writeHead(200, { "content-type": "text/html" });
    response.end(`<!doctype html>
<title>GameMaker Toolkit Playground</title>
<style>body{font-family:sans-serif;margin:24px}textarea{width:48%;height:70vh;font-family:monospace}button{display:block;margin:12px 0}</style>
<h1>GameMaker Toolkit Playground</h1>
<textarea id=input>if x show_debug_message("hi")</textarea>
<textarea id=output readonly></textarea>
<button onclick="format()">Format</button>
<script>
async function format(){
  const res = await fetch('/format', {method:'POST', body: input.value});
  output.value = await res.text();
}
</script>`);
  });
  server.listen(port, () => console.log(`GML formatter playground: http://127.0.0.1:${port}`));
}

async function findGmlFiles(root) {
  const rootInfo = await stat(root);
  if (rootInfo.isFile()) return root.toLowerCase().endsWith(".gml") ? [root] : [];
  const entries = await readdir(root);
  const files = [];
  for (const entry of entries) {
    if (entry === "node_modules" || entry === ".git") continue;
    const fullPath = path.join(root, entry);
    const info = await stat(fullPath);
    if (info.isDirectory()) files.push(...(await findGmlFiles(fullPath)));
    else if (entry.toLowerCase().endsWith(".gml")) files.push(fullPath);
  }
  return files;
}

async function findProjectFiles(root) {
  const rootInfo = await stat(root);
  if (rootInfo.isFile()) {
    return /\.(?:gml|yy|yyp)$/i.test(root) ? [root] : [];
  }
  const entries = await readdir(root);
  const files = [];
  for (const entry of entries) {
    if (entry === "node_modules" || entry === ".git") continue;
    const fullPath = path.join(root, entry);
    const info = await stat(fullPath);
    if (info.isDirectory()) files.push(...(await findProjectFiles(fullPath)));
    else if (/\.(?:gml|yy|yyp)$/i.test(entry)) files.push(fullPath);
  }
  return files;
}

async function readProjectFiles(files) {
  const result = [];
  for (const file of files) {
    result.push({ path: file, content: await readFile(file, "utf8") });
  }
  return result;
}
