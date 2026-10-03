# GitHub Actions

[Sisyphus](../README.md) / GitHub Actions

Add Sisyphus as a development dependency with `bun add -d @r5n/sisyphus` before using this workflow.

A push-based release job, modelled on this repo's own workflow: roll whenever pending stones land on the main branch. Uses npm trusted publishing (OIDC), which needs `id-token: write` and npm >= 11.5.1, plus each package configured for trusted publishing on npmjs.com. If you don't use OIDC, `roll` publishes with plain `npm publish`, so a granular token in `~/.npmrc` (via `NPM_TOKEN`) works too.

```yaml
name: Release

on:
  push:
    branches: [main]

permissions:
  contents: write
  id-token: write

jobs:
  release:
    runs-on: ubuntu-latest
    if: "!startsWith(github.event.head_commit.message, 'chore(release):')"
    steps:
      - uses: actions/checkout@v7
        with:
          fetch-depth: 0
      - uses: oven-sh/setup-bun@v2
      - run: bun install
      - run: npm install -g npm@11
      - name: Check for pending stones
        run: |
          COUNT=$(bun run sisyphus check --json | jq '.stones | length')
          echo "STONES_COUNT=$COUNT" >> "$GITHUB_ENV"
      - name: Roll release
        if: env.STONES_COUNT != '0'
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"
          bun run sisyphus roll --yes
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

On self-hosted runners, set `NPM_CONFIG_PROVENANCE: "false"` on the roll step; provenance generation only works on GitHub-hosted runners. For the PR-driven flow (stone per merged PR, rolling release PR, publish on merge), run `sisyphus actions init` and commit the generated workflows instead.
