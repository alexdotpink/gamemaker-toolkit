import { GENERATED_GML_BUILTINS, GENERATED_GML_EVENTS } from "./generated/gmlBuiltins.generated";

export interface GmlBuiltin {
  name: string;
  signature: string;
  description: string;
  kind: "function" | "constant" | "variable";
  parameters?: string[];
  requiredParameters?: number;
  returns?: string;
  examples?: string[];
  resourceArguments?: Array<{
    index: number;
    type: "sprite" | "object" | "room" | "sound" | "font";
  }>;
  manualUrl?: string;
  availableSince?: string;
  deprecated?: boolean;
}

export interface GmlEventDefinition {
  filePrefix: string;
  name: string;
  runsEveryFrame: boolean;
  purpose: string;
}

export const GML_BUILTINS: GmlBuiltin[] = GENERATED_GML_BUILTINS;
export const GML_EVENTS: GmlEventDefinition[] = GENERATED_GML_EVENTS;

export function findBuiltin(name: string): GmlBuiltin | undefined {
  return GML_BUILTINS.find((builtin) => builtin.name === name);
}

export function findEventDefinition(filePrefix: string): GmlEventDefinition | undefined {
  return GML_EVENTS.find((event) => event.filePrefix.toLowerCase() === filePrefix.toLowerCase());
}

export function builtinMarkdown(builtin: GmlBuiltin): string {
  return [
    `**${builtin.signature}**`,
    "",
    builtin.description,
    builtin.returns ? `\nReturns: \`${builtin.returns}\`` : "",
    builtin.resourceArguments?.length
      ? `\nResource arguments: ${builtin.resourceArguments
          .map((argument) => `#${argument.index + 1} expects \`${argument.type}\``)
          .join(", ")}`
      : "",
    builtin.deprecated ? "\nDeprecated in current GameMaker versions." : "",
    builtin.examples?.length ? `\nExample:\n\`\`\`gml\n${builtin.examples.join("\n")}\n\`\`\`` : "",
    builtin.manualUrl ? `\n[Open GameMaker Manual](${builtin.manualUrl})` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export function expectedArgumentCount(builtin: GmlBuiltin): {
  min: number;
  max: number;
} {
  const params = builtin.parameters ?? [];
  return {
    min:
      builtin.requiredParameters ??
      params.filter((parameter) => !/^\[.*\]$/.test(parameter.trim())).length,
    max: params.length,
  };
}
