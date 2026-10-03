# Review and verification

[Argus](../README.md) / Review and verification

## Start a review

Start a review with a compact overview. This saves the current evidence and a verdict template; it does not print the source or call the model API.

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

In `argus -i`, Report includes `create` to create or refresh a snapshot; `argus report create` also works directly. Omitting the ID or number in a terminal opens a candidate picker for `show`, a candidate then source-fragment picker for `evidence`, or a batch picker for `batch`. `verify` without `--import` offers saved verdict templates (most recently modified first) and a manual file-path option. Interactive `check`, `run`, `report create` and `verify` prompt for a Git base when change questions require one. Escape cancels the current action. Menus retain the previous selection, including after leaving and reopening a submenu, for the current session. Without a terminal, provide the required inputs explicitly.

The overview prints the snapshot path, verdict-file path, queue counts and copyable commands pinned to that snapshot. Retrieval commands accept `--snapshot <id>` and `--config <path>`, defaulting to the latest snapshot beside the selected config. They never rescan source or call the model API. Run `argus report create` again to capture source changes and imported verdicts; pass `--base <revision>` when change questions are configured.

`list` shows 50 candidates per page; use `--page N` and optionally `--json`. `show` returns one check, its rubric, complete answer distribution, context metadata and evidence IDs as JSON. Candidates point to the same verdict file as the default `report create`, preserving any answers already filled in. Checks outside that queue supply an embedded single-check template to save separately. `evidence` returns the exact saved path and source for an ID. Identical source fragments share an ID, so an agent can fetch them once and reuse them. Additional project files absent from the supplied context still require inspection and must be listed in the completed verdicts.

`batch N` prints one self-contained Markdown handoff with shared evidence deduplicated. `export` explicitly prints every batch. Both accept `--queue` and `--include-verified`; batch numbers are scoped to that selection. Batches aim for 120 KB, preserve whole checks, and allow a single oversized check to exceed that byte allowance. This is not an LLM token guarantee. Importing verdicts never changes membership in an existing snapshot. Fresh snapshots omit unchanged settled candidates; unresolved candidates remain available. Use an explicit snapshot ID when several review sessions share the same config.

Queues are advisory categories, not severity or certainty. Blocked checks go to `context`. Questions may map answer choices using `reviewQueues`, for example `{"insufficient_context":"context","needs_explanation":"documentation"}`; unassigned choices use `findings`. Context-labelled answers are review candidates even when not flagged. Bundled questions supply this metadata, including existing unmodified presets. Custom questions can configure it through the question editor or `argus config question edit ... --file ...`. Setting `reviewQueues: {}` opts out of preset queue defaults. Queue changes do not invalidate model answers or settled verdicts.

Report creation and output flags belong to `argus report create`: `--llm`, `--llm --batch N`, `--llm --summary`, `--json` and `--html [path]`. The `report` group itself only shows command help. These forms inspect current source; retrieval subcommands read a saved snapshot. `--llm` still prints the complete handoff, while `--json` prints the current full report without saving a review snapshot. `--llm --summary` retains its read-only summary behaviour. No report command makes API requests.

HTML reports use **Needs review** for outstanding candidates, including context checks and uncertain verdicts. Settled findings remain available through **Flagged** and the other views. Question instructions and imported verdicts are visible even when a check has no model evaluation. HTML reports provide **Copy candidates for LLM**, **Copy filtered checks**, and a per-row **Copy for LLM** button. The copy panel supports multiple parts and selectable text if browser clipboard access is unavailable. Existing source, probability and context views remain available. Regenerate the HTML to include these controls.

HTML exports save `.argus/reviews/<snapshot-id>.report-verdicts.json` with entries for every selectable check, including matched and previously verified checks. Fill only entries selected for review; other entries can stay blank. This file is separate from the CLI's candidate-only template, so exporting either format preserves work in the other.

Each finding includes the exact target-specific instructions, criteria, complete answer distribution, selection reason, source and related evidence, context omissions, hashes and evaluation identity. Question definitions and context have shared dictionaries. JSON reports use `formatVersion: 2`. Review IDs also include the handoff protocol and reporting configuration, so changed evidence, questions or selection policy invalidate downstream verdicts without necessarily rerunning the model.

Creating a review snapshot automatically saves a complete, editable JSON file at `.argus/reviews/<snapshot-id>.verdicts.json`, with an entry for every candidate across all batches. Its path appears on stderr and in the handoff. The reviewer edits that file directly, filling in verdicts and rationales and listing additional evidence as project-relative paths. Re-exporting the same snapshot preserves the file, including any answers already filled in. `--include-verified` uses a separate `<snapshot-id>.all-verdicts.json` file.

Each handoff part also includes its own `verdictTemplate` for reviewers without filesystem access. Blank or omitted entries remain unreviewed. Reviewer model defaults to `unknown`; only replace it when the exact identity is available. The handoff does not authorise changes to project source. Import the completed file using the path printed during export:

```sh
argus verify --import ".argus/reviews/<snapshot-id>.verdicts.json"
argus report create --html
```

Use the same `--config` and `--base` as the original review where applicable. Verdicts distinguish `confirmed`, `false_positive`, `deferred` and `uncertain`. Import reports how many verdicts were saved and how many candidates remain, including uncertain reviews. Templates from batches with the same `snapshotId` can be combined by merging their verdicts arrays without duplicating IDs.

`report create`, `report create --llm` and `report create --html` save the report and a file-hash manifest under `.argus/reviews/` beside the selected config. HTML copy buttons use the same saved snapshot. The manifest covers non-excluded project text files, including files outside the analysis include patterns; it skips symlinks, Git internals, binary files containing NUL bytes and Argus state. Only hashes are retained for additional files, not their contents. `--llm --summary` and JSON reports do not create review snapshots. New snapshots store shared source fragments once; earlier inline snapshots remain readable.

On import, Argus supplies additional evidence hashes from that export snapshot and checks the current files against them. It never certifies additional evidence by hashing it for the first time during import. Changed files, files added after export and files absent from the snapshot require a fresh export and review. All supplied verdicts are validated before writes begin; duplicate or unknown IDs, invalid verdicts, missing rationales, stale evidence and paths outside the project are rejected. This still depends on the reviewer declaring every additional file it used. Deleting or changing that evidence invalidates its saved verdict. Existing version-1 verdict JSON with explicit hashes remains accepted; new templates use version 2 and resolve to the same stored verdict format.

Settled verdicts remain visible in reports, while the default LLM export omits them to avoid repeated investigation. Uncertain findings remain candidates. `argus report create --llm --include-verified` revisits settled findings, including when you change your external reviewer model or custom prompt. Argus's own handoff protocol changes invalidate its review IDs; it cannot detect changes to an external prompt that has not been supplied to it. The JSON verification summary reports downstream acceptance as `(confirmed + deferred) / settled`; uncertain and stale verdicts are excluded. This measures reviewer acceptance, not correctness. Verification records live in `.argus/verifications/` and do not alter model answers or the project source.

## Standalone HTML reports

Run `argus report create --html` to save a timestamped HTML report in `.argus/reports/`. With `--config`, the reports folder lives beside that configuration file. Use `argus report create --html path/to/report.html` to choose an output path relative to the current directory. Missing parent directories are created automatically; existing files are never overwritten. The command prints the saved report's absolute path.

The HTML report embeds its data, React, JavaScript and styles in one portable file. Open it locally with JavaScript enabled; no server, CDN, network connection or API key is needed. Category tabs organise checks by question. Search and combine filters for status, target type, result and minimum confidence. Click column headers to sort, summary cards to filter, and a row's detail button to inspect its probability distribution and evaluation metadata. Each expanded row retains review context, answer probabilities and evaluation metadata, and adds a syntax-highlighted source viewer. Select the exact primary source, a supporting file, or the full review context as JSON; change reviews also expose before, after and diff views. Translations retain their complete gettext entries and parallel catalogues. Pending and blocked rows explicitly label their source as not evaluated. The source is embedded in JSON and HTML snapshots, deduplicated when questions share context. Existing HTML files need to be regenerated with `argus report create --html` to gain the viewer; generating a report makes no model requests.

Prism is bundled into the standalone viewer with GDScript, Godot resource/scene files, gettext, JavaScript/TypeScript (including JSX/TSX), HTML/XML, CSS, JSON, YAML, TOML/INI, Python, PHP, Ruby, Rust, Go, Java, Kotlin, Swift, C/C++/C#, shell, SQL, Markdown and diff grammars. Unknown formats appear as plain text. Highlighting runs only for the selected source in an expanded row and needs no CDN or network connection. Source text is rendered through React tokens rather than interpreted as HTML.

Results are paginated, with flagged checks first by default. Pending and blocked checks remain distinct from evaluated findings. Reports include project paths and cached judgements, so share them with the same care as other project artefacts.
