<p align="center">
  <img src="https://raw.githubusercontent.com/r5n-labs/clis/develop/packages/argus/assets/logo.svg" width="128" alt="Argus logo — a watchful eye">
</p>

# Argus

**Review what changed. Keep what you already checked.**

Argus extracts source code, gathers related evidence and asks configurable review questions. Answers are cached against the exact code, question and model, so new questions and changed code receive fresh evaluations. Review candidates can then be checked independently and saved as verdicts.

Supports **GDScript, TypeScript/TSX, Godot resources and gettext catalogues**, with **Jev, Cloudflare Clef and Clef Flash** as evaluation models. Argus never executes or edits the reviewed source.

Requires [Bun](https://bun.sh); change reviews also require Git.

## Quick start

Install Argus, then initialise a review. An external configuration keeps Argus state outside the project being reviewed:

```sh
bun add -g @r5n/argus
argus init --root /path/to/project --config /path/to/reviews/config.json
argus check --config /path/to/reviews/config.json
```

`check` previews pending work without an API call. Set the credentials for your [chosen model](https://github.com/r5n-labs/clis/blob/develop/packages/argus/docs/models.md), then try a small run:

```sh
argus run --limit 5 --config /path/to/reviews/config.json
argus report create --html --config /path/to/reviews/config.json
```

The report command prints the saved HTML path. Open it locally; it includes its own data, source viewer and scripts. Repeating `run` resumes missing answers.

To switch from the default Jev model to Cloudflare Clef:

```sh
argus config set model clef --config /path/to/reviews/config.json
```

## Review workflow

```text
Source + questions
       |
       v
check -> run -> report create -> independent review -> verify --import
         |            |
         v            v
    Cached answers  Saved evidence + verdict template
```

Model answers are candidates for review. Reports retain the evidence, probability distribution and context gaps; a flag alone does not establish a defect.

| Task | Command |
| --- | --- |
| Preview requests and blocked checks | `argus check` |
| Evaluate missing answers | `argus run` |
| Add review presets | `argus config preset add all` |
| Create an evidence snapshot | `argus report create` |
| Browse candidates | `argus report list` |
| Read a saved check or its source | `argus report show <review-id>` / `argus report evidence <evidence-id>` |
| Export a review batch | `argus report batch 1` |
| Import completed verdicts | `argus verify --import <verdicts.json>` |

Add `--config <path>` when using an external configuration. Change questions require `--base <revision>` on `check`, `run`, `report create` and verification where applicable. `--preset naming` is the initial default; `all` adds comments, architecture, tests, translations and change checks. Use `argus -i` for the interactive menu or append `--help` to a command.

## Guides

| Guide | Covers |
| --- | --- |
| [Models](https://github.com/r5n-labs/clis/blob/develop/packages/argus/docs/models.md) | Jev, Clef, credentials and model selection |
| [Configuration and questions](https://github.com/r5n-labs/clis/blob/develop/packages/argus/docs/configuration.md) | Presets, custom questions, filters and confidence thresholds |
| [Source and context](https://github.com/r5n-labs/clis/blob/develop/packages/argus/docs/source-and-context.md) | Supported syntax, evidence selection and analysis limits |
| [Running and caching](https://github.com/r5n-labs/clis/blob/develop/packages/argus/docs/execution.md) | Request budgets, retries, concurrency, cache recovery and storage |
| [Review and verification](https://github.com/r5n-labs/clis/blob/develop/packages/argus/docs/review.md) | HTML reports, evidence snapshots, review queues and verdict imports |
| [Judgement benchmark](https://github.com/r5n-labs/clis/blob/develop/packages/argus/docs/benchmark.md) | Compare model answers against a small labelled fixture set |
| [Development](https://github.com/r5n-labs/clis/blob/develop/packages/argus/docs/development.md) | Build, smoke checks, parser provenance and extension contracts |

Configuration has an [editor schema](schema.json). Implementation ownership is documented in [ARCHITECTURE.md](https://github.com/r5n-labs/clis/blob/develop/packages/argus/ARCHITECTURE.md).

## Licence

[Apache 2.0](LICENSE).
