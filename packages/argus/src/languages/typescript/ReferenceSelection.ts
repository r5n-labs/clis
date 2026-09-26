import type { ReferenceOptions, ReferenceSelection as Selection } from "../../analysis/contracts";
import type { SourceTarget } from "../../domain/source-target";
import type { ModuleIndex } from "./ModuleIndex";
import { SymbolResolver } from "./SymbolResolver";
import type { ModuleSymbols, Scope, Unit } from "./symbols";

const DEFAULT_SOURCE_BYTES = 65_000;
const DIAGNOSTIC_BYTES = 8_000;
const DEFAULT_DEPTH = 1;

export class ReferenceSelection {
  private readonly resolver: SymbolResolver;
  private readonly selected = new Map<Unit, { depth: number; full: boolean }>();
  private readonly pending: Unit[] = [];
  private readonly diagnostics = new Map<string, Set<string>>();

  constructor(
    private readonly index: ModuleIndex,
    private readonly module: ModuleSymbols,
    private readonly target: SourceTarget,
    private readonly options: ReferenceOptions,
  ) {
    this.resolver = new SymbolResolver(index);
  }

  build(): Selection {
    const root = this.module.units.find((unit) => unit.target && this.target.id === `${this.target.group}:${unit.id}`);
    if (root) {
      this.add(root, 0, true);
      const owner = root.scope.owner;
      if (owner?.kind === "class") {
        this.add(owner, 0, false);
        this.contracts(root, owner);
      }
      if (this.options.fixtures) this.fixtures(root.scope);
    } else for (const unit of this.module.units) this.add(unit, 0, true);
    for (let cursor = 0; cursor < this.pending.length; cursor++) {
      const unit = this.pending[cursor];
      if (unit) this.follow(unit);
    }
    return this.render(root);
  }

  private add(unit: Unit, depth: number, full = unit.kind !== "class", contract = false): void {
    const path = this.index.owner(unit).path;
    if (!contract && depth > (this.options.depth ?? DEFAULT_DEPTH)) {
      this.note(this.target.path, `Dependency outside selected reference depth: ${path}:${unit.name}`);
      return;
    }
    const previous = this.selected.get(unit);
    if (previous && (previous.full || !full) && previous.depth <= depth) return;
    this.selected.set(unit, { depth: Math.min(previous?.depth ?? depth, depth), full: full || !!previous?.full });
    if (full) this.pending.push(unit);
  }

  private follow(unit: Unit): void {
    const path = this.index.owner(unit).path;
    const depth = this.selected.get(unit)?.depth ?? 0;
    for (const use of unit.uses) {
      const include = (dependency: Unit) => {
        this.add(dependency, path === this.index.owner(dependency).path ? depth : depth + 1);
      };
      const selected = use.expression.kind === "call" ? use.expression.callee : use.expression;
      const resolved = this.resolver.resolve(selected, use.scope, include);
      if (use.reportUnresolved && !resolved) this.note(path, `Unresolved expression: ${use.text}`);
    }
  }

  private contracts(method: Unit, owner: Unit): void {
    for (const base of owner.bases) {
      const include = (unit: Unit) => this.add(unit, 0, unit.kind !== "class", true);
      const resolved = this.resolver.resolve(base, owner.scope, include);
      if (resolved) this.resolver.member(resolved, method.name.replace(/^(get|set) /, ""), include);
      else this.note(this.target.path, `Unresolved inherited contract for ${owner.name}.${method.name}`);
    }
  }

  private fixtures(scope: Scope): void {
    const ancestors = new Set<Scope>();
    let current: Scope | undefined = scope;
    while (current) {
      ancestors.add(current);
      current = current.parent;
    }
    for (const unit of this.module.units)
      if (unit.role === "fixture" && ancestors.has(unit.scope)) this.add(unit, 0, true);
  }

  private render(root?: Unit): Selection {
    const primary = [this.target.documentation, this.target.leadingComments ?? this.target.comments, this.target.source]
      .filter(Boolean)
      .join("\n\n");
    let remaining = Math.max(
      0,
      (this.options.sourceBytes ?? DEFAULT_SOURCE_BYTES) - Buffer.byteLength(JSON.stringify(primary)),
    );
    const local: string[] = [];
    const related = new Map<string, string>();
    const rendered: Unit[] = [];
    const units = [...this.selected].sort(
      ([a, left], [b, right]) =>
        left.depth - right.depth ||
        this.index.owner(a).path.localeCompare(this.index.owner(b).path) ||
        a.start - b.start,
    );
    for (const [unit, { full }] of units) {
      const path = this.index.owner(unit).path;
      if (
        unit === root ||
        rendered.some(
          (container) =>
            this.index.owner(container).path === path && unit.start >= container.start && unit.end <= container.end,
        ) ||
        (path === this.target.path &&
          unit.start >= (root?.start ?? 0) &&
          unit.end <= (root?.end ?? this.module.units.reduce((end, item) => Math.max(end, item.end), 0)))
      )
        continue;
      const source = full ? [unit.documentation, unit.source].filter(Boolean).join("\n") : this.classContract(unit);
      const bytes = Buffer.byteLength(JSON.stringify(source));
      if (bytes > remaining) {
        this.note(this.target.path, `Omitted by context allowance: ${path}:${unit.name}`);
        continue;
      }
      remaining -= bytes;
      if (full) rendered.push(unit);
      if (path === this.target.path) local.push(source);
      else related.set(path, [related.get(path), source].filter(Boolean).join("\n\n"));
    }
    return {
      source: [primary, ...local].join("\n\n"),
      related,
      unresolved: this.unresolved(),
      scope:
        "TypeScript static references: complete target, selected declarations, local helpers and inherited contracts. Relative imports and re-exports resolve only among included files. Package exports, tsconfig aliases, inferred generic/union types, dynamic dispatch and framework runtime behaviour are not resolved. Test fixtures are evidence, not proof of lifecycle ordering. Other implementations may be omitted by reference depth or byte allowance.",
    };
  }

  private classContract(unit: Unit): string {
    return [
      unit.documentation,
      `Class declaration (method implementations selected separately):\n${unit.header}`,
      ...this.index
        .owner(unit)
        .units.filter((entry) => entry.scope === unit.members && entry.kind === "declaration")
        .map((entry) => entry.source),
    ]
      .filter(Boolean)
      .join("\n");
  }

  private note(path: string, message: string): void {
    const notes = this.diagnostics.get(path) ?? new Set<string>();
    notes.add(message);
    this.diagnostics.set(path, notes);
  }

  private unresolved(): Selection["unresolved"] {
    let remaining = DIAGNOSTIC_BYTES;
    let omitted = 0;
    const entries = [...this.diagnostics]
      .map(([path, messages]) => ({
        path,
        expressions: [...messages].filter((message) => {
          const size = Buffer.byteLength(JSON.stringify(message));
          if (size > remaining) {
            omitted++;
            return false;
          }
          remaining -= size;
          return true;
        }),
      }))
      .filter((entry) => entry.expressions.length);
    if (omitted)
      entries.push({
        path: this.target.path,
        expressions: [`${omitted} further unresolved expressions omitted from this diagnostic list.`],
      });
    return entries;
  }
}
