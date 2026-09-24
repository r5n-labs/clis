import type { Node } from "web-tree-sitter";
import { bind, type ModuleSymbols, type Unit } from "./symbols";
import { literal, patternNames } from "./syntax";

type DeclarationFactory = (node: Node, name: string) => Unit;

export function collectImports(root: Node, module: ModuleSymbols, create: DeclarationFactory): void {
  for (const node of root.namedChildren.filter((child) => child.type === "import_statement")) {
    const required = node.namedChildren.find((child) => child.type === "import_require_clause");
    const path = literal((required ?? node).childForFieldName("source"));
    const clause = node.namedChildren.find((child) => child.type === "import_clause");
    const unit = create(node, `import:${path ?? node.startIndex}`);
    const requiredName = required?.namedChildren.find((child) => child.type === "identifier")?.text;
    if (path && requiredName)
      bind(module.scope, { name: requiredName, imported: { module: path, name: "export=" }, unit });
    if (!path || !clause) continue;
    for (const child of clause.namedChildren) {
      switch (child.type) {
        case "identifier":
          bind(module.scope, { name: child.text, imported: { module: path, name: "default" }, unit });
          break;
        case "namespace_import": {
          const name = child.namedChildren.find((entry) => entry.type === "identifier")?.text;
          if (name) bind(module.scope, { name, imported: { module: path, name: "*" }, unit });
          break;
        }
        case "named_imports":
          for (const specifier of child.namedChildren) {
            const nameNode = specifier.childForFieldName("name");
            const name = literal(nameNode) ?? nameNode?.text;
            const alias = specifier.childForFieldName("alias")?.text ?? name;
            if (name && alias) bind(module.scope, { name: alias, imported: { module: path, name }, unit });
          }
          break;
      }
    }
  }
}

export function collectExports(root: Node, module: ModuleSymbols, create: DeclarationFactory): void {
  for (const node of root.namedChildren.filter((child) => child.type === "export_statement")) {
    if (node.children.some((child) => child.type === "=")) {
      const local = node.namedChildren.find((child) => child.type === "identifier")?.text;
      if (local) module.exports.push({ name: "export=", local, unit: create(node, "export=") });
      continue;
    }
    const path = literal(node.childForFieldName("source"));
    const clause = node.namedChildren.find((child) => child.type === "export_clause");
    const declaration = node.childForFieldName("declaration");
    if (clause) {
      const unit = create(node, `export:${node.startIndex}`);
      for (const specifier of clause.namedChildren) {
        const original = specifier.childForFieldName("name");
        const alias = specifier.childForFieldName("alias");
        const name = literal(alias) ?? alias?.text ?? literal(original) ?? original?.text;
        if (!name || !original) continue;
        const imported = literal(original) ?? original.text;
        module.exports.push(path ? { name, imported, module: path, unit } : { name, local: imported, unit });
      }
      continue;
    }
    if (path) {
      const unit = create(node, `export:${node.startIndex}`);
      const namespace = node.namedChildren.find((child) => child.type === "namespace_export");
      const alias = namespace?.namedChildren.at(-1)?.text;
      if (alias) module.exports.push({ name: alias, imported: "*", module: path, unit });
      else module.stars.push({ module: path, unit });
      continue;
    }
    if (node.children.some((child) => child.type === "default")) {
      const value = node.childForFieldName("value");
      const unit = module.units.find((entry) => entry.start === node.startIndex);
      const name =
        declaration?.childForFieldName("name")?.text ?? (value?.type === "identifier" ? value.text : undefined);
      module.exports.push(name ? { name: "default", local: name } : { name: "default", unit });
      continue;
    }
    if (!declaration) continue;
    const name = declaration.childForFieldName("name")?.text;
    if (name) module.exports.push({ name, local: name });
    for (const variable of declaration.namedChildren.filter((child) => child.type === "variable_declarator"))
      for (const name of patternNames(variable.childForFieldName("name"))) module.exports.push({ name, local: name });
  }
}
