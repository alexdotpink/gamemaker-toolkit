import path from "node:path";
import { findEventDefinition, GML_BUILTINS, type GmlEventDefinition } from "./gmlKnowledge";

export interface GmlIndexedSymbol {
  name: string;
  kind: "resource" | "function" | "macro" | "enum" | "builtin" | "variable" | "field";
  resourceType?: string;
  file: string;
  line: number;
  column: number;
  detail?: string;
  suggestions?: string[];
}

export interface GmlResourceIndexEntry {
  name: string;
  type: string;
  file: string;
  line?: number;
  column?: number;
  parentName?: string;
  spriteName?: string;
}

export interface GmlProjectIndex {
  root: string;
  resources: GmlResourceIndexEntry[];
  symbols: GmlIndexedSymbol[];
  unresolvedReferences: GmlIndexedSymbol[];
  resourceReferences: GmlIndexedSymbol[];
  identifierReferences: GmlIndexedSymbol[];
  rooms: GmlRoomInfo[];
  inferredTypes: GmlInferredType[];
  objectEvents: GmlObjectEvent[];
  graph: GmlProjectGraph;
}

export interface GmlProjectFile {
  path: string;
  content: string;
}

export interface GmlRoomInfo {
  name: string;
  file: string;
  layers: string[];
  instances: Array<{ objectName: string; layerName?: string }>;
}

export interface GmlInferredType {
  name: string;
  type: "sprite" | "object" | "room" | "sound" | "font" | "resource" | "number" | "string";
  file: string;
  line: number;
  detail: string;
}

export interface GmlObjectEvent {
  objectName: string;
  eventName: string;
  eventPrefix: string;
  file: string;
  definition?: GmlEventDefinition;
}

export interface GmlVariableLifecycle {
  objectName: string;
  variable: string;
  assignedInCreate: boolean;
  assignedFiles: string[];
  readFiles: string[];
}

export interface GmlProjectGraph {
  resourceUsage: Array<{
    resource: GmlResourceIndexEntry;
    references: GmlIndexedSymbol[];
    rooms: string[];
  }>;
  unusedResources: GmlResourceIndexEntry[];
  missingLayerReferences: Array<{
    layerName: string;
    file: string;
    line: number;
    call: string;
  }>;
  resourceTypeMismatches: Array<{
    name: string;
    expected: string;
    actual: string;
    file: string;
    line: number;
  }>;
  variableLifecycle: GmlVariableLifecycle[];
  maybeUninitializedVariables: GmlVariableLifecycle[];
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
for (const builtin of GML_BUILTINS) {
  for (const argument of builtin.resourceArguments ?? []) {
    const acceptedTypes = RESOURCE_ARGUMENT_CALLS.get(builtin.name) ?? new Set<string>();
    acceptedTypes.add(argument.type);
    RESOURCE_ARGUMENT_CALLS.set(builtin.name, acceptedTypes);
  }
}

export function buildGmlProjectIndex(root: string, files: GmlProjectFile[]): GmlProjectIndex {
  const resources = files
    .filter((file) => /\.(?:yy|yyp)$/i.test(file.path))
    .flatMap((file) => readResource(file));
  const resourceNames = new Set(resources.map((resource) => resource.name));
  const resourceByName = new Map(resources.map((resource) => [resource.name, resource]));
  const rooms = files.filter((file) => /\.yy$/i.test(file.path)).flatMap((file) => readRoom(file));
  const symbols: GmlIndexedSymbol[] = [
    ...resources.map((resource) => ({
      name: resource.name,
      kind: "resource" as const,
      resourceType: resource.type,
      file: resource.file,
      line: resource.line ?? 1,
      column: resource.column ?? 1,
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
  const identifierReferences: GmlIndexedSymbol[] = [];
  const inferredTypes: GmlInferredType[] = [];
  const objectEvents: GmlObjectEvent[] = [];

  for (const file of files.filter((candidate) => /\.gml$/i.test(candidate.path))) {
    const objectEvent = eventFromPath(file.path);
    if (objectEvent) objectEvents.push(objectEvent);
    symbols.push(...collectSourceSymbols(file));
    const references = collectResourceReferences(file);
    resourceReferences.push(...references);
    identifierReferences.push(...collectIdentifierReferences(file));
    inferredTypes.push(...inferTypes(file, references));
  }

  const suggestionIndex = {
    root,
    resources,
    symbols,
    unresolvedReferences: [] as GmlIndexedSymbol[],
    resourceReferences,
    identifierReferences,
    rooms,
    inferredTypes,
    objectEvents,
    graph: emptyGraph(),
  };
  const unresolvedReferences = resourceReferences
    .filter(
      (reference) =>
        !resourceNames.has(reference.name) && isLikelyStaticResourceName(reference.name),
    )
    .map((reference) => ({
      ...reference,
      suggestions: closestResourceNames(suggestionIndex, reference.name),
    }));

  const index = {
    root,
    resources: resources.sort(
      (left, right) => left.type.localeCompare(right.type) || left.name.localeCompare(right.name),
    ),
    symbols: dedupeSymbols(symbols),
    unresolvedReferences,
    resourceReferences,
    identifierReferences,
    rooms,
    inferredTypes,
    objectEvents,
    graph: emptyGraph(),
  };
  index.graph = buildProjectGraph(index, resourceByName);
  return index;
}

export function findSymbol(index: GmlProjectIndex, name: string): GmlIndexedSymbol | undefined {
  return index.symbols.find((symbol) => symbol.name === name);
}

export function referencesFor(index: GmlProjectIndex, name: string): GmlIndexedSymbol[] {
  return [...index.resourceReferences, ...index.identifierReferences].filter(
    (symbol) => symbol.name === name,
  );
}

export function eventFromPath(file: string): GmlObjectEvent | undefined {
  const normalized = file.replace(/\\/g, "/");
  const match = normalized.match(/\/objects\/([^/]+)\/([A-Za-z]+)[^/]*\.gml$/i);
  if (!match) return undefined;
  const eventPrefix = match[2];
  return {
    objectName: match[1],
    eventName: findEventDefinition(eventPrefix)?.name ?? eventPrefix,
    eventPrefix,
    file,
    definition: findEventDefinition(eventPrefix),
  };
}

export function closestResourceNames(index: GmlProjectIndex, name: string, limit = 3): string[] {
  return [...new Set(index.resources.map((resource) => resource.name))]
    .map((resource) => ({
      name: resource,
      distance: levenshtein(resource.toLowerCase(), name.toLowerCase()),
    }))
    .filter((candidate) => candidate.distance <= Math.max(3, Math.floor(name.length / 3)))
    .sort((left, right) => left.distance - right.distance || left.name.localeCompare(right.name))
    .slice(0, limit)
    .map((candidate) => candidate.name);
}

function readResource(file: GmlProjectFile): GmlResourceIndexEntry[] {
  try {
    const json = JSON.parse(file.content) as {
      name?: string;
      resourceType?: string;
      parent?: { name?: string };
      spriteId?: { name?: string };
      resources?: Array<{ id?: { name?: string; path?: string }; name?: string; path?: string }>;
    };
    const entries: GmlResourceIndexEntry[] = [];
    if (json.name) {
      const position = propertyValuePosition(file.content, "name", json.name);
      entries.push({
        name: json.name,
        type: json.resourceType ?? (file.path.endsWith(".yyp") ? "project" : "resource"),
        file: file.path,
        line: position.line,
        column: position.column,
        parentName: json.parent?.name,
        spriteName: json.spriteId?.name,
      });
    }
    for (const resource of json.resources ?? []) {
      const name =
        resource.id?.name ??
        resource.name ??
        path.basename(resource.id?.path ?? resource.path ?? "", ".yy");
      if (name) {
        const position = propertyValuePosition(file.content, "name", name);
        entries.push({
          name,
          type: "resource",
          file: file.path,
          line: position.line,
          column: position.column,
        });
      }
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
        ...propertyValuePosition(file.content, "%Name", name),
      },
    ];
  }
}

function propertyValuePosition(
  content: string,
  property: string,
  value: string,
): { line: number; column: number } {
  const propertyIndex = content.indexOf(`"${property}"`);
  const valueIndex =
    propertyIndex === -1
      ? content.indexOf(`"${value}"`)
      : content.indexOf(`"${value}"`, propertyIndex);
  if (valueIndex === -1) return { line: 1, column: 1 };
  const before = content.slice(0, valueIndex + 1);
  const lines = before.split(/\r?\n/);
  return { line: lines.length, column: lines[lines.length - 1].length + 1 };
}

function readRoom(file: GmlProjectFile): GmlRoomInfo[] {
  try {
    const json = JSON.parse(file.content) as {
      name?: string;
      resourceType?: string;
      layers?: Array<{
        name?: string;
        instances?: Array<{ objectId?: { name?: string }; name?: string }>;
      }>;
    };
    if (!json.name || !/room/i.test(json.resourceType ?? file.path)) return [];
    const layers = (json.layers ?? []).map((layer) => layer.name).filter(isString);
    const instances = (json.layers ?? []).flatMap((layer) =>
      (layer.instances ?? [])
        .map((instance) => ({
          objectName: instance.objectId?.name ?? instance.name ?? "",
          layerName: layer.name,
        }))
        .filter((instance) => Boolean(instance.objectName)),
    );
    return [{ name: json.name, file: file.path, layers, instances }];
  } catch {
    return [];
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
      {
        kind: "variable",
        match: line.match(/^\s*(?:var|static|globalvar)\s+([A-Za-z_][A-Za-z0-9_]*)/),
        detail: "variable",
      },
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

function collectIdentifierReferences(file: GmlProjectFile): GmlIndexedSymbol[] {
  const references: GmlIndexedSymbol[] = [];
  const lines = file.content.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  lines.forEach((line, index) => {
    const code = stripLineComment(line);
    const assignmentTargets = new Set(
      [...code.matchAll(/\b([A-Za-z_][A-Za-z0-9_.]*)\s*(?:=|\+=|-=|\*=|\/=|%=)/g)].map(
        (match) => match[1],
      ),
    );
    const dottedReferences = new Set<string>();
    for (const match of code.matchAll(/\b(global\.[A-Za-z_][A-Za-z0-9_]*)\b/g)) {
      dottedReferences.add(match[1]);
      references.push({
        name: match[1],
        kind: "field",
        file: file.path,
        line: index + 1,
        column: (match.index ?? 0) + 1,
        detail: assignmentTargets.has(match[1])
          ? "global field assignment"
          : "global field reference",
      });
    }
    for (const match of code.matchAll(/\b[A-Za-z_][A-Za-z0-9_]*\b/g)) {
      const name = match[0];
      const previousChar = match.index === undefined ? "" : code[match.index - 1];
      if (previousChar === ".") continue;
      const dottedParent = [...dottedReferences].some(
        (dotted) =>
          match.index !== undefined &&
          match.index >= code.indexOf(dotted) &&
          match.index < code.indexOf(dotted) + dotted.length,
      );
      if (dottedParent && name !== "global") continue;
      if (isKeyword(name) || GML_BUILTINS.some((builtin) => builtin.name === name)) continue;
      references.push({
        name,
        kind: "variable",
        file: file.path,
        line: index + 1,
        column: (match.index ?? 0) + 1,
        detail: assignmentTargets.has(name) ? "identifier assignment" : "identifier reference",
      });
    }
  });
  return references;
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

function inferTypes(
  file: GmlProjectFile,
  resourceReferences: GmlIndexedSymbol[],
): GmlInferredType[] {
  const inferred: GmlInferredType[] = [];
  const lines = file.content.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  for (const reference of resourceReferences) {
    const type = expectedTypeLabel(reference.resourceType ?? "resource");
    inferred.push({
      name: reference.name,
      type,
      file: reference.file,
      line: reference.line,
      detail: `${reference.detail ?? "resource reference"} expects ${type}`,
    });
  }
  lines.forEach((line, index) => {
    const code = stripLineComment(line);
    for (const match of code.matchAll(
      /\b([A-Za-z_][A-Za-z0-9_.]*)\s*=\s*(".*?"|'.*?'|-?\d+(?:\.\d+)?)/g,
    )) {
      inferred.push({
        name: match[1],
        type: /^["']/.test(match[2]) ? "string" : "number",
        file: file.path,
        line: index + 1,
        detail: "assignment value",
      });
    }
  });
  return inferred;
}

function buildProjectGraph(
  index: Omit<GmlProjectIndex, "graph"> & { graph: GmlProjectGraph },
  resourceByName: Map<string, GmlResourceIndexEntry>,
): GmlProjectGraph {
  const resourceUsage = index.resources.map((resource) => {
    const references = index.resourceReferences.filter(
      (reference) => reference.name === resource.name,
    );
    const rooms = index.rooms
      .filter(
        (room) =>
          room.instances.some((instance) => instance.objectName === resource.name) ||
          room.name === resource.name,
      )
      .map((room) => room.name);
    return { resource, references, rooms };
  });
  const unusedResources = resourceUsage
    .filter((usage) => usage.references.length === 0 && usage.rooms.length === 0)
    .map((usage) => usage.resource)
    .filter((resource) => resource.type !== "project");
  const knownLayers = new Set(index.rooms.flatMap((room) => room.layers));
  const missingLayerReferences = findLayerReferences(index.identifierReferences)
    .filter((reference) => knownLayers.size > 0 && !knownLayers.has(reference.layerName))
    .map((reference) => ({ ...reference }));
  const resourceTypeMismatches = index.resourceReferences.flatMap((reference) => {
    const resource = resourceByName.get(reference.name);
    if (!resource) return [];
    const expected = expectedTypeLabel(reference.resourceType ?? "resource");
    const actual = normalizeResourceType(resource.type);
    return expected !== "resource" && actual !== "resource" && expected !== actual
      ? [{ name: reference.name, expected, actual, file: reference.file, line: reference.line }]
      : [];
  });
  const variableLifecycle = buildVariableLifecycle(index.identifierReferences, index.objectEvents);
  const maybeUninitializedVariables = variableLifecycle.filter(
    (entry) =>
      !entry.assignedInCreate &&
      entry.assignedFiles.length > 0 &&
      entry.readFiles.some((file) => /\/Step/i.test(file.replace(/\\/g, "/"))),
  );
  return {
    resourceUsage,
    unusedResources,
    missingLayerReferences,
    resourceTypeMismatches,
    variableLifecycle,
    maybeUninitializedVariables,
  };
}

function buildVariableLifecycle(
  references: GmlIndexedSymbol[],
  events: GmlObjectEvent[],
): GmlVariableLifecycle[] {
  const eventByFile = new Map(events.map((event) => [event.file, event]));
  const lifecycle = new Map<string, GmlVariableLifecycle>();
  for (const reference of references) {
    const event = eventByFile.get(reference.file);
    if (!event || !/^[a-z_][A-Za-z0-9_]*$/.test(reference.name)) continue;
    const key = `${event.objectName}:${reference.name}`;
    const entry =
      lifecycle.get(key) ??
      ({
        objectName: event.objectName,
        variable: reference.name,
        assignedInCreate: false,
        assignedFiles: [],
        readFiles: [],
      } satisfies GmlVariableLifecycle);
    if (/assignment/.test(reference.detail ?? "")) {
      if (!entry.assignedFiles.includes(reference.file)) entry.assignedFiles.push(reference.file);
      if (event.eventPrefix.toLowerCase() === "create") entry.assignedInCreate = true;
    } else if (!entry.readFiles.includes(reference.file)) {
      entry.readFiles.push(reference.file);
    }
    lifecycle.set(key, entry);
  }
  return [...lifecycle.values()].sort(
    (left, right) =>
      left.objectName.localeCompare(right.objectName) ||
      left.variable.localeCompare(right.variable),
  );
}

function findLayerReferences(references: GmlIndexedSymbol[]): Array<{
  layerName: string;
  file: string;
  line: number;
  call: string;
}> {
  const byFileLine = new Map<string, GmlIndexedSymbol[]>();
  for (const reference of references) {
    const key = `${reference.file}:${reference.line}`;
    const list = byFileLine.get(key) ?? [];
    list.push(reference);
    byFileLine.set(key, list);
  }
  const result: Array<{ layerName: string; file: string; line: number; call: string }> = [];
  for (const [, lineRefs] of byFileLine) {
    const lineText = lineRefs.map((ref) => ref.name).join(" ");
    const layerReference = lineRefs.find((ref) => ref.name === "instance_create_layer");
    if (!layerReference) continue;
    const stringReference = lineText.match(/\b[A-Za-z_][A-Za-z0-9_]*\b/)?.[0];
    if (stringReference) {
      result.push({
        layerName: stringReference,
        file: layerReference.file,
        line: layerReference.line,
        call: "instance_create_layer",
      });
    }
  }
  return result;
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

function emptyGraph(): GmlProjectGraph {
  return {
    resourceUsage: [],
    unusedResources: [],
    missingLayerReferences: [],
    resourceTypeMismatches: [],
    variableLifecycle: [],
    maybeUninitializedVariables: [],
  };
}

function normalizeResourceType(type: string): GmlInferredType["type"] | "resource" {
  const lower = type.toLowerCase();
  if (lower.includes("sprite")) return "sprite";
  if (lower.includes("object")) return "object";
  if (lower.includes("room")) return "room";
  if (lower.includes("sound")) return "sound";
  if (lower.includes("font")) return "font";
  return "resource";
}

function expectedTypeLabel(type: string): GmlInferredType["type"] {
  const normalized = normalizeResourceType(type);
  return normalized === "resource" ? "resource" : normalized;
}

function isKeyword(name: string): boolean {
  return /^(?:if|else|for|while|switch|case|default|break|continue|return|function|var|static|globalvar|enum|with|repeat|do|until|try|catch|finally|new|delete|exit|true|false|undefined|noone|self|other|global|local|and|or|not|div|mod)$/.test(
    name,
  );
}

function isString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
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

function levenshtein(left: string, right: string): number {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  const current = Array.from({ length: right.length + 1 }, () => 0);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    current[0] = leftIndex;
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const cost = left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1;
      current[rightIndex] = Math.min(
        current[rightIndex - 1] + 1,
        previous[rightIndex] + 1,
        previous[rightIndex - 1] + cost,
      );
    }
    for (let index = 0; index < previous.length; index += 1) previous[index] = current[index];
  }
  return previous[right.length];
}
