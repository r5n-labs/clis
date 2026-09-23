# Argus

Incremental code reviews with Jev. Argus extracts GDScript syntax, builds review context automatically, asks configurable questions, and remembers each answer against the code and question that produced it. Private and unreleased.

## Usage

From this monorepo:

```sh
bun argus init --root /path/to/game --config /path/to/reviews/config.json
bun argus check --config /path/to/reviews/config.json
TYPESAFE_API_KEY=your-key bun argus run --config /path/to/reviews/config.json
bun argus report create --config /path/to/reviews/config.json
bun argus report create --config /path/to/reviews/config.json --html /path/to/reviews/report.html
```

An external config keeps all Argus state outside the reviewed project. Running `argus init` inside a project creates `.argus/config.json`; subsequent commands discover it upwards. The root in the config is relative to the config file. Init never overwrites an existing config. Argus never executes or edits reviewed source code.

`check` is a read-only preview with an exact request count for the current plan. Answers from that plan may schedule a bounded expanded review, so the preview cannot predict every future request. `run` sends pending requests and saves each successful response immediately. `run --limit 5` limits a trial to five requests. Repeating `run` resumes remaining work. `run --follow-up-limit 10` caps expanded reviews at ten requests per run (the default); use `--follow-up-limit 0` to disable them. Follow-ups also count towards `--limit`, so `run --limit 5` evaluates at most five distinct requests in total (retry attempts are additional). All commands support `--help`; Core supplies the `-i` command menu. API credentials come exclusively from `TYPESAFE_API_KEY`, which Atlas can supply through its existing environment composition.

During `run`, a terminal progress bar shows saved requests and percentage on stderr. Redirected output contains start and finish summaries plus any retry notices. The final output shows counts, the number of unsettled review candidates, the saved report path and a command to create a fresh review queue. Individual findings are available through `report`; blocked reasons also appear in `check`. Errors show how many requests were saved before the run stopped. JSON reports remain on stdout.

`run` defaults to eight concurrent requests. Use `run --concurrency 4` to adjust the worker count (1–32), or `--concurrency 1` for sequential execution. Starts are paced at at most 15 per second, with a shared 200,000-byte rolling one-second input allowance. Bytes are a conservative pacing proxy, not an exact token count; requests larger than that allowance wait for it to clear and delay subsequent starts. API rate limits can change, so all workers share server-requested cooldowns as well.

## Built-in checks

`init --preset naming` is the default. `--preset all` additionally enables comment contradictions and missing contract explanations, architecture ownership, test meaningfulness and promised behaviour, translation quality and change regression checks. When change questions are configured, pass `--base HEAD` (or another Git revision) to `check`, `run` and `report create`. Changes include staged, unstaged, deleted and untracked selected files relative to that revision.

Tooltip accuracy is deliberately absent: finding an effect from arbitrary descriptive text is not reliably deterministic. No manual text-to-code mapping is required by any built-in check.

## Configuration commands

Run `argus config` for an interactive menu to add presets, create/edit/remove questions and edit project settings. Changes update the existing `.argus/config.json`; there is no need to initialise another configuration. Escape cancels the current operation without saving its draft. Earlier completed operations remain saved.

Direct commands are also available:

```sh
argus config show
argus config preset add comments architecture
argus config preset add all
argus config question add methods
argus config question edit methods naming-accuracy
argus config question remove methods naming-accuracy
argus config set maxQuestions 16
argus config set include '["**/*.gd", "**/*.po"]'
argus config set exclude '["addons/**", ".godot/**", ".argus/**"]'
```

`show` prints the effective configuration as JSON, including defaults. Presets are `naming`, `architecture`, `translations`, `changes`, `comment-contradictions`, `contract-explanations`, `test-meaningfulness` and `test-promises`. `all` enables these eight checks. The older broad `comments` and `tests` presets remain available. Identical presets are skipped. Unmodified earlier naming, comment, architecture and translation rubrics are upgraded when loading a config, without rewriting the file; `config show` displays the effective questions. Shared architecture and translation rubrics are framework-, format- and locale-independent; registered integrations supply specialised evidence. Custom instructions, criteria and context choices are preserved. Upgraded rubrics invalidate their old answers. Comment reviews now also cover uncommented methods; straightforward code does not require redundant comments. A preset that conflicts with a customised question stops the entire addition without changing the file. Adding `changes` or `all` requires `--base <revision>` on subsequent review commands.

Question add/edit commands open guided prompts for instructions, answer choices, code context, extra context files, target filters, the comments-only filter, flagged answers and confidence thresholds. To script these operations, supply `--file`:

```sh
argus config question add methods --file question.json
argus config question edit methods naming-accuracy --file naming-patch.json
```

An add file contains a complete question, as shown below. An edit file contains only the fields to change, for example `{"minConfidence": 0.8}`. Supplied arrays and objects replace those fields in full; other fields are retained. Set `"minConcernProbability": null` in an edit patch to disable that optional threshold; omission leaves it unchanged. Interactive edits save the complete draft, including removed optional fields. Editing `id` renames the question. Explicit `question remove <group> <id>` removes it immediately; removing through the menu asks for confirmation. Cached answers are retained.

Settings are `root`, `model`, `include`, `exclude`, `maxQuestions` and `maxRequestBytes`. File filters take JSON arrays in direct commands; the menu provides an entry editor. `root` is relative to the configuration file. Omitting a setting's value opens a prompt. Supply `--config <path>` after the subcommand and its arguments to edit an external configuration, for example `argus config preset add comments --config /path/to/config.json`. The menu also supports `argus config --config /path/to/config.json`.

Each change is validated and saved atomically. The editor refuses to overwrite a file changed since it was opened. Configuration commands do not contact Jev or delete cached answers; the checksum rules below determine which checks become pending. Run `argus check` after editing to preview the work.

## Source discovery

Translation entries are paired automatically across `.po` files by `msgctxt` and `msgid`, including projects whose message IDs are keys rather than English sentences. Metadata and plural forms accompany each entry. Test targets are named `test_*` methods. Naming and comment checks also apply to ordinary methods and constructors. Nested classes have distinct identities.

Tree-sitter supplies GDScript syntax and declaration dependencies, plus Godot scene, resource and project-setting syntax. The gettext adapter uses `gettext-parser` for catalogue parsing and validation, with a separate source-range locator to retain original entries and line numbers. Invalid syntax stops planning instead of silently dropping evidence. Plural catalogues must declare their `Plural-Forms` header. The default scan includes `.gd`, `.tres`, `.tscn` and `.po` files, excluding `.git`, `.godot`, `.argus`, `addons`, `node_modules` and `dist`. Symlinks are skipped. Only selected files are available as implementation context. The scanner also reads non-excluded `project.godot` autoload mappings; excluded autoload scripts remain unavailable.

## Custom questions

Add a choice question to a group in `questions`. No TypeScript changes are needed:

```json
{
  "version": 1,
  "root": "../game",
  "questions": {
    "methods": [
      {
        "id": "unexpected-mutation",
        "type": "choice",
        "context": "class",
        "instructions": "Does this method mutate state despite a name that promises a read-only query?",
        "criteria": {
          "consistent": "The name and state changes agree.",
          "unexpected": "A query-like name conceals a material state change.",
          "insufficient_context": "The supplied implementation does not establish the side effects."
        },
        "flag": ["unexpected"],
        "minConfidence": 0.7
      }
    ]
  }
}
```

Groups are `methods`, `classes`, `files`, `tests`, `resources`, `translations` and `changes`. Empty groups cost nothing. IDs must be unique within a group. `include` filters a question by project-relative globs; `hasComments` restricts it to targets with comments. `flag` and `minConfidence` control reporting, not evaluation. Only Jev's **choice** primitive is supported in this first version. Results are classifications and probabilities; Argus does not invent explanations or suggested fixes.

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

`maxQuestions` defaults to 32 and `maxRequestBytes` to 100,000. Requests with the same context are batched after cached questions are removed. An individual check exceeding the byte limit is reported as **blocked** and never marked checked; other checks can proceed. `check` and `run` exit non-zero while blocked checks remain. Source is never silently truncated. The byte limit is a conservative client bound, not a token estimate or a guarantee that a model will accept every request.

## Cache semantics

```
config directory/
  config.json
  cache/
    evaluations/<input-sha256>/<question-sha256>.json
    requests/<request-sha256>.json
    run.lock
  reports/<timestamp>.json
  reports/<timestamp>.html
  reviews/latest.json
  reviews/<snapshot-id>.json
  reviews/<snapshot-id>.verdicts.json
  verifications/<review-id>.json
```

Completed batch responses are journalled with each answer’s evaluation identity before individual cache entries are written. If saving a batch is interrupted, planning recovers all journalled answers before batching pending questions; the next locked run finishes the cache writes.

Input fingerprints include project identity, target identity and the exact evidence supplied. Question fingerprints include instructions, criteria, context policy, evaluator version and requested model. Adding or editing a question only schedules that question. Changing source or a supplied dependency invalidates affected checks. Changing question order, IDs, flags or confidence thresholds does not. Moving a method to another line preserves its answer when its supplied evidence is unchanged; full-file contexts necessarily change when the file changes.

Responses are validated before caching, including question IDs, categories, confidence, probability sums and usage. Writes are atomic. Raw request snapshots retain the evidence and token usage. Cache and snapshots contain source code; keep `cache/` and `reports/` out of Git. API keys are never persisted. Concurrent writers are rejected by `run.lock`. After forcibly terminating a process, confirm it is no longer running before deleting that lock.

Invalid responses, network failures, timeouts and HTTP 408, 429, 500, 502, 503, 504 or 529 automatically retry up to three times, waiting at least 1, 2 and 4 seconds. A longer `Retry-After` header takes precedence. Use `--retries 0` to disable retries or `--retries N` to allow up to ten; longer retry sequences cap the exponential delay at 30 seconds. Retries may incur additional charges and do not consume extra `--limit` or follow-up slots: those limits count distinct review requests. Answers are validated before anything is marked checked.

Permanent errors (such as invalid credentials) or exhausted retries stop new work. Already active requests finish and save successful answers before the run exits and releases its lock. A successful insufficient-context answer may trigger the separately budgeted expanded review described above. A response saved before an interruption can be recovered without another API request. `report` reflects current source and configuration; completed run snapshots remain in `reports/` for historical inspection. Terminal, JSON (`--json`) and standalone React HTML reports are available.

Run `argus report create --html` to save a timestamped HTML report in `.argus/reports/`. With `--config`, the reports folder lives beside that configuration file. Use `argus report create --html path/to/report.html` to choose an output path relative to the current directory. Missing parent directories are created automatically; existing files are never overwritten. The command prints the saved report's absolute path.

The HTML report embeds its data, React, JavaScript and styles in one portable file. Open it locally with JavaScript enabled; no server, CDN, network connection or API key is needed. Category tabs organise checks by question. Search and combine filters for status, target type, result and minimum confidence. Click column headers to sort, summary cards to filter, and a row's detail button to inspect its probability distribution and evaluation metadata. Each expanded row retains review context, answer probabilities and evaluation metadata, and adds a syntax-highlighted source viewer. Select the exact primary source, a supporting file, or the full review context as JSON; change reviews also expose before, after and diff views. Translations retain their complete gettext entries and parallel catalogues. Pending and blocked rows explicitly label their source as not evaluated. The source is embedded in JSON and HTML snapshots, deduplicated when questions share context. Existing HTML files need to be regenerated with `argus report create --html` to gain the viewer; generating a report makes no Jev requests.

Prism is bundled into the standalone viewer with GDScript, Godot resource/scene files, gettext, JavaScript/TypeScript (including JSX/TSX), HTML/XML, CSS, JSON, YAML, TOML/INI, Python, PHP, Ruby, Rust, Go, Java, Kotlin, Swift, C/C++/C#, shell, SQL, Markdown and diff grammars. Unknown formats appear as plain text. Highlighting runs only for the selected source in an expanded row and needs no CDN or network connection. Source text is rendered through React tokens rather than interpreted as HTML.

Results are paginated, with flagged checks first by default. Pending and blocked checks remain distinct from evaluated findings. Reports include project paths and cached judgements, so share them with the same care as other project artefacts.

## Development

```sh
bun test packages/argus/tests
bun --filter @r5n/argus type-check
bun --filter @r5n/argus build
```

The build embeds the Tree-sitter runtime, GDScript and Godot resource grammars, and the gettext parser into `dist/cli.js`. The Godot resource grammar is a pinned, patched WASM asset with [build provenance and rebuild instructions](src/formats/godot-resource/grammar/README.md). The executable needs Bun, and Git for change checks, but no installed runtime packages or companion WASM files. Language and format adapters extend `SourceAdapter`; framework integrations and review contributors provide evidence through explicit contracts. Dependency tests enforce these boundaries. See [ARCHITECTURE.md](ARCHITECTURE.md) for ownership and extension rules. Configuration and network boundaries use the monorepo's `banditypes` conventions. See [schema.json](schema.json) for editor configuration support and [TypeSafe's documentation](https://docs.typesafe.ai/primitives) for the API's question model.

## Jev → LLM review

Start a review with a compact overview. This saves the current evidence and a verdict template; it does not print the source or call Jev.

```sh
argus report create
argus report list
argus report list --queue findings
argus report list --queue context
argus report list --queue documentation
argus report show <review-id>
argus report evidence <evidence-id>
argus report batch 1
argus report export | pbcopy
argus report html
```

In `argus -i`, Report includes `create` to create or refresh a snapshot; `argus report create` also works directly. Omitting the ID or number in a terminal opens a candidate picker for `show`, a candidate then source-fragment picker for `evidence`, or a batch picker for `batch`. `verify` without `--import` offers saved verdict templates (most recently modified first) and a manual file-path option. `report create` and `verify` prompt for a Git base when change questions require one. Escape cancels the current action. Menus retain the previous selection, including after leaving and reopening a submenu, for the current session. Without a terminal, provide the required inputs explicitly.

The overview prints the snapshot path, verdict-file path, queue counts and copyable commands pinned to that snapshot. Retrieval commands accept `--snapshot <id>` and `--config <path>`, defaulting to the latest snapshot beside the selected config. They never rescan source or call Jev. Run `argus report create` again to capture source changes and imported verdicts; pass `--base <revision>` when change questions are configured.

`list` shows 50 candidates per page; use `--page N` and optionally `--json`. `show` returns one check, its rubric, complete answer distribution, context metadata and evidence IDs as JSON. Candidates point to the same verdict file as the default `report`, preserving any answers already filled in. Checks outside that queue supply an embedded single-check template to save separately. `evidence` returns the exact saved path and source for an ID. Identical source fragments share an ID, so an agent can fetch them once and reuse them. Additional project files absent from the supplied context still require inspection and must be listed in the completed verdicts.

`batch N` prints one self-contained Markdown handoff with shared evidence deduplicated. `export` explicitly prints every batch. Both accept `--queue` and `--include-verified`; batch numbers are scoped to that selection. Batches aim for 120 KB, preserve whole checks, and allow a single oversized check to exceed that byte allowance. This is not an LLM token guarantee. Importing verdicts never changes membership in an existing snapshot. Fresh snapshots omit unchanged settled candidates; unresolved candidates remain available. Use an explicit snapshot ID when several review sessions share the same config.

Queues are advisory categories, not severity or certainty. Blocked checks go to `context`. Questions may map answer choices using `reviewQueues`, for example `{"insufficient_context":"context","needs_explanation":"documentation"}`; unassigned choices use `findings`. Context-labelled answers are review candidates even when not flagged. Bundled questions supply this metadata, including existing unmodified presets. Custom questions can configure it through the question editor or `argus config question edit ... --file ...`. Setting `reviewQueues: {}` opts out of preset queue defaults. Queue changes do not invalidate Jev answers or settled verdicts.

Report creation and output flags belong to `argus report create`: `--llm`, `--llm --batch N`, `--llm --summary`, `--json` and `--html [path]`. The `report` group itself only shows command help. These forms inspect current source; retrieval subcommands read a saved snapshot. `--llm` still prints the complete handoff, while `--json` prints the current full report without saving a review snapshot. `--llm --summary` retains its read-only summary behaviour. No report command makes API requests.

HTML reports provide **Copy candidates for LLM**, **Copy filtered checks**, and a per-row **Copy for LLM** button. The copy panel supports multiple parts and selectable text if browser clipboard access is unavailable. Existing source, probability and context views remain available. Regenerate the HTML to include these controls.

HTML exports save `.argus/reviews/<snapshot-id>.report-verdicts.json` with entries for every selectable check, including matched and previously verified checks. Fill only entries selected for review; other entries can stay blank. This file is separate from the CLI's candidate-only template, so exporting either format preserves work in the other.

Each finding includes the exact target-specific instructions, criteria, complete answer distribution, selection reason, source and related evidence, context omissions, hashes and evaluation identity. Question definitions and context have shared dictionaries. JSON reports use `formatVersion: 2`. Review IDs also include the handoff protocol and reporting configuration, so changed evidence, questions or selection policy invalidate downstream verdicts without necessarily rerunning Jev.

Creating a review snapshot automatically saves a complete, editable JSON file at `.argus/reviews/<snapshot-id>.verdicts.json`, with an entry for every candidate across all batches. Its path appears on stderr and in the handoff. The reviewer edits that file directly, filling in verdicts and rationales and listing additional evidence as project-relative paths. Re-exporting the same snapshot preserves the file, including any answers already filled in. `--include-verified` uses a separate `<snapshot-id>.all-verdicts.json` file.

Each handoff part also includes its own `verdictTemplate` for reviewers without filesystem access. Blank or omitted entries remain unreviewed. Reviewer model defaults to `unknown`; only replace it when the exact identity is available. The handoff does not authorise changes to project source. Import the completed file using the path printed during export:

```sh
argus verify --import ".argus/reviews/<snapshot-id>.verdicts.json"
argus report create --html
```

Use the same `--config` and `--base` as the original review where applicable. Verdicts distinguish `confirmed`, `false_positive`, `deferred` and `uncertain`. Import reports how many verdicts were saved and how many candidates remain, including uncertain reviews. Templates from batches with the same `snapshotId` can be combined by merging their verdicts arrays without duplicating IDs.

`report create`, `report create --llm` and `report create --html` save the report and a file-hash manifest under `.argus/reviews/` beside the selected config. HTML copy buttons use the same saved snapshot. The manifest covers non-excluded project text files, including files outside the analysis include patterns; it skips symlinks, Git internals, binary files containing NUL bytes and Argus state. Only hashes are retained for additional files, not their contents. `--llm --summary` and JSON reports do not create review snapshots. New snapshots store shared source fragments once; earlier inline snapshots remain readable.

On import, Argus supplies additional evidence hashes from that export snapshot and checks the current files against them. It never certifies additional evidence by hashing it for the first time during import. Changed files, files added after export and files absent from the snapshot require a fresh export and review. All supplied verdicts are validated before writes begin; duplicate or unknown IDs, invalid verdicts, missing rationales, stale evidence and paths outside the project are rejected. This still depends on the reviewer declaring every additional file it used. Deleting or changing that evidence invalidates its saved verdict. Existing version-1 verdict JSON with explicit hashes remains accepted; new templates use version 2 and resolve to the same stored verdict format.

Settled verdicts remain visible in reports, while the default LLM export omits them to avoid repeated investigation. Uncertain findings remain candidates. `argus report create --llm --include-verified` revisits settled findings, including when you change your external reviewer model or custom prompt. Argus's own handoff protocol changes invalidate its review IDs; it cannot detect changes to an external prompt that has not been supplied to it. The JSON verification summary reports downstream acceptance as `(confirmed + deferred) / settled`; uncertain and stale verdicts are excluded. This measures reviewer acceptance, not correctness. Verification records live in `.argus/verifications/` and do not alter Jev's answers or the project source.

## Focused presets and uncertainty

New `all` configurations use independent `test-meaningfulness`, `test-promises`, `comment-contradictions` and `contract-explanations` checks. Existing configurations keep their broad `test-quality` and `comment-accuracy` checks until explicitly upgraded:

```sh
argus config preset upgrade
argus check
```

The upgrade replaces only unmodified stock questions, preserves customised questions and retains old cache entries. New questions require new evaluations; this is intentional, because an answer to a broad question cannot be relabelled as answers to independent questions. Checks with identical context are still batched. Individual focused presets can also be added by name with `argus config preset add`.

Each question optionally accepts `minConcernProbability`: a threshold on the sum of probabilities for its `flag` choices. This can select ambiguous candidates even when the highest-probability answer is benign. It supplements the existing winning-label/minimum-confidence rule and is disabled by default; no threshold is claimed to be calibrated. Edit it through the question editor or a JSON patch. Reporting changes reuse Jev answers. The report shows both the original answer and why it was selected.

Large class targets in class/reference context use a partial architecture overview: class declarations, method/dependency inventory and whole selected method bodies. Omitted evidence and coverage are explicit; a complete-source checksum invalidates the overview even if an omitted body changes. Method-level checks still require their complete target. Explicit `file`/`target` modes and additional `contextFiles` remain complete and can still exceed the configured request limit. An overview enables candidate discovery, not proof that the entire class was inspected.

## Judgement benchmark

`benchmarks/cases.ts` contains eight synthetic, rationale-labelled examples covering valid base hooks and development overrides, cache sampling assertions, missing promised spending, meaningful partial test coverage, unexplained bounds, self-explanatory code and contradictory comments. It includes positive and negative cases. Labels are reviewable expectations, not independently established ground truth.

From this monorepo, inspect cached benchmark results without API calls:

```sh
bun --filter @r5n/argus benchmark --output /path/to/isolated-benchmark
```

Add `--live` to explicitly evaluate missing cases using `TYPESAFE_API_KEY`. Responses are cached by exact model/payload fingerprint; model or prompt changes create new benchmark requests. `--model` selects a model. Results report candidate recall, precision against labels, label accuracy, concern Brier score and input-token usage of selected candidates. Missing cases remain visible and are not counted as successes. This small set does not establish population calibration or downstream LLM acceptance. Normal `bun test` verifies the scoring and extraction mechanics without paid model calls.
