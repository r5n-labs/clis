# Source and context

[Argus](../README.md) / Source and context

## Source discovery

Translation entries are paired automatically across `.po` files by `msgctxt` and `msgid`, including projects whose message IDs are keys rather than English sentences. Metadata and plural forms accompany each entry. GDScript test targets are named `test_*` methods. Naming and comment checks also apply to ordinary methods and constructors. Nested classes have distinct identities.

Tree-sitter supplies GDScript, TypeScript and TSX syntax and declaration dependencies, plus Godot scene, resource and project-setting syntax. The gettext adapter uses `gettext-parser` for catalogue parsing and validation, with a separate source-range locator to retain original entries and line numbers. Invalid syntax stops planning instead of silently dropping evidence. Plural catalogues must declare their `Plural-Forms` header. The default scan includes `.gd`, `.tres`, `.tscn`, `.po`, `.ts`, `.tsx`, `.mts` and `.cts` files, excluding `.git`, `.godot`, `.argus`, `addons`, `node_modules` and `dist`. Symlinks are skipped. Only selected files are available as implementation context. The scanner also reads non-excluded `project.godot` autoload mappings; excluded autoload scripts remain unavailable.

Bundled directory exclusions apply at every depth, including package-local `node_modules` and `dist` folders. Existing explicit `exclude` arrays are preserved; use patterns such as `**/dist/**` to exclude a directory name throughout a monorepo.

### TypeScript

New configurations include TypeScript automatically. Existing explicit `include` arrays stay unchanged. For a TypeScript-only project:

```sh
argus init
argus config set include '["**/*.ts", "**/*.tsx", "**/*.mts", "**/*.cts"]'
argus config preset add test-meaningfulness test-promises
argus check
argus run --limit 5
```

Argus extracts named functions, generators, methods, constructors, accessors, arrow-function variables and fields, and classes. It preserves complete implementation bodies, JSDoc and comments. Overload signatures, interfaces and declarations supply contract evidence; declarations without implementations are not method checks. TSX bodies retain their JSX. JavaScript files and React/Next.js runtime conventions are outside this release.

Static context follows lexical bindings, selected local helpers, declared parameter and return types, constructors, inherited contracts, relative imports and re-exports. Relative `.js`, `.mjs` and `.cjs` references can resolve to their TypeScript counterparts; directory imports can resolve included `index` files. TypeScript `import = require()` and identifier `export =` declarations are supported. Package exports, `tsconfig` path aliases, arbitrary CommonJS `require()` calls, dynamic dispatch and full generic/union inference are not resolved. Argus does not run the compiler, resolve installed packages or execute project configuration. Unresolved expressions and omitted bodies are labelled in the review context; reference depth and byte limits still apply.

Separate Bun, Vitest and Jest conventions recognise inline `test`/`it` callbacks, suites and lifecycle fixtures imported from `bun:test`, `vitest` or `@jest/globals`, including aliases, namespace imports and chained modifiers such as `each`, `skip` and `only`. Unbound runner globals are recognised in `.test.*`, `.spec.*` and `__tests__/` files. Each test declaration is reviewed once; parameter tables are not executed. Ancestor-suite fixtures are included without sibling-suite setup. Test factories, callbacks supplied by identifier and custom runner wrappers are not expanded. Existing checks, cache identities, reports and verification commands work with these targets.

Member reassignment tracking is conservative: an assignment such as `obj.value = next` marks every same-named member in that module as reassigned, without identifying the receiver. Argus then avoids resolving untyped members from their initialisers, which may omit implementation evidence even for an unrelated object's member. Explicitly declared types can still supply resolution. This avoids treating a potentially replaced value as a reliable dependency.

## Context selection

Context modes:

| Mode | Supplied evidence |
| --- | --- |
| `target` | Target source and its comments |
| `class` | Complete method, class documentation, relevant declarations, local helpers and inherited contract; whole target for other groups |
| `references` | Local context plus selected external implementations, conventional test fixtures and evidence from registered framework integrations; oversized class targets use a budgeted overview with explicit omissions |
| `file` | Complete containing file |

Naming and documentation start with the local contract. Both distinguish a concrete unexplained assumption (`needs_explanation`) from missing evidence (`insufficient_context`). A documented intentional override can retain its shared method name. Comments explain intent but do not prove that callers enforce a precondition.

Reference selection resolves class names, literal load/preload aliases, constructor receivers, typed parameters and fields, casts, declared returns, autoload mappings, scene root scripts and unambiguous literal node lookups. Test contexts include conventional setup/teardown methods. Fixtures are supplied as evidence, not a guarantee about a framework's lifecycle ordering. For unresolved test receivers, matching methods from scene scripts and scripts loaded through fixture-used declarations are included as explicitly labelled implementation candidates. Unused preload declarations do not supply candidates. Signals and dynamically constructed objects can remain unresolved.

Related code is selected within an allowance of 65,000 bytes (85,000 in the expanded pass) including the primary source, with directly called methods prioritised over further helpers. Method bodies are never cut in half. Dependencies that do not fit are explicitly listed as omitted, and unresolved-expression diagnostics have an 8,000-byte allowance with an omitted count. These limits do not certify completeness: the evaluator must choose insufficient context when omitted evidence is essential. The target itself stays complete and can still exceed the request limit. Explicit `contextFiles` supply complete files and override automatic snippets; a pattern that matches nothing is an error.

Translations include parallel catalogue entries, literal key usages, and text from the same method or linked resource records. Resource catalogues are narrowed to complete relevant records rather than attached wholesale. Parallel locales are not assumed to be authoritative source translations; computed keys and runtime UI meaning can remain unknown. Change reviews label dependencies separately from the baseline commit and the current working tree, including deleted files' baseline dependencies.

If an answer is `insufficient_context`, Argus can make **one** expanded attempt with additional evidence: one more cross-file hop and, for methods, up to three statically resolved caller examples, including their complete bodies and local argument preparation. Supporting usage/scene/translation evidence has a 16,000-byte allowance; omissions are disclosed. No expansion is billed when no new source evidence is available or when the expanded payload exceeds `maxRequestBytes`. The initial answer is retained in the cache. Expanded answers have their own evidence checksum, are resumed without repeating the initial call, and are never expanded again. Reports expose the review stage, expansion notes and static-analysis gaps.

`maxQuestions` defaults to 32 and `maxRequestBytes` to 100,000. Requests with the same context are batched after cached questions are removed. An individual check exceeding the byte limit is reported as **blocked** and never marked checked; other checks can proceed. `check` and `run` exit non-zero while blocked checks remain. Argus never silently truncates source. The byte limit is a conservative client bound, not a token estimate or a guarantee that a model will accept or consider every part of a request; [provider context limits](models.md#requests-and-limits) still apply.

## Large classes

Large class targets in class/reference context use a partial architecture overview: class declarations, method/dependency inventory and whole selected method bodies. Omitted evidence and coverage are explicit; a complete-source checksum invalidates the overview even if an omitted body changes. Method-level checks still require their complete target. Explicit `file`/`target` modes and additional `contextFiles` remain complete and can still exceed the configured request limit. An overview enables candidate discovery, not proof that the entire class was inspected.
