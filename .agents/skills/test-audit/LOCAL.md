# R5N integration

`SKILL.md` and `CAMPAIGN.md` are unmodified copies from [OpenClaw](https://github.com/openclaw/openclaw/tree/48d366fbe5b5b325340bfb327b0983c1513a1910/.agents/skills/test-audit), pinned to commit `48d366fbe5b5b325340bfb327b0983c1513a1910`. The upstream MIT licence is included in `LICENSE`.

Apply the upstream authoring gate, evidence requirements and retention bar. Repository instructions in `AGENTS.md` take precedence over commands and infrastructure specific to OpenClaw.

| Upstream workflow | R5N equivalent |
| --- | --- |
| `scripts/run-vitest.mjs`, Vitest and pnpm test commands | `bun test <owning test files>`; keep test runs sequential |
| `scripts/check-changed.mjs` and changed lanes | Inspect the actual diff and its callers; run scoped Biome, workspace type checks and relevant tests |
| Full validation | `bun biome check`, `bun type-check`, `bun test`, `bun run build`; run copied CLI smoke checks when build output changes |
| `$autoreview` | An independent Codex review of the final audit diff, its evidence and remaining contracts; verify findings before applying them |
| `$openclaw-pr-maintainer` and `scripts/pr` | This repository's existing Git/GitHub workflow and the user's current authorisation |
| Crabbox, OpenClaw remote runners and release tooling | Not part of this repository's local test workflow |

Keep source and tests unchanged while a suite or final review is running. For a PR audit, start with changed tests and the overlapping production-owner coverage. A whole-subsystem campaign is a separate scope and requires reading `CAMPAIGN.md` first. Do not contact live model providers to audit test quality.
