import type { ReferenceOptions } from "../../analysis/contracts";
import type { SourceTarget } from "../../domain/source-target";
import { ReferenceEvidence } from "./ReferenceEvidence";
import { ReferenceResolver } from "./ReferenceResolver";
import type { Environment, IndexedClass, ReferenceIndex } from "./reference-index";
import type { MethodSymbols, SourceExpression } from "./symbols";

const TEST_FIXTURES = new Set(["setup", "teardown", "before_each", "after_each", "before_all", "after_all"]);

export class ReferenceSelection {
  private readonly evidence: ReferenceEvidence;
  private readonly resolver: ReferenceResolver;
  private queue: Environment[] = [];
  private candidateOwners = new Map<IndexedClass, string>();
  private origin?: IndexedClass;

  constructor(
    private readonly index: ReferenceIndex,
    private readonly owner: IndexedClass,
    private readonly target: SourceTarget,
    private readonly options: ReferenceOptions,
  ) {
    this.evidence = new ReferenceEvidence(owner, target, options);
    this.resolver = new ReferenceResolver(
      index,
      this.evidence,
      {
        includeMethod: (owner, method) => this.includeMethod(owner, method),
        includeScene: (owner) => this.candidateOwners.set(owner, "Scene"),
      },
      { path: target.path, depth: options.depth },
    );
  }

  directCalls(method: MethodSymbols): Set<string> {
    const calls = new Set<string>();
    for (const operation of method.operations) {
      if (operation.kind !== "call") continue;
      const value = this.resolver.resolve(
        operation.callee,
        { owner: this.owner, method },
        { visited: new Set(), origin: this.owner.file.path },
      );
      if (value?.kind === "method")
        calls.add(`${value.owner.file.path}:${value.owner.symbols.owner}:${value.method.name}`);
    }
    return calls;
  }

  build() {
    this.evidence.includeClass(this.owner);
    const isMethod = this.target.group === "methods" || this.target.group === "tests";
    const roots = isMethod
      ? this.owner.symbols.methods.filter((method) => method.name === this.target.name)
      : this.owner.symbols.methods;
    for (const method of roots) {
      this.includeMethod(this.owner, method);
      this.includeContract(method.name);
    }
    if (this.options.fixtures) this.includeFixtures();
    if (!isMethod) this.includeNestedClasses();
    this.followQueue();
    const visited = this.queue.length;
    if (this.options.fixtures) this.includeReceiverCandidates(roots);
    this.followQueue(visited);
    return this.evidence.build(isMethod);
  }

  private followQueue(start = 0): void {
    for (let index = start; index < this.queue.length; index++) {
      const environment = this.queue[index];
      if (environment) this.followOperations(environment);
    }
  }

  private includeFixtures(): void {
    for (const name of TEST_FIXTURES) {
      const fixture = this.resolver.findMember(this.owner, name, {
        visited: new Set(),
        origin: this.owner.file.path,
        contract: true,
      });
      if (!fixture?.method) continue;
      this.includeMethod(fixture.owner, fixture.method, false);
      for (const binding of fixture.owner.symbols.bindings) {
        if (binding.value.kind !== "path" || !fixture.method.uses.includes(binding.name)) continue;
        const resolved = this.resolver.resolve(
          binding.value,
          { owner: fixture.owner },
          { visited: new Set(), origin: fixture.owner.file.path },
        );
        if (resolved?.kind === "class") this.candidateOwners.set(resolved.owner, "Fixture script");
      }
    }
  }

  private includeNestedClasses(): void {
    this.queue.push({ owner: this.owner });
    const nestedClasses = this.index.classes.filter(
      (entry) => entry.file === this.owner.file && entry.symbols.owner.startsWith(`${this.owner.symbols.owner}.`),
    );
    for (const nested of nestedClasses) {
      this.queue.push({ owner: nested });
      for (const method of nested.symbols.methods) this.includeMethod(nested, method);
    }
  }

  private includeContract(name: string): void {
    const lookup = { visited: new Set<string>(), origin: this.owner.file.path, contract: true };
    const base = this.resolver.baseClass(this.owner, lookup);
    if (base?.kind !== "class") {
      if (this.owner.symbols.base) this.evidence.recordUnresolved(this.owner.file.path, this.owner.symbols.base);
      return;
    }
    const member = this.resolver.findMember(base.owner, name, lookup);
    if (member?.method) this.includeMethod(member.owner, member.method);
  }

  private includeReceiverCandidates(methods: MethodSymbols[]): void {
    this.origin = this.owner;
    for (const method of methods) {
      for (const operation of method.operations) {
        const member = operation.kind === "call" ? operation.callee : operation;
        if (member.kind !== "member") continue;
        const resolved = this.resolver.resolve(
          member,
          { owner: this.owner, method },
          { visited: new Set(), origin: this.owner.file.path },
        );
        if (resolved) continue;
        for (const [owner, source] of this.candidateOwners) {
          const candidate = owner.symbols.methods.find((entry) => entry.name === member.name);
          if (!candidate) continue;
          this.includeMethod(owner, candidate);
          this.evidence.recordUnresolvedNote(
            this.owner.file.path,
            `${source} candidate for ${this.evidence.describe(member)}: ${owner.file.path}.${candidate.name}; receiver identity is not established by static analysis`,
          );
        }
      }
    }
  }

  private followOperations(environment: Environment): void {
    this.origin = environment.owner;
    const bindings: SourceExpression[] = (environment.method?.uses ?? [])
      .filter(
        (name) =>
          environment.owner.symbols.bindings.some((binding) => binding.name === name) ||
          environment.owner.symbols.methods.some((method) => method.name === name),
      )
      .map((name) => ({ kind: "name", name }));
    const operations = [...(environment.method?.operations ?? environment.owner.symbols.operations), ...bindings];
    for (const operation of operations) {
      const value = this.resolver.resolve(operation, environment, {
        visited: new Set(),
        origin: environment.owner.file.path,
      });
      if (value?.kind === "method") this.includeMethod(value.owner, value.method);
      if (!value) this.evidence.recordUnresolved(environment.owner.file.path, operation);
    }
  }

  private includeMethod(owner: IndexedClass, method: MethodSymbols, follow = true): void {
    const added = this.evidence.includeMethod(owner, method, !this.origin || this.origin === this.owner);
    if (added && follow) this.queue.push({ owner, method });
  }
}
