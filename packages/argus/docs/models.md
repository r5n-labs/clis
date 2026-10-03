# Models

[Argus](../README.md) / Models

Argus uses models to answer structured choice questions about supplied code and evidence. Choose the model with the existing `model` setting; the provider is selected automatically.

| Model | `model` value | Service | Environment variables |
| --- | --- | --- | --- |
| Jev (default) | `jev-1.13.0` | TypeSafe | `TYPESAFE_API_KEY` |
| Clef | `clef` or `@cf/cloudflare/clef` | Cloudflare Workers AI | `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN` |
| Clef Flash | `clef-flash` or `@cf/cloudflare/clef-flash` | Cloudflare Workers AI | `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN` |

Clef and Clef Flash provide the structured choice interface used by Argus. This integration sends text code context; it does not submit images. See the official [Clef](https://developers.cloudflare.com/workers-ai/models/clef/) and [Clef Flash](https://developers.cloudflare.com/workers-ai/models/clef-flash/) model pages.

## Choose a model

From the monorepo root:

```sh
argus config set model clef --config /path/to/reviews/config.json
argus check --config /path/to/reviews/config.json
argus run --limit 5 --config /path/to/reviews/config.json
```

For Clef Flash, use `clef-flash`. For Jev, use `jev-1.13.0`. Other unprefixed model IDs are passed to TypeSafe, so their availability depends on that API; unsupported Cloudflare model IDs are rejected during planning.

The short and canonical Cloudflare names share a cache identity. Different models and providers keep separate answers. Existing Jev configurations and cached answers remain usable.

## Credentials

Provide credentials through the process environment. For Cloudflare, use your account ID and a token permitted to run Workers AI models; [Cloudflare's REST API setup guide](https://developers.cloudflare.com/workers-ai/get-started/rest-api/) describes how to obtain them. `CLOUDFLARE_AUTH_TOKEN` is also accepted when `CLOUDFLARE_API_TOKEN` is unset.

For Jev, supply `TYPESAFE_API_KEY`. [TypeSafe's documentation](https://docs.typesafe.ai/primitives) describes its question API.

Credentials do not belong in Argus configuration and are never persisted in its cache or reports. [Atlas](../../atlas/README.md) can supply them through environment composition. `check`, configuration editing and report commands do not need API credentials or make model requests.

## Requests and limits

Argus applies the smaller of its configured request budget and the provider's limits. Defaults remain 32 questions and 100,000 bytes per request. Cloudflare batches are capped at 64 questions and 13 MiB, with at most 255 answer choices per question. Invalid choices or unsupported Cloudflare models fail before API calls; oversized checks are reported as blocked.

Argus sends its selected context intact, but byte limits are not token limits. Cloudflare documents that state exceeding the model's context window may be truncated. A complete client payload therefore does not guarantee that the model considered every part of it; see the [Clef input specification](https://developers.cloudflare.com/workers-ai/models/clef/).

Retries and expanded-context follow-ups can make additional requests. Use `--limit`, `--follow-up-limit` and `--retries` to bound a trial; see [running and caching](execution.md). Reported confidence is not a calibrated guarantee of correctness.

## Compare and extend

The [judgement benchmark](benchmark.md) accepts the same model names. It helps compare answers on a small synthetic fixture set; it does not establish which model is best for every project.

Model selection and network adapters are separate from source extraction, review planning, caching and reports. Additional providers can implement the shared evaluation contract without changing language adapters. See [the architecture](../ARCHITECTURE.md) for ownership and extension points.
