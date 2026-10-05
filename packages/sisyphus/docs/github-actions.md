# GitHub Actions

[Sisyphus](../README.md) / GitHub Actions

Add Sisyphus as a development dependency with `bun add -d @r5n/sisyphus` before using this workflow.

A push-based release job, modelled on this repo's own workflow: roll whenever pending stones land on the main branch. Uses npm trusted publishing (OIDC), which needs `id-token: write` and npm >= 11.5.1, plus each package configured for trusted publishing on npmjs.com. If you don't use OIDC, `roll` publishes with plain `npm publish`, so a granular token in `~/.npmrc` (via `NPM_TOKEN`) works too.

```yaml
name: Release

on:
  push:
    branches: [main]

concurrency:
  group: sisyphus-release
  cancel-in-progress: false

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
      - name: Reset release state
        run: |
          RELEASE_DIR="$(git rev-parse --git-path sisyphus/release)"
          echo "SIS_RELEASE_DIR=$RELEASE_DIR" >> "$GITHUB_ENV"
          rm -rf "$RELEASE_DIR"
      - name: Restore release state
        uses: actions/cache/restore@v6
        with:
          path: ${{ env.SIS_RELEASE_DIR }}
          key: sisyphus-release-${{ github.run_id }}-${{ github.run_attempt }}
          restore-keys: sisyphus-release-${{ github.run_id }}-
      - name: Remove cached release lock
        run: rm -f "$SIS_RELEASE_DIR/.write.lock" "$SIS_RELEASE_DIR"/.write.lock.*.owner "$SIS_RELEASE_DIR"/.write.lock.*.claim
      - uses: oven-sh/setup-bun@v2
      - run: bun install
      - run: npm install -g npm@11
      - name: Roll release
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"
          if [ -f "$SIS_RELEASE_DIR/active.json" ]; then
            bun run sisyphus roll --resume
          elif [ "$(bun run sisyphus check --json | jq '.stones | length')" != "0" ]; then
            bun run sisyphus roll --yes
          fi
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
      - name: Inspect release state
        id: release-state
        if: always()
        run: |
          if [ -f "$SIS_RELEASE_DIR/active.json" ] || ls "$SIS_RELEASE_DIR"/history/*.json >/dev/null 2>&1; then
            echo "save=true" >> "$GITHUB_OUTPUT"
          fi
      - name: Save release state
        if: always() && steps.release-state.outputs.save == 'true'
        uses: actions/cache/save@v6
        with:
          path: ${{ env.SIS_RELEASE_DIR }}
          key: sisyphus-release-${{ github.run_id }}-${{ github.run_attempt }}
```

Once a release pushes or publishes, `roll` keeps a recovery ledger under `$(git rev-parse --git-path sisyphus/release)`. The cache steps carry that ledger between attempts of the same workflow run, so re-running the failed job resumes the release on a fresh runner: `roll --resume` checks out the recorded release commit when the job starts from the release's base commit with no tracked changes, then reconciles the push and npm state instead of starting over. Recover with **Re-run failed jobs**; a new workflow run, including a manual dispatch, starts without the ledger. The state is saved only when it holds an incomplete or completed release, so an attempt that fails before writing a ledger cannot hide an earlier attempt's state. The reset step keeps a persistent self-hosted runner from resuming a ledger left by another run.

On self-hosted runners, set `NPM_CONFIG_PROVENANCE: "false"` on the roll step; provenance generation only works on GitHub-hosted runners. For the PR-driven flow (stone per merged PR, rolling release PR, publish on merge), run `sisyphus actions init` and commit the generated workflows instead.
