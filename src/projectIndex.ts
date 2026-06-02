import path from "node:path";
import { GML_BUILTINS } from "./gmlKnowledge";

export interface GmlIndexedSymbol {
  name: string;
  kind: "resource" | "function" | "macro" | "enum" | "builtin";
  resourceType?: string;
  file: string;
  line: number;
  column: number;
  detail?: string;
}

export interface GmlResourceIndexEntry {
  name: string;
  type: string;
  file: string;
}

export interface GmlProjectIndex {
  root: string;
  resources: GmlResourceIndexEntry[];
  symbols: GmlIndexedSymbol[];
  unresolvedReferences: GmlIndexedSymbol[];
  resourceReferences: GmlIndexedSymbol[];
}

export interface GmlProjectFile {
  path: string;
  content: string;
}

const RESOURCE_ARGUMENT_CALLS = new Map([
  ["draw_sprite", new Set(["sprite", "object", "resource"])],
  ["draw_sprite_ext", new Set(["sprite", "object", "resource"])],
  ["audio_play_sound", new Set(["sound", "resource"])],
  ["instance_create_layer", new Set(["object", "resource"])],
  ["instance_create_depth", new Set(["object", "resource"])],
  ["room_goto", new Set(["room", "resource"])],
  ["draw_set_font", new Set(["font", "resource"])],
]);

export function buildGmlProjectIndex(root: string, files: GmlProjectFile[]): GmlProjectIndex {
  const resources = files
    .filter((file) => /\.(?:yy|yyp)$/i.test(file.path))
    .flatMap((file) => readResource(file));
  const resourceNames = new Set(resources.map((resource) => resource.name));
  const symbols: GmlIndexedSymbol[] = [
    ...resources.map((resource) => ({
      name: resource.name,
      kind: "resource" as const,
      resourceType: resource.type,
      file: resource.file,
      line: 1,
      column: 1,
      detail: resource.type,
    })),
    ...GML_BUILTINS.map((builtin) => ({
      name: builtin.name,
      kind: "builtin" as const,
      file: "<builtin>",
      line: 1,
      column: 1,
      detail: builtin.signature,
    })),
  ];
  const resourceReferences: GmlIndexedSymbol[] = [];

  for (const file of files.filter((candidate) => /\.gml$/i.test(candidate.path))) {
    symbols.push(...collectSourceSymbols(file));
    resourceReferences.push(...collectResourceReferences(file));
  }

  const unresolvedReferences = resourceReferences.filter(
    (reference) => !resourceNames.has(reference.name) && isLikelyStaticResourceName(reference.name),
  );

  return {
    root,
    resources: resources.sort(
      (left, right) => left.type.localeCompare(right.type) || left.name.localeCompare(right.name),
    ),
    symbols: dedupeSymbols(symbols),
    unresolvedReferences,
    resourceReferences,
  };
}

export function findSymbol(index: GmlProjectIndex, name: string): GmlIndexedSymbol | undefined {
  return index.symbols.find((symbol) => symbol.name === name);
}

export function referencesFor(index: GmlProjectIndex, name: string): GmlIndexedSymbol[] {
  return index.resourceReferences.filter((symbol) => symbol.name === name);
}

function readResource(file: GmlProjectFile): GmlResourceIndexEntry[] {
  try {
    const json = JSON.parse(file.content) as {
      name?: string;
      resourceType?: string;
      resources?: Array<{ id?: { name?: string; path?: string }; name?: string; path?: string }>;
    };
    const entries: GmlResourceIndexEntry[] = [];
    if (json.name) {
      entries.push({
        name: json.name,
        type: json.resourceType ?? (file.path.endsWith(".yyp") ? "project" : "resource"),
        file: file.path,
      });
    }
    for (const resource of json.resources ?? []) {
      const name =
        resource.id?.name ??
        resource.name ??
        path.basename(resource.id?.path ?? resource.path ?? "", ".yy");
      if (name) entries.push({ name, type: "resource", file: file.path });
    }
    return entries;
  } catch {
    const name = stringProperty(file.content, "%Name") ?? stringProperty(file.content, "name");
    if (!name) return [];
    return [
      {
        name,
        type:
          inferResourceTypeFromPath(file.path) ??
          stringProperty(file.content, "resourceType") ??
          "resource",
        file: file.path,
      },
    ];
  }
}

function stringProperty(content: string, property: string): string | undefined {
  const escaped = property.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return content.match(new RegExp(`"${escaped}"\\s*:\\s*"([^"]+)"`))?.[1];
}

function inferResourceTypeFromPath(file: string): string | undefined {
  const normalized = file.replace(/\\/g, "/");
  if (normalized.includes("/sprites/")) return "GMSprite";
  if (normalized.includes("/objects/")) return "GMObject";
  if (normalized.includes("/rooms/")) return "GMRoom";
  if (normalized.includes("/sounds/")) return "GMSound";
  if (normalized.includes("/fonts/")) return "GMFont";
  if (normalized.endsWith(".yyp")) return "project";
  return undefined;
}

function collectSourceSymbols(file: GmlProjectFile): GmlIndexedSymbol[] {
  const symbols: GmlIndexedSymbol[] = [];
  const lines = file.content.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  lines.forEach((line, index) => {
    const candidates: Array<{
      kind: GmlIndexedSymbol["kind"];
      match: RegExpMatchArray | null;
      detail: string;
    }> = [
      {
        kind: "function",
        match: line.match(/^\s*function\s+([A-Za-z_][A-Za-z0-9_]*)/),
        detail: "function",
      },
      {
        kind: "macro",
        match: line.match(/^\s*#macro\s+([A-Za-z_][A-Za-z0-9_]*)/),
        detail: "#macro",
      },
      { kind: "enum", match: line.match(/^\s*enum\s+([A-Za-z_][A-Za-z0-9_]*)/), detail: "enum" },
    ];
    for (const candidate of candidates) {
      if (!candidate.match) continue;
      symbols.push({
        name: candidate.match[1],
        kind: candidate.kind,
        file: file.path,
        line: index + 1,
        column: Math.max(1, line.indexOf(candidate.match[1]) + 1),
        detail: candidate.detail,
      });
    }
  });
  return symbols;
}

function collectResourceReferences(file: GmlProjectFile): GmlIndexedSymbol[] {
  const references: GmlIndexedSymbol[] = [];
  const lines = file.content.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  lines.forEach((line, index) => {
    const code = stripLineComment(line);
    for (const [call, acceptedTypes] of RESOURCE_ARGUMENT_CALLS) {
      const pattern = new RegExp(`\\b${call}\\s*\\(([^\\n)]*)`, "g");
      for (const match of code.matchAll(pattern)) {
        const args = splitCallArguments(match[1]);
        const resourceName = resourceArgumentForCall(call, args);
        if (!resourceName || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(resourceName)) continue;
        references.push({
          name: resourceName,
          kind: "resource",
          resourceType: [...acceptedTypes].join("|"),
          file: file.path,
          line: index + 1,
          column: Math.max(1, line.indexOf(resourceName) + 1),
          detail: `${call}(...)`,
        });
      }
    }
  });
  return references;
}

function resourceArgumentForCall(call: string, args: string[]): string | undefined {
  if (call === "instance_create_layer" || call === "instance_create_depth") return args[3]?.trim();
  if (call === "mp_potential_path") return args[1]?.trim();
  return args[0]?.trim();
}

function splitCallArguments(text: string): string[] {
  const args: string[] = [];
  let start = 0;
  let depth = 0;
  let quote: string | undefined;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quote) {
      if (char === quote && text[index - 1] !== "\\") quote = undefined;
      continue;
    }
    if (char === '"' || char === "'" || char === "`") {
      quote = char;
      continue;
    }
    if (char === "(" || char === "[" || char === "{") depth += 1;
    else if (char === ")" || char === "]" || char === "}") depth -= 1;
    else if (char === "," && depth === 0) {
      args.push(text.slice(start, index).trim());
      start = index + 1;
    }
  }
  const final = text.slice(start).trim();
  if (final) args.push(final);
  return args;
}

function stripLineComment(line: string): string {
  const index = line.indexOf("//");
  return index === -1 ? line : line.slice(0, index);
}

function dedupeSymbols(symbols: GmlIndexedSymbol[]): GmlIndexedSymbol[] {
  const seen = new Set<string>();
  const result: GmlIndexedSymbol[] = [];
  for (const symbol of symbols) {
    const key = `${symbol.kind}:${symbol.name}:${symbol.file}:${symbol.line}:${symbol.column}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(symbol);
  }
  return result;
}

function isLikelyStaticResourceName(name: string): boolean {
  return (
    /^[A-Z0-9_]+$/.test(name) ||
    /_(?:SP|OBJ|ROOM|SND|FONT)$/i.test(name) ||
    /^(?:spr|obj|rm|snd|fnt)_/i.test(name)
  );
}
