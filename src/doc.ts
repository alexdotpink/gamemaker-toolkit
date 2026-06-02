export type Doc = string | Doc[] | LineDoc | GroupDoc | IndentDoc;

export interface LineDoc {
  kind: "line";
  hard: boolean;
}

export interface GroupDoc {
  kind: "group";
  contents: Doc;
}

export interface IndentDoc {
  kind: "indent";
  contents: Doc;
}

export const line: LineDoc = { kind: "line", hard: false };
export const hardLine: LineDoc = { kind: "line", hard: true };

export function group(contents: Doc): GroupDoc {
  return { kind: "group", contents };
}

export function indentDoc(contents: Doc): IndentDoc {
  return { kind: "indent", contents };
}

export function joinDoc(separator: Doc, docs: Doc[]): Doc {
  return docs.flatMap((doc, index) => (index === 0 ? [doc] : [separator, doc]));
}

export function renderDoc(doc: Doc, options: { indent: string; printWidth: number }): string {
  const flat = flattenDoc(doc, false);
  if (flat.length <= options.printWidth && !flat.includes("\n")) {
    return flat;
  }
  return renderBroken(doc, options.indent, 0);
}

function flattenDoc(doc: Doc, broken: boolean): string {
  if (typeof doc === "string") return doc;
  if (Array.isArray(doc)) return doc.map((part) => flattenDoc(part, broken)).join("");
  if (doc.kind === "line") return broken || doc.hard ? "\n" : " ";
  if (doc.kind === "group") return flattenDoc(doc.contents, broken);
  return flattenDoc(doc.contents, broken);
}

function renderBroken(doc: Doc, indentUnit: string, indentLevel: number): string {
  if (typeof doc === "string") return doc;
  if (Array.isArray(doc))
    return doc.map((part) => renderBroken(part, indentUnit, indentLevel)).join("");
  if (doc.kind === "line") return `\n${indentUnit.repeat(indentLevel)}`;
  if (doc.kind === "group") return renderBroken(doc.contents, indentUnit, indentLevel);
  return renderBroken(doc.contents, indentUnit, indentLevel + 1);
}
