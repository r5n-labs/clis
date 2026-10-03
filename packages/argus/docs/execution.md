# Running and caching

[Argus](../README.md) / Running and caching

## Running a review

An external config keeps all Argus state outside the reviewed project. Running `argus init` inside a project creates `.argus/config.json`; subsequent commands discover it upwards. The root in the config is relative to the config file. Init never overwrites an existing config. Argus never executes or edits reviewed source code.

`check` is a read-only preview with an exact request count for the current plan. Answers from that plan may schedule a bounded expanded review, so the preview cannot predict every future request. `run` sends pending requests and saves each successful response immediately. `run --limit 5` limits a trial to five requests. Repeating `run` resumes remaining work. `run --follow-up-limit 10` caps expanded reviews at ten requests per run (the default); use `--follow-up-limit 0` to disable them. Follow-ups also count towards `--limit`, so `run --limit 5` evaluates at most five distinct requests in total (retry attempts are additional). All commands support `--help`; Core supplies the `-i` command menu. API credentials come from the environment for the [selected model](models.md); Atlas can supply them through its existing environment composition.

During `run`, a terminal progress bar shows saved requests and percentage on stderr. Redirected output contains start and finish summaries plus any retry notices. The final output shows counts, the number of unsettled review candidates, the saved report path and a command to create a fresh review queue. Individual findings are available through `report`; blocked reasons also appear in `check`. Errors show how many requests were saved before the run stopped. JSON reports remain on stdout.

`run` defaults to eight concurrent requests. Use `run --concurrency 4` to adjust the worker count (1–32), or `--concurrency 1` for sequential execution. Starts are paced at at most 15 per second, with a shared 200,000-byte rolling one-second input allowance. Bytes are a conservative pacing proxy, not an exact token count; requests larger than that allowance wait for it to clear and delay subsequent starts. API rate limits can change, so all workers share server-requested cooldowns as well.

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

Input fingerprints include project identity, target identity and the exact evidence supplied. Question fingerprints include instructions, criteria, context policy, evaluator version and provider/model identity. Short and canonical Cloudflare model names use the same identity; existing Jev identities are preserved. Adding or editing a question only schedules that question. Changing source or a supplied dependency invalidates affected checks. Changing question order, IDs, flags or confidence thresholds does not. Moving a method to another line preserves its answer when its supplied evidence is unchanged; full-file contexts necessarily change when the file changes.

Responses are validated before caching, including question IDs, categories, confidence, probability sums and usage. Writes are atomic. Raw request snapshots retain the evidence and token usage. Cache and snapshots contain source code; keep `cache/` and `reports/` out of Git. API keys are never persisted. Concurrent writers are rejected by `run.lock`. After forcibly terminating a process, confirm it is no longer running before deleting that lock.

Invalid responses, network failures, timeouts and HTTP 408, 429, 500, 502, 503, 504 or 529 automatically retry up to three times, waiting at least 1, 2 and 4 seconds. A longer `Retry-After` header takes precedence. Use `--retries 0` to disable retries or `--retries N` to allow up to ten; longer retry sequences cap the exponential delay at 30 seconds. Retries may incur additional charges and do not consume extra `--limit` or follow-up slots: those limits count distinct review requests. Answers are validated before anything is marked checked.

Permanent errors (such as invalid credentials) or exhausted retries stop new work. Already active requests finish and save successful answers before the run exits and releases its lock. A successful insufficient-context answer may trigger a separately budgeted [expanded review](source-and-context.md#context-selection). A response saved before an interruption can be recovered without another API request. `report create` reflects current source and configuration; retrieval commands read saved snapshots. Completed run snapshots remain in `reports/` for historical inspection. Terminal, JSON (`--json`) and standalone React HTML reports are available.

See [review and verification](review.md) for saved snapshots, HTML reports and independent verdicts.
