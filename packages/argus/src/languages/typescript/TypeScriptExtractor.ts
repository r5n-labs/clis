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
  trailingComments,
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
const MODULE_NODES = new Set(["internal_module", "module"]);
const OVERLOAD_SIGNATURES = new Set(["function_signature", "method_signature", "abstract_method_signature"]);
const NAMED_DECLARATIONS = new Set([
  "function_declaration",
  "generator_function_declaration",
  "class_declaration",
  "abstract_class_declaration",
  "method_definition",
]);

export class TypeScriptExtractor {
  private readonly module: ModuleSymbols;
  private readonly nodes = new Map<Unit, Node>();
  private readonly scopes = new Map<number, Scope>();
  private readonly callbacks = new Map<number, TestCallback>();
  private readonly names = new Map<string, number>();
  private readonly objects = new Map<number, Unit>();

  constructor(
    private readonly path: string,
    private readonly source: string,
    private readonly conventions: readonly TestConvention[],
  ) {
    this.module = {
      path,
      scope: { name: basename(path), bindings: new Map(), declarationBoundary: true },
      units: [],
      exports: [],
      stars: [],
      targets: [],
    };
  }

  extract(root: Node): ModuleSymbols {
    const create = (node: Node, name: string) => this.unit(node, name, "import", this.module.scope);
    collectImports(root, this.module, create);
    this.reserveVariables(root, this.module.scope);
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
    if (node.type === "object") {
      this.visitObject(node, parent);
      return;
    }
    if (DECLARATIONS.has(node.type)) {
      const name = node.childForFieldName("name")?.text;
      if (name)
        bindDeclaration(parent, {
          name,
          unit: this.unit(node, name, "declaration", parent),
          overloadSignature: OVERLOAD_SIGNATURES.has(node.type),
        });
      return;
    }
    if (node.type === "call_expression") {
      const found = testCallback(node, parent, this.path, this.conventions);
      if (found) this.callbacks.set(found.callback.id, found.metadata);
    }
    const staticBlock = node.type === "class_static_block";
    const moduleBoundary = MODULE_NODES.has(node.type);
    const declarationBody =
      node.type === "statement_block" &&
      !!node.parent &&
      (FUNCTIONS.has(node.parent.type) || MODULE_NODES.has(node.parent.type));
    const scope: Scope =
      staticBlock ||
      moduleBoundary ||
      (!declarationBody && ["statement_block", "for_statement", "for_in_statement", "catch_clause"].includes(node.type))
        ? {
            name: moduleBoundary ? `${parent.name}.${node.childForFieldName("name")?.text}` : parent.name,
            parent,
            bindings: new Map(),
            declarationBoundary: staticBlock || moduleBoundary,
          }
        : parent;
    this.scopes.set(node.id, scope);
    if (staticBlock || moduleBoundary) this.reserveVariables(node, scope);
    if (node.type === "for_in_statement" && node.childForFieldName("kind")) {
      const declaration = node.childForFieldName("kind")?.text === "var" ? this.variableScope(scope) : scope;
      for (const name of patternNames(node.childForFieldName("left"))) bind(declaration, { name });
    }
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
        if (variable.parent?.type === "variable_declaration") continue;
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

  private reserveVariables(node: Node, scope: Scope): void {
    for (const child of node.namedChildren) {
      if (
        FUNCTIONS.has(child.type) ||
        CLASS_NODES.has(child.type) ||
        MODULE_NODES.has(child.type) ||
        child.type === "class_static_block"
      )
        continue;
      if (child.type === "variable_declaration") {
        for (const variable of child.namedChildren)
          for (const name of patternNames(variable.childForFieldName("name")))
            if (!scope.bindings.has(name)) bind(scope, { name, reserved: true });
      }
      if (child.type === "for_in_statement" && child.childForFieldName("kind")?.text === "var")
        for (const name of patternNames(child.childForFieldName("left")))
          if (!scope.bindings.has(name)) bind(scope, { name, reserved: true });
      this.reserveVariables(child, scope);
    }
  }

  private declarationScope(node: Node, scope: Scope): Scope {
    const declaration = valueWrapper(node).parent;
    const variable = node.type === "variable_declarator" ? node : declaration;
    if (variable?.type !== "variable_declarator" || variable.parent?.type !== "variable_declaration") return scope;
    return this.variableScope(scope);
  }

  private variableScope(scope: Scope): Scope {
    let current = scope;
    while (!current.declarationBoundary && current.parent) current = current.parent;
    return current;
  }

  private visitClass(node: Node, parent: Scope): void {
    const name = this.bindingName(node) ?? node.childForFieldName("name")?.text ?? "default";
    const unit = this.unit(node, name, "class", parent);
    const scope: Scope = { name: `${parent.name}.${name}`, parent, owner: unit, thisOwner: unit, bindings: new Map() };
    unit.members = scope;
    this.bindTypeParameters(node, scope);
    if (this.bindingName(node) || NAMED_DECLARATIONS.has(node.type))
      bindDeclaration(this.declarationScope(node, parent), { name, unit, evaluationScope: parent });
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
      if (bindingName && !metadata && (this.bindingName(node) || NAMED_DECLARATIONS.has(node.type)))
        bindDeclaration(this.declarationScope(node, parent), { name: bindingName, unit, evaluationScope: parent });
    }
    const scope: Scope = {
      name: unit ? `${parent.name}.${unit.name}` : parent.name,
      parent,
      owner: unit,
      bindings: new Map(),
      declarationBoundary: true,
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
    const body = node.childForFieldName("body");
    const bodyScope: Scope = {
      name: scope.name,
      parent: scope,
      owner: unit,
      bindings: new Map(),
      declarationBoundary: true,
    };
    if (body) this.reserveVariables(body, bodyScope);
    for (const child of node.namedChildren) this.visit(child, child.id === body?.id ? bodyScope : scope);
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
      bindDeclaration(this.declarationScope(node, scope), {
        name,
        unit,
        evaluationScope: scope,
        value: names.length === 1 && value ? expression(value) : undefined,
        type: names.length === 1 && type ? expression(type) : undefined,
      });
    if (initializer?.type === "object" && unit) this.objects.set(initializer.id, unit);
    for (const child of node.namedChildren) this.visit(child, scope);
  }

  private visitObject(node: Node, parent: Scope): void {
    const existing = this.objects.get(node.id);
    const name = this.bindingName(node);
    const unit = existing ?? this.unit(node, name ?? "<object>", "declaration", parent);
    if (!existing && name) bindDeclaration(parent, { name, unit });
    const scope: Scope = { name: `${parent.name}.${unit.name}`, parent, owner: unit, bindings: new Map() };
    unit.members = scope;
    this.scopes.set(node.id, scope);
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
    if (
      wrapper.parent &&
      ["lexical_declaration", "variable_declaration"].includes(wrapper.parent.type) &&
      wrapper.parent.namedChildren.length === 1
    )
      wrapper = wrapper.parent;
    if (wrapper.parent?.type === "export_statement") wrapper = wrapper.parent;
    const key = `${kind}:${scope.name}.${name}`;
    const occurrence = (this.names.get(key) ?? 0) + 1;
    this.names.set(key, occurrence);
    const uniqueName = occurrence === 1 ? name : `${name} #${occurrence}`;
    const body = node.childForFieldName("body");
    const leading = leadingComments(wrapper);
    const trailing = trailingComments(wrapper);
    const end = trailing.at(-1) ?? wrapper;
    const unit: Unit = {
      id: `${this.path}:${kind}:${scope.name}.${uniqueName}`,
      name: uniqueName,
      kind,
      scope,
      source: this.source.slice(wrapper.startIndex, end.endIndex),
      header: body ? this.source.slice(wrapper.startIndex, body.startIndex).trimEnd() : wrapper.text,
      comments: [
        leading,
        ...wrapper.descendantsOfType("comment").map((entry) => entry.text),
        ...trailing.map((entry) => entry.text),
      ]
        .filter(Boolean)
        .join("\n"),
      documentation: leading,
      line: wrapper.startPosition.row + 1,
      endLine: end.endPosition.row + 1,
      start: wrapper.startIndex,
      end: end.endIndex,
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
      "for_in_statement",
    ])) {
      const node = assignment.childForFieldName("left") ?? assignment.childForFieldName("argument");
      if (!node) continue;
      const scope = this.scopes.get(assignment.id) ?? this.module.scope;
      this.markAssignmentTarget(node, scope);
    }
  }

  private markAssignmentTarget(node: Node, scope: Scope): void {
    const value = expression(node);
    if (value.kind === "name") {
      for (const binding of lookup(scope, value.name) ?? []) binding.reassigned = true;
      return;
    }
    if (value.kind === "member" || node.type === "subscript_expression") {
      for (const unit of this.module.units)
        for (const [name, bindings] of unit.members?.bindings ?? [])
          if (value.kind !== "member" || name === value.name) for (const binding of bindings) binding.reassigned = true;
      return;
    }
    if (["assignment_pattern", "object_assignment_pattern", "pair_pattern"].includes(node.type)) {
      const target = node.childForFieldName(node.type === "pair_pattern" ? "value" : "left");
      if (target) this.markAssignmentTarget(target, scope);
      return;
    }
    if (node.type === "shorthand_property_identifier_pattern") {
      for (const binding of lookup(scope, node.text) ?? []) binding.reassigned = true;
      return;
    }
    if (
      ["object_pattern", "array_pattern", "rest_pattern", "parenthesized_expression", "non_null_expression"].includes(
        node.type,
      )
    )
      for (const child of node.namedChildren) this.markAssignmentTarget(child, scope);
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
      leadingComments: unit.documentation,
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
