# Judgement benchmark

[Argus](../README.md) / Judgement benchmark

`benchmarks/cases.ts` contains eight synthetic, rationale-labelled examples covering valid base hooks and development overrides, cache sampling assertions, missing promised spending, meaningful partial test coverage, unexplained bounds, self-explanatory code and contradictory comments. It includes positive and negative cases. Labels are reviewable expectations, not independently established ground truth.

From this monorepo, inspect cached benchmark results without API calls:

```sh
bun --filter @r5n/argus benchmark --output /path/to/isolated-benchmark
```

Add `--live` to explicitly evaluate missing cases using the [selected model's credentials](models.md). Responses are cached by exact model/payload fingerprint; model or prompt changes create new benchmark requests. `--model` selects a model, including `jev-1.13.0`, `clef` and `clef-flash`; the default is Jev. Short and canonical Cloudflare names share cached results. Results report candidate recall, precision against labels, label accuracy, concern Brier score and input-token usage of selected candidates. Missing cases remain visible and are not counted as successes. This small set does not establish population calibration or downstream LLM acceptance. Normal `bun test` verifies the scoring and extraction mechanics without paid model calls.
