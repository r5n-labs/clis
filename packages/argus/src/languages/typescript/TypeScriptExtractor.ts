import { basename } from "node:path";
import type { Node } from "web-tree-sitter";
import type { SourceTarget } from "../../domain/source-target";
import { collectExports, collectImports } from "./module-symbols";
import { bind, bindDeclaration, lookup, type ModuleSymbols, type Scope, type Unit } from "./symbols";
import {
  expression,
  FUNCTIONS,
  identifiers,
  leadingComments,
  literal,
  patternNames,
  unwrapValue,
  valueWrapper,
} from "./syntax";
import { type TestCallback, testCallback } from "./test-invocations";
import type { TestConvention } from "./testing";

const DECLARATIONS = new Set([
  "interface_declaration",
  "type_alias_declaration",
  "enum_declaration",
  "function_signature",
  "method_signature",
  "abstract_method_signature",
]);
const CLASS_NODES = new Set(["class_declaration", "abstract_class_declaration", "class"]);
const VARIABLE_NODES = new Set(["variable_declarator", "public_field_definition"]);

export class TypeScriptExtractor {
  private readonly module: ModuleSymbols;
  private readonly nodes = new Map<Unit, Node>();
  private readonly scopes = new Map<number, Scope>();
  private readonly callbacks = new Map<number, TestCallback>();
  private readonly names = new Map<string, number>();

  constructor(
    private readonly path: string,
    private readonly source: string,
    private readonly conventions: readonly TestConvention[],
  ) {
    this.module = {
      path,
      scope: { name: basename(path), bindings: new Map() },
      units: [],
      exports: [],
      stars: [],
      targets: [],
    };
  }

  extract(root: Node): ModuleSymbols {
    const create = (node: Node, name: string) => this.unit(node, name, "import", this.module.scope);
    collectImports(root, this.module, create);
    this.visit(root, this.module.scope);
    collectExports(root, this.module, create);
    this.markAssignments(root);
    for (const [unit, node] of this.nodes) this.collectUses(unit, node);
    for (const unit of this.module.units) this.collectTarget(unit);
    this.module.targets.push(
      this.target(
        {
          id: this.path,
          name: basename(this.path),
          kind: "declaration",
          scope: this.module.scope,
          source: this.source,
          header: "",
          comments: "",
          documentation: "",
          line: 1,
          endLine: this.source.split("\n").length,
          start: 0,
          end: this.source.length,
          uses: [],
          bases: [],
        },
        "files",
      ),
    );
    return this.module;
  }

  private visit(node: Node, parent: Scope): void {
    this.scopes.set(node.id, parent);
    if (node.type === "import_statement") return;
    if (CLASS_NODES.has(node.type)) {
      this.visitClass(node, parent);
      return;
    }
    if (FUNCTIONS.has(node.type)) {
      this.visitFunction(node, parent);
      return;
    }
    if (VARIABLE_NODES.has(node.type)) {
      this.visitVariable(node, parent);
      return;
    }
    if (DECLARATIONS.has(node.type)) {
      const name = node.childForFieldName("name")?.text;
      if (name) bindDeclaration(parent, { name, unit: this.unit(node, name, "declaration", parent) });
      return;
    }
    if (node.type === "call_expression") {
      const found = testCallback(node, parent, this.path, this.conventions);
      if (found) this.callbacks.set(found.callback.id, found.metadata);
    }
    const scope = ["statement_block", "for_statement", "for_in_statement", "catch_clause"].includes(node.type)
      ? { name: parent.name, parent, bindings: new Map() }
      : parent;
    this.scopes.set(node.id, scope);
    if (["program", "statement_block", "class_body"].includes(node.type)) this.reserveNames(node, scope);
    if (node.type === "catch_clause")
      for (const name of patternNames(node.childForFieldName("parameter"))) bind(scope, { name });
    for (const child of node.namedChildren) this.visit(child, scope);
  }

  private reserveNames(node: Node, scope: Scope): void {
    for (const child of node.namedChildren) {
      const declaration = child.type === "export_statement" ? child.childForFieldName("declaration") : child;
      if (!declaration) continue;
      const variables = ["lexical_declaration", "variable_declaration"].includes(declaration.type)
        ? declaration.namedChildren
        : [declaration];
      for (const variable of variables) {
        if (
          !VARIABLE_NODES.has(variable.type) &&
          !FUNCTIONS.has(variable.type) &&
          !CLASS_NODES.has(variable.type) &&
          !DECLARATIONS.has(variable.type)
        )
          continue;
        for (const name of patternNames(variable.childForFieldName("name")))
          if (!scope.bindings.has(name)) bindDeclaration(scope, { name, reserved: true });
      }
    }
  }

  private visitClass(node: Node, parent: Scope): void {
    const name = this.bindingName(node) ?? node.childForFieldName("name")?.text ?? "default";
    const unit = this.unit(node, name, "class", parent);
    const scope: Scope = { name: `${parent.name}.${name}`, parent, owner: unit, thisOwner: unit, bindings: new Map() };
    unit.members = scope;
    this.bindTypeParameters(node, scope);
    bindDeclaration(parent, { name, unit });
    const internalName = node.childForFieldName("name")?.text;
    if (node.type === "class" && internalName) bind(scope, { name: internalName, unit });
    const heritage = node.namedChildren.find((child) => child.type === "class_heritage");
    unit.bases =
      heritage?.namedChildren.flatMap((clause) =>
        clause.namedChildren.filter((entry) => entry.type !== "type_arguments").map(expression),
      ) ?? [];
    for (const child of node.namedChildren) this.visit(child, child.type === "class_body" ? scope : parent);
  }

  private visitFunction(node: Node, parent: Scope): void {
    const metadata = this.callbacks.get(node.id);
    const bindingName = this.bindingName(node) ?? node.childForFieldName("name")?.text;
    const accessor = node.children.find((child) => child.type === "get" || child.type === "set")?.type;
    const name = metadata?.title ?? (accessor ? `${accessor} ${bindingName}` : bindingName);
    const unit = name ? this.unit(metadata?.call ?? node, name, "function", parent) : undefined;
    if (unit) {
      unit.role = metadata?.role;
      unit.returnType = node.childForFieldName("return_type")
        ? expression(node.childForFieldName("return_type"))
        : undefined;
      if (bindingName && !metadata) bindDeclaration(parent, { name: bindingName, unit });
    }
    const scope: Scope = {
      name: unit ? `${parent.name}.${unit.name}` : parent.name,
      parent,
      owner: unit,
      bindings: new Map(),
      thisBoundary: node.type !== "arrow_function" && node.type !== "method_definition",
      thisOwner: node.type === "method_definition" ? parent.owner : undefined,
    };
    this.scopes.set(node.id, scope);
    this.bindTypeParameters(node, scope);
    if (unit) unit.returnScope = scope;
    const internalName = node.childForFieldName("name")?.text;
    if (unit && ["function_expression", "generator_function"].includes(node.type) && internalName)
      bind(scope, { name: internalName, unit });
    this.bindParameters(node, scope);
    for (const child of node.namedChildren) this.visit(child, scope);
  }

  private bindParameters(node: Node, scope: Scope): void {
    const parameters = node.childForFieldName("parameters");
    for (const parameter of parameters?.namedChildren ?? []) {
      const pattern = parameter.childForFieldName("pattern") ?? parameter.childForFieldName("name") ?? parameter;
      const type = parameter.childForFieldName("type");
      for (const name of patternNames(pattern)) {
        const binding = { name, type: type ? expression(type) : undefined };
        bind(scope, binding);
        if (
          scope.owner?.name === "constructor" &&
          scope.parent &&
          parameter.children.some((child) => child.type === "accessibility_modifier" || child.type === "readonly")
        )
          bindDeclaration(scope.parent, { ...binding, unit: scope.owner });
      }
    }
    const parameter = node.childForFieldName("parameter");
    if (parameter) for (const name of patternNames(parameter)) bind(scope, { name });
  }

  private visitVariable(node: Node, scope: Scope): void {
    const pattern = node.childForFieldName("name");
    const value = node.childForFieldName("value");
    const initializer = value ? unwrapValue(value) : undefined;
    if (value && initializer && (FUNCTIONS.has(initializer.type) || CLASS_NODES.has(initializer.type))) {
      this.visit(value, scope);
      return;
    }
    const names = patternNames(pattern);
    if (pattern?.type === "property_identifier" || pattern?.type === "private_property_identifier")
      names.push(pattern.text);
    const unit = names[0] ? this.unit(node, names.join(", "), "declaration", scope) : undefined;
    const type = node.childForFieldName("type");
    for (const name of names)
      bindDeclaration(scope, {
        name,
        unit,
        value: names.length === 1 && value ? expression(value) : undefined,
        type: names.length === 1 && type ? expression(type) : undefined,
      });
    if (value?.type === "object" && unit) {
      const members: Scope = { name: `${scope.name}.${unit.name}`, parent: scope, owner: unit, bindings: new Map() };
      unit.members = members;
      this.visit(value, members);
      return;
    }
    for (const child of node.namedChildren) this.visit(child, scope);
  }

  private bindingName(node: Node): string | undefined {
    const parent = valueWrapper(node).parent;
    if (parent && [...VARIABLE_NODES, "pair"].includes(parent.type)) {
      const name = parent.childForFieldName("name") ?? parent.childForFieldName("key");
      if (name && ["identifier", "property_identifier", "private_property_identifier", "string"].includes(name.type))
        return literal(name) ?? name.text;
    }
    if (
      !node.childForFieldName("name") &&
      parent?.type === "export_statement" &&
      parent.children.some((child) => child.type === "default")
    )
      return "default";
    return undefined;
  }

  private bindTypeParameters(node: Node, scope: Scope): void {
    for (const parameter of node.childForFieldName("type_parameters")?.namedChildren ?? []) {
      const name = parameter.childForFieldName("name")?.text;
      if (name) bind(scope, { name });
    }
  }

  private unit(node: Node, name: string, kind: Unit["kind"], scope: Scope): Unit {
    let wrapper = valueWrapper(node);
    if (wrapper.parent && [...VARIABLE_NODES, "pair"].includes(wrapper.parent.type)) wrapper = wrapper.parent;
    if (wrapper.parent?.type === "lexical_declaration" && wrapper.parent.namedChildren.length === 1)
      wrapper = wrapper.parent;
    if (wrapper.parent?.type === "export_statement") wrapper = wrapper.parent;
    const key = `${kind}:${scope.name}.${name}`;
    const occurrence = (this.names.get(key) ?? 0) + 1;
    this.names.set(key, occurrence);
    const uniqueName = occurrence === 1 ? name : `${name} #${occurrence}`;
    const body = node.childForFieldName("body");
    const unit: Unit = {
      id: `${this.path}:${kind}:${scope.name}.${uniqueName}`,
      name: uniqueName,
      kind,
      scope,
      source: wrapper.text,
      header: body ? this.source.slice(wrapper.startIndex, body.startIndex).trimEnd() : wrapper.text,
      comments: [leadingComments(wrapper), ...node.descendantsOfType("comment").map((entry) => entry.text)]
        .filter(Boolean)
        .join("\n"),
      documentation: leadingComments(wrapper),
      line: wrapper.startPosition.row + 1,
      endLine: wrapper.endPosition.row + 1,
      start: wrapper.startIndex,
      end: wrapper.endIndex,
      uses: [],
      bases: [],
    };
    this.module.units.push(unit);
    this.nodes.set(unit, node);
    return unit;
  }

  private markAssignments(root: Node): void {
    for (const assignment of root.descendantsOfType([
      "assignment_expression",
      "augmented_assignment_expression",
      "update_expression",
    ])) {
      const node = assignment.childForFieldName("left") ?? assignment.childForFieldName("argument");
      if (!node) continue;
      const scope = this.scopes.get(assignment.id) ?? this.module.scope;
      if (node.type === "identifier") for (const binding of lookup(scope, node.text) ?? []) binding.reassigned = true;
      if (node.type === "member_expression") {
        const name = node.childForFieldName("property")?.text;
        if (!name) continue;
        for (const unit of this.module.units)
          for (const binding of unit.members?.bindings.get(name) ?? []) binding.reassigned = true;
      }
    }
  }

  private collectUses(unit: Unit, node: Node): void {
    if (unit.kind === "import") return;
    const types = [
      "call_expression",
      "new_expression",
      "member_expression",
      "subscript_expression",
      "identifier",
      "type_identifier",
      "nested_type_identifier",
      "shorthand_property_identifier",
    ];
    for (const item of [node, ...node.descendantsOfType(types)]) {
      if (!types.includes(item.type)) continue;
      const parent = item.parent;
      if (
        ["identifier", "type_identifier"].includes(item.type) &&
        parent &&
        ["name", "pattern", "parameter"].some((field) => parent.childForFieldName(field)?.id === item.id)
      )
        continue;
      if (parent?.type === "import_statement") continue;
      unit.uses.push({
        expression:
          item.type === "shorthand_property_identifier" ? { kind: "name", name: item.text } : expression(item),
        scope: this.scopes.get(item.id) ?? unit.scope,
        text: item.text,
        reportUnresolved: ["call_expression", "new_expression", "member_expression", "subscript_expression"].includes(
          item.type,
        ),
      });
    }
  }

  private collectTarget(unit: Unit): void {
    if (unit.kind !== "class" && (unit.kind !== "function" || unit.role === "fixture" || unit.role === "suite")) return;
    const target = this.target(unit, unit.kind === "class" ? "classes" : "methods");
    unit.target = target;
    this.module.targets.push(target);
    if (unit.role === "test") this.module.targets.push({ ...target, group: "tests", id: `tests:${unit.id}` });
  }

  private target(unit: Unit, group: SourceTarget["group"]): SourceTarget {
    const node = this.nodes.get(unit);
    return {
      id: `${group}:${unit.id}`,
      group,
      path: this.path,
      owner: unit.scope.name,
      name: unit.name,
      line: unit.line,
      endLine: unit.endLine,
      source: unit.source,
      comments: unit.comments,
      documentation: unit.scope.owner?.kind === "class" ? unit.scope.owner.documentation : undefined,
      declarations:
        unit.kind === "class"
          ? [
              unit.header,
              ...this.module.units
                .filter((entry) => entry.scope === unit.members && entry.kind === "declaration")
                .map((entry) => entry.source),
            ]
          : [],
      references: node ? identifiers(node) : [],
      calls:
        node
          ?.descendantsOfType(["call_expression", "new_expression"])
          .map(
            (entry) =>
              (entry.childForFieldName("function") ?? entry.childForFieldName("constructor"))?.text ?? "<dynamic>",
          ) ?? [],
      strings:
        node?.descendantsOfType(["string", "template_string"]).flatMap((entry) => {
          const value = literal(entry);
          return value === undefined ? [] : [value];
        }) ?? [],
    };
  }
}
