import { basename } from "node:path";
import type { Node } from "web-tree-sitter";
import type { SourceCapabilities } from "../../analysis/contracts";
import { SourceAdapter } from "../../analysis/contracts";
import { ONE_BASED_LINE } from "../../constants";
import type { Project, SourceFile, SourceTarget } from "../../domain/source-target";
import { GDScriptReferences } from "./GDScriptReferences";
import { gdscriptParser } from "./parser";
import type { ScriptRuntime } from "./runtime";
import { StandaloneRuntime } from "./runtime";
import { classSymbols } from "./source-symbols";
import { stringLiterals } from "./string-literals";
import type { ClassSymbols, DeclarationSymbols } from "./symbols";

const CLASS_STATEMENT = "class_name_statement";
const FUNCTION = "function_definition";
const CONSTRUCTOR = "constructor_definition";
const CLASS = "class_definition";
type Scope = {
  scope: Node;
  definition?: Node;
  owner: string;
  path: string;
  source: string;
  targets: SourceTarget[];
  headers: string[];
  symbols: ClassSymbols[];
};
type Declarations = { symbols: DeclarationSymbols[]; references: string[] };

export class GDScriptAdapter extends SourceAdapter {
  readonly id = "gdscript";
  readonly language = "GDScript (Godot 4)";
  private readonly parsedSymbols = new WeakMap<SourceFile, ClassSymbols[]>();

  constructor(private readonly runtime: (project: Project) => ScriptRuntime = () => new StandaloneRuntime()) {
    super();
  }

  supports(path: string): boolean {
    return path.endsWith(".gd");
  }

  createContext(project: Project): SourceCapabilities {
    const references = new GDScriptReferences(
      project,
      (file) => this.parsedSymbols.get(file) ?? [],
      this.runtime(project),
    );
    return {
      references,
      declarations: (path) => references.resourceSchema(path),
      literalUsages: (literal) =>
        project.targets
          .filter(
            (target) =>
              project.files.get(target.path)?.adapterId === this.id &&
              target.group === "methods" &&
              target.strings?.includes(literal),
          )
          .map((target) => ({
            target,
            source: target.source,
            containsLiteral: (value) => target.strings?.includes(value) ?? false,
            related: [],
          })),
    };
  }

  async parse(path: string, source: string): Promise<SourceFile> {
    return gdscriptParser.read(path, source, (root) => {
      const owner =
        root.namedChildren.find((node) => node.type === CLASS_STATEMENT)?.childForFieldName("name")?.text ??
        basename(path, ".gd");
      const targets: SourceTarget[] = [];
      const symbols: ClassSymbols[] = [];
      this.visitScope({ scope: root, owner, path, source, targets, headers: [], symbols });
      targets.push({ ...this.target(root, { path, owner, source, group: "files", name: basename(path) }), source });
      const file = this.sourceFile({ path, source, references: references(root), targets });
      this.parsedSymbols.set(file, symbols);
      return file;
    });
  }

  private visitScope(options: Scope): void {
    const { scope, owner, path, source, targets } = options;
    const declarations = this.collectDeclarations(options);
    options.symbols.push(
      classSymbols({ scope, owner, declarations: declarations.symbols, definition: options.definition }),
    );
    targets.push({
      ...this.target(options.definition ?? scope, { path, owner, source, group: "classes", name: owner }),
      declarations: declarations.symbols.map((declaration) => declaration.source),
      documentation: this.classDocumentation(options),
    });
    for (const node of scope.namedChildren) {
      if (node.type === CLASS) this.visitNestedClass(node, options);
      if (node.type === FUNCTION || node.type === CONSTRUCTOR) this.collectMethod(node, options, declarations);
    }
  }

  private classDocumentation({ scope, definition }: Scope): string {
    const documentation: string[] = [];
    let preceding = definition?.previousNamedSibling;
    while (preceding?.type === "comment") {
      documentation.unshift(preceding.text);
      preceding = preceding.previousNamedSibling;
    }
    for (const node of scope.namedChildren) {
      if (
        [FUNCTION, CONSTRUCTOR, CLASS, "variable_statement", "const_statement", "signal_statement"].includes(node.type)
      )
        break;
      if (node.type === "comment") documentation.push(node.text);
    }
    return documentation.join("\n");
  }

  private collectDeclarations({ scope, headers }: Scope): Declarations {
    const nodes = scope.namedChildren.filter((node) => ![FUNCTION, CONSTRUCTOR, CLASS, "comment"].includes(node.type));
    return {
      symbols: [
        ...headers.map((source) => ({ source, uses: [] })),
        ...nodes.map(
          (node): DeclarationSymbols => ({
            source: declarationSource(node),
            binding: ["variable_statement", "const_statement"].includes(node.type)
              ? node.childForFieldName("name")?.text
              : undefined,
            uses: node.descendantsOfType("identifier").map((identifier) => identifier.text),
          }),
        ),
      ],
      references: nodes.flatMap(references),
    };
  }

  private visitNestedClass(node: Node, parent: Scope): void {
    const name = node.childForFieldName("name")?.text;
    const body = node.childForFieldName("body");
    if (!name || !body) return;
    this.visitScope({
      ...parent,
      scope: body,
      definition: node,
      owner: `${parent.owner}.${name}`,
      headers: [node.text.slice(0, body.startIndex - node.startIndex).trimEnd()],
    });
  }

  private collectMethod(node: Node, scope: Scope, declarations: Declarations): void {
    const name = node.type === CONSTRUCTOR ? "_init" : node.childForFieldName("name")?.text;
    if (!name) return;
    const { path, owner, source, targets } = scope;
    const method = {
      ...this.target(node, { path, owner, source, group: "methods", name }),
      declarations: declarations.symbols.map((declaration) => declaration.source),
      references: [...new Set([...references(node), ...declarations.references])],
    };
    targets.push(method);
    if (name.startsWith("test_")) targets.push({ ...method, group: "tests", id: `tests:${path}:${owner}.${name}` });
  }

  private target(
    node: Node,
    options: { path: string; owner: string; source: string; group: SourceTarget["group"]; name: string },
  ): SourceTarget {
    const { path, owner, source, group, name } = options;
    let previous = node.previousNamedSibling;
    const leading: string[] = [];
    while (previous?.type === "comment") {
      leading.unshift(previous.text);
      previous = previous.previousNamedSibling;
    }
    const body = node.text.trimEnd();
    const endLine = node.startPosition.row + body.split("\n").length;
    return {
      id: `${group}:${path}:${owner}.${name}`,
      group,
      path,
      owner,
      name,
      line: node.startPosition.row + ONE_BASED_LINE,
      endLine,
      source: source.split("\n").slice(node.startPosition.row, endLine).join("\n").trimEnd(),
      comments: [...leading, ...node.descendantsOfType("comment").map((comment) => comment.text)].join("\n"),
      strings: stringLiterals(node),
      declarations: [],
      references: references(node),
      calls: [
        ...new Set(
          node
            .descendantsOfType("call")
            .map((call) => call.namedChildren[0]?.text)
            .filter((name): name is string => Boolean(name)),
        ),
      ],
    };
  }
}

function references(node: Node): string[] {
  return [
    ...new Set([
      ...node.descendantsOfType("identifier").map((item) => item.text),
      ...stringLiterals(node).filter((item) => item.startsWith("res://")),
    ]),
  ];
}

function declarationSource(node: Node): string {
  const leading: string[] = [];
  let previous = node.previousNamedSibling;
  let startRow = node.startPosition.row;
  while (previous?.type === "comment" && previous.endPosition.row + ONE_BASED_LINE === startRow) {
    leading.unshift(previous.text);
    startRow = previous.startPosition.row;
    previous = previous.previousNamedSibling;
  }
  return [...leading, node.text.trimEnd()].join("\n");
}
