# Atlas

Env/config profile CLI for sharing configuration across machines and tools.

**Not released yet.** The package is being rebuilt as a profile-based env composition tool — define named profiles (inheritance, dotenv files, literal vars, secret references), then inject them into processes (`atlas run`) or render them to files (`atlas export`). The rewrite lands via [PR #12](https://github.com/r5n-labs/clis/pull/12); a multi-target `apply` and file-watching sync are planned follow-ups.

Until the first release the package is marked `private` and the code on this branch is a placeholder.

## License

Apache 2.0 — see [LICENSE](../../LICENSE)
