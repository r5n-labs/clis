import type { ReferenceOptions } from "../../analysis/contracts";
import type { SourceTarget } from "../../domain/source-target";
import type { IndexedClass } from "./reference-index";
import type { DeclarationSymbols, MethodSymbols, SourceExpression } from "./symbols";

const SELECTED_SOURCE_BYTES = 65_000;
const UNRESOLVED_BYTES = 8_000;

export class ReferenceEvidence {
  private selected = new Map<IndexedClass, Map<string, MethodSymbols>>();
  private data = new Map<string, string>();
  private unresolved = new Map<string, Set<string>>();
  private usedBindings = new Map<IndexedClass, Set<string>>();
  private direct = new Set<MethodSymbols>();

  constructor(
    private readonly owner: IndexedClass,
    private readonly target: SourceTarget,
    private readonly options: ReferenceOptions,
  ) {}

  build(isMethod: boolean) {
    const source = isMethod ? this.renderClass(this.owner) : this.target.source;
    const related = this.relatedSource(source, isMethod);
    return { source, related, unresolved: this.unresolvedEvidence(related) };
  }

  includeMethod(owner: IndexedClass, method: MethodSymbols, direct: boolean): boolean {
    if (direct) this.direct.add(method);
    this.includeClass(owner);
    const selected = this.selected.get(owner);
    if (!selected || selected.has(method.name)) return false;
    selected.set(method.name, method);
    return true;
  }

  includeBinding(owner: IndexedClass, name: string): void {
    const used = this.usedBindings.get(owner) ?? new Set<string>();
    used.add(name);
    this.usedBindings.set(owner, used);
  }

  addData(path: string, source: string, merge = false): void {
    if (!merge) {
      this.data.set(path, source);
      return;
    }
    const lines = [...(this.data.get(path)?.split("\n") ?? []), ...source.split("\n")];
    this.data.set(path, [...new Set(lines)].join("\n"));
  }

  includeClass(owner: IndexedClass): void {
    if (this.selected.has(owner)) return;
    this.selected.set(owner, new Map());
  }

  recordUnresolved(path: string, expression: SourceExpression): void {
    const expressions = this.unresolved.get(path) ?? new Set<string>();
    expressions.add(this.describe(expression));
    this.unresolved.set(path, expressions);
  }

  private relatedSource(source: string, isMethod: boolean): Map<string, string> {
    const related = new Map<string, string>();
    const accepted = new Map<IndexedClass, Map<string, MethodSymbols>>();
    let remaining = Math.max(0, (this.options.sourceBytes ?? SELECTED_SOURCE_BYTES) - Buffer.byteLength(source));
    const candidates = [...this.selected]
      .filter(
        ([owner]) =>
          owner !== this.owner &&
          (isMethod ||
            owner.file !== this.owner.file ||
            !owner.symbols.owner.startsWith(`${this.owner.symbols.owner}.`)),
      )
      .flatMap<{ owner: IndexedClass; method?: MethodSymbols }>(([owner, methods]) =>
        methods.size ? [...methods.values()].map((method) => ({ owner, method })) : [{ owner, method: undefined }],
      );
    candidates.sort(
      (a, b) => Number(!!b.method && this.direct.has(b.method)) - Number(!!a.method && this.direct.has(a.method)),
    );
    for (const { owner, method } of candidates) {
      const methods = new Map(accepted.get(owner));
      if (method) methods.set(method.name, method);
      const text = this.renderClass(owner, methods);
      const previous = accepted.has(owner) ? this.renderClass(owner, accepted.get(owner)) : "";
      const bytes = Buffer.byteLength(JSON.stringify(text)) - Buffer.byteLength(JSON.stringify(previous));
      if (bytes > remaining) {
        this.recordUnresolved(this.target.path, {
          kind: "unknown",
          text: `Omitted by context allowance: ${owner.file.path}:${method?.name ?? owner.symbols.owner}`,
        });
        continue;
      }
      remaining -= bytes;
      accepted.set(owner, methods);
    }
    for (const [owner, methods] of accepted)
      related.set(
        owner.file.path,
        [related.get(owner.file.path), this.renderClass(owner, methods)].filter(Boolean).join("\n\n"),
      );
    for (const [path, text] of this.data) {
      const bytes = Buffer.byteLength(JSON.stringify(text));
      if (bytes > remaining) {
        this.recordUnresolved(this.target.path, { kind: "unknown", text: `Omitted by context allowance: ${path}` });
        continue;
      }
      related.set(path, text);
      remaining -= bytes;
    }
    return related;
  }

  private unresolvedEvidence(related: Map<string, string>) {
    let remaining = UNRESOLVED_BYTES;
    let omitted = 0;
    const result: { path: string; expressions: string[] }[] = [];
    const entries = [...this.unresolved].sort(
      ([a], [b]) => Number(b === this.target.path) - Number(a === this.target.path) || a.localeCompare(b),
    );
    for (const [path, expressions] of entries) {
      if (path !== this.target.path && !related.has(path)) continue;
      const selected: string[] = [];
      for (const expression of [...expressions].sort()) {
        const bytes = Buffer.byteLength(JSON.stringify(expression));
        if (bytes > remaining) {
          omitted++;
          continue;
        }
        selected.push(expression);
        remaining -= bytes;
      }
      if (selected.length) result.push({ path, expressions: selected });
    }
    if (omitted)
      result.push({
        path: this.target.path,
        expressions: [
          `${omitted} additional unresolved expressions omitted from this diagnostic list; this is not an exhaustive dependency proof.`,
        ],
      });
    return result;
  }

  private renderClass(owner: IndexedClass, selected = this.selected.get(owner)): string {
    const methods = owner.file.targets.filter(
      (entry) => entry.group === "methods" && entry.owner === owner.symbols.owner && selected?.has(entry.name),
    );
    methods.sort((a, b) => a.name.localeCompare(b.name));
    return [
      `Owner: ${owner.symbols.owner} (selected methods and declarations; other methods omitted)`,
      owner.target.documentation,
      ...this.declarations(owner, selected),
      ...methods.flatMap((method) => [method.comments, method.source]),
    ]
      .filter(Boolean)
      .join("\n\n");
  }

  private declarations(owner: IndexedClass, methods = this.selected.get(owner)): string[] {
    const used = new Set([
      ...(this.usedBindings.get(owner) ?? []),
      ...[...(methods?.values() ?? [])].flatMap((method) => method.uses),
    ]);
    const declarations = owner.symbols.declarations;
    const selected = new Set<DeclarationSymbols>();
    let changed = true;
    while (changed) {
      changed = false;
      for (const declaration of declarations) {
        if (selected.has(declaration)) continue;
        if (declaration.binding && !used.has(declaration.binding)) continue;
        selected.add(declaration);
        changed = true;
        for (const identifier of declaration.uses) used.add(identifier);
      }
    }
    return declarations.filter((declaration) => selected.has(declaration)).map((declaration) => declaration.source);
  }

  describe(expression: SourceExpression): string {
    switch (expression.kind) {
      case "name":
        return expression.name;
      case "path":
        return expression.path;
      case "unknown":
        return expression.text.startsWith("Omitted by") || expression.text.startsWith("Scene candidate")
          ? expression.text
          : "Unresolved expression or dynamic receiver";
      case "value":
        return "Value with no statically resolved script type";
      case "member":
        return `${this.describe(expression.receiver)}.${expression.name}`;
      case "call":
        return `${this.describe(expression.callee)}()`;
    }
  }
}
