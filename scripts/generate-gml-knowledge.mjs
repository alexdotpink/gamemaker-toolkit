#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const input = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(repoRoot, "data", "gml-builtins.seed.json");
const output = path.join(repoRoot, "src", "generated", "gmlBuiltins.generated.ts");

const raw = JSON.parse(await readFile(input, "utf8"));
const builtins = normalizeBuiltins(raw.builtins ?? raw.functions ?? raw);
const events = normalizeEvents(raw.events ?? []);

builtins.sort((left, right) => left.name.localeCompare(right.name));
events.sort((left, right) => left.filePrefix.localeCompare(right.filePrefix));

const generated = [
  'import type { GmlBuiltin, GmlEventDefinition } from "../gmlKnowledge";\n',
  "",
  "export const GENERATED_GML_BUILTINS: GmlBuiltin[] = ",
  JSON.stringify(builtins, null, 2),
  ";",
  "",
  "export const GENERATED_GML_EVENTS: GmlEventDefinition[] = ",
  JSON.stringify(events, null, 2),
  ";",
  "",
].join("");

await writeFile(output, await formatTypescript(generated));

console.log(`Generated ${builtins.length} builtins and ${events.length} events into ${output}`);

function normalizeBuiltins(value) {
  if (!Array.isArray(value)) throw new Error("Expected an array or an object containing arrays");
  return value.map((entry) => {
    if (!entry.name) throw new Error(`Missing name in ${JSON.stringify(entry)}`);
    const parameters = entry.parameters ?? parseParameters(entry.signature ?? entry.name);
    return {
      ...entry,
      signature: entry.signature ?? signatureFor(entry.name, parameters),
      description: entry.description ?? entry.summary ?? "",
      kind: entry.kind ?? "function",
      parameters,
      requiredParameters:
        entry.requiredParameters ??
        parameters.filter((parameter) => !/^\[.*\]$/.test(parameter)).length,
    };
  });
}

function normalizeEvents(value) {
  if (!Array.isArray(value)) throw new Error("Expected events to be an array");
  return value.map((entry) => {
    if (!entry.filePrefix || !entry.name) {
      throw new Error(`Missing event filePrefix/name in ${JSON.stringify(entry)}`);
    }
    return {
      filePrefix: entry.filePrefix,
      name: entry.name,
      runsEveryFrame: Boolean(entry.runsEveryFrame),
      purpose: entry.purpose ?? "",
    };
  });
}

function parseParameters(signature) {
  const match = String(signature).match(/\((.*)\)/);
  if (!match || !match[1].trim()) return [];
  return match[1].split(",").map((parameter) => parameter.trim());
}

function signatureFor(name, parameters) {
  return parameters.length ? `${name}(${parameters.join(", ")})` : name;
}

async function formatTypescript(source) {
  try {
    const prettier = await import("prettier");
    const options = (await prettier.resolveConfig(output)) ?? {};
    return await prettier.format(source, { ...options, filepath: output, parser: "typescript" });
  } catch {
    return source;
  }
}
