import { Exit } from "@r5n/cli-core";
import type { Node } from "web-tree-sitter";
import type { SourceFile } from "../../domain/source-target";
import { grammarBytes, TreeSitterParser } from "../../syntax/TreeSitterParser";

declare const ARGUS_GODOT_RESOURCE_WASM: string | undefined;

export type ResourceReference = Readonly<{ kind: "sub_resource" | "ext_resource"; id: string }>;
export type ResourceValue = Readonly<{ text: string; string?: string; reference?: ResourceReference }>;
export type ResourceSection = Readonly<{
  kind: string;
  header: string;
  body: string;
  attributes: ReadonlyMap<string, ResourceValue>;
  properties: ReadonlyMap<string, ResourceValue>;
  strings: readonly string[];
  references: readonly ResourceReference[];
}>;

const parser = await TreeSitterParser.load({
  label: "Godot resource",
  bytes: grammarBytes(
    new URL("./grammar/tree-sitter-godot_resource.wasm", import.meta.url).href,
    typeof ARGUS_GODOT_RESOURCE_WASM === "string" ? ARGUS_GODOT_RESOURCE_WASM : undefined,
  ),
});
const documents = new WeakMap<SourceFile, readonly ResourceSection[]>();
const ESCAPES: Readonly<Record<string, string>> = {
  a: "\x07",
  b: "\b",
  f: "\f",
  n: "\n",
  r: "\r",
  t: "\t",
  v: "\v",
  "\\": "\\",
  '"': '"',
  "'": "'",
  "?": "?",
};
const HEX_RADIX = 16;

export function parseResource(path: string, source: string): readonly ResourceSection[] {
  return parser.read(path, source, (root) => {
    const sections = root.namedChildren.filter((node) => node.type === "section");
    return sections.map((node, index) => {
      const headerEnd = node.children.find((child) => child.type === "]")?.endIndex;
      const kind = node.namedChildren.find((child) => child.type === "identifier")?.text;
      if (!headerEnd || !kind) throw new Exit(`Incomplete resource section in ${path}`);
      const properties = node.namedChildren.filter((child) => child.type === "property");
      return {
        kind,
        header: source.slice(node.startIndex, headerEnd),
        body: source.slice(headerEnd, sections[index + 1]?.startIndex ?? source.length).trim(),
        attributes: values(node.namedChildren.filter((child) => child.type === "attribute")),
        properties: values(properties),
        strings: properties.flatMap((property) => property.descendantsOfType("string").map(stringValue)),
        references: node.descendantsOfType("constructor").flatMap((child) => {
          const reference = resourceReference(child);
          return reference ? [reference] : [];
        }),
      };
    });
  });
}

export function resourceSections(file: SourceFile): readonly ResourceSection[] {
  let sections = documents.get(file);
  if (!sections) {
    sections = parseResource(file.path, file.source);
    documents.set(file, sections);
  }
  return sections;
}

export function attribute(section: ResourceSection, name: string): string | undefined {
  return section.attributes.get(name)?.string;
}

function values(nodes: readonly Node[]): ReadonlyMap<string, ResourceValue> {
  const result = new Map<string, ResourceValue>();
  for (const node of nodes) {
    const [name, value] = node.namedChildren.filter((child) => child.type !== "comment");
    if (!name || !value) throw new Exit("Incomplete Godot resource property");
    result.set(name.text, {
      text: value.text,
      string: ["string", "string_name"].includes(value.type) ? stringValue(value) : undefined,
      reference: resourceReference(value),
    });
  }
  return result;
}

function resourceReference(node: Node): ResourceReference | undefined {
  if (node.type !== "constructor") return undefined;
  const name = node.namedChildren.find((child) => child.type === "identifier")?.text;
  if (name !== "ExtResource" && name !== "SubResource") return undefined;
  const argument = node.namedChildren
    .find((child) => child.type === "arguments")
    ?.namedChildren.find((child) => child.type !== "comment");
  if (!argument || !["string", "integer"].includes(argument.type)) return undefined;
  return {
    kind: name === "ExtResource" ? "ext_resource" : "sub_resource",
    id: argument.type === "string" ? stringValue(argument) : argument.text,
  };
}

function stringValue(node: Node): string {
  const literal = node.type === "string_name" ? node.children.find((child) => child.type === "string") : node;
  if (!literal) throw new Exit("Incomplete Godot resource string");
  return literal.text.slice(1, -1).replace(/\\(u[\da-fA-F]{4}|U[\da-fA-F]{6}|.)/gs, (_, sequence: string) => {
    if (sequence.startsWith("u") || sequence.startsWith("U"))
      return String.fromCodePoint(Number.parseInt(sequence.slice(1), HEX_RADIX));
    const value = ESCAPES[sequence];
    if (value === undefined) throw new Exit(`Unsupported Godot string escape: \\${sequence}`);
    return value;
  });
}
