# Analysis boundaries

Argus keeps review orchestration independent of programming languages, file formats and frameworks. The shared pipeline accepts an `AnalysisServices` implementation. Production registration lives in `src/composition/analysis.ts`; the shipped include/exclude profile is separate data in `src/composition/scan-profile.ts`.

| Owner | Responsibility | Extension contract |
| --- | --- | --- |
| `languages/<language>/` | Syntax, symbols, inheritance, calls, declarations and literal usage | Extend `SourceAdapter`; return `SourceCapabilities` |
| `formats/<format>/` | File syntax and semantic entries, such as catalogue messages or resource records | Extend `SourceAdapter`; return `SourceCapabilities` |
| `frameworks/<framework>/` | Configuration, runtime bindings and wiring between files | Implement `FrameworkIntegration` and language-specific runtime contracts where needed |
| `reviews/<category>/` | Supporting evidence or primary-source policy for a category, independent of source syntax | Implement `ReviewContextContributor` or `TargetContextPolicy` |
| `syntax/` | Shared Tree-sitter runtime initialisation, syntax validation and parser/tree lifetime management | `TreeSitterParser`; grammars and extraction remain with adapters |
| `analysis/` | Adapter registration, ownership validation and per-project capability instances | `AnalysisServices` |
| `contexts/`, `services/`, `storage/`, `reports/` | Budgets, context assembly, scheduling, hashing, caching and output | Consume contracts and semantic targets |

## Adding support

1. Extend `SourceAdapter` in the owning language or format directory. Implement file recognition, parsing and context capabilities. Use its protected `sourceFile()` factory to attach the adapter identity and language label. Preserve the original file text.
2. Prefer an established parser. Tree-sitter adapters use `syntax/TreeSitterParser` for runtime and tree lifetime management; they own grammar loading and interpretation. Gettext delegates catalogue syntax to `gettext-parser`; its source-range locator only maps parsed entries back to original text.
3. Return semantic `SourceTarget` records. Keep parser nodes and language-specific symbol graphs private to the adapter. Other languages do not have to implement the GDScript symbol model.
4. Supply reference selection, literal usage and declaration capabilities where supported. An absent capability means unavailable evidence. A provider must identify unresolved dependencies, omissions and the limits of its selection; it must not claim completeness without evidence.
5. Register the adapter in composition and update the shipped scan profile if its files should be included by default. Add a framework integration only for framework behaviour. GDScript receives Godot runtime resolution through `ScriptRuntime`; it does not import the Godot implementation.
6. Test extraction and context selection using fixtures, including cache invalidation when supplied dependencies change. Both working-tree and Git-baseline scanning use `ProjectAssembler` and the same registry.

The registry rejects duplicate adapter IDs, overlapping file ownership, conflicting primary-context policies and inconsistent file or target identities. Architecture overviews are a registered review policy; the context builder knows only the resulting target and its omission notes. Framework configuration files are declared by integrations and still obey exclusions and symlink restrictions. Context instances are isolated by project snapshot, so baseline symbols and working-tree symbols cannot share a mutable index.

Translation evidence consumes message identities and literal-usage capabilities. Gettext parsing belongs to the gettext adapter; resource record selection belongs to its format adapter. A different catalogue format can contribute the same semantic identity without reproducing gettext names or syntax. Future metadata normalisation must stay with the owning adapter and review policy; generic hashing must not strip language-specific text.

## Enforcement

`tests/architecture/boundaries.test.ts` checks static imports, type imports, re-exports and literal dynamic imports. Shared orchestration cannot import concrete language, format, framework or review implementations. Language and format implementations cannot import one another. Review contributors consume contracts rather than parsers. Frameworks can compose format readers and explicit runtime contracts, but cannot import a language's concrete analyser.

The two composition entry points are deliberate: commands may assemble production services, and configuration validation may read the data-only scan profile. Syntax highlighting has its own report presentation registry and does not participate in source analysis.

`tests/architecture/adapters.test.ts` exercises a deliberately limited TypeScript fixture adapter through scanning, dependency context, caching, report evidence and Git baselines. It also joins different catalogue formats with language usage evidence. This proves the extension path; it is not production TypeScript support.

Run `bun test packages/argus/tests`, `bun --filter @r5n/argus type-check` and `bun biome check packages/argus` after extending these contracts. If a real language feature needs a new capability, extend the contract and its tests before adding special cases to orchestration.

## Review verification

`verification/ReviewSnapshotStore` captures project file hashes before export, saves the report and resolves completed templates against that snapshot. It uses the shared project-file traversal and exclusion rules; it does not parse source or depend on a language adapter. The pure template generator is shared by CLI handoffs and browser copy controls. Filesystem access and submission validation remain outside the browser bundle. `VerificationStore` validates current review identities and evidence before persisting verdicts; version-1 imports and resolved version-2 templates share that path.
