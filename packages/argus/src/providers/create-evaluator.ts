import { CloudflareClient } from "./cloudflare/CloudflareClient";
import type { Evaluator } from "./Evaluator";
import { resolveModel } from "./models";
import type { ClientOptions } from "./systemone/SystemOneClient";
import { TypeSafeClient } from "./typesafe/TypeSafeClient";

export function createEvaluator(model: string, options: ClientOptions = {}): Evaluator {
  switch (resolveModel(model).provider) {
    case "typesafe":
      return new TypeSafeClient(process.env.TYPESAFE_API_KEY?.trim() ?? "", fetch, options);
    case "cloudflare":
      return new CloudflareClient(
        process.env.CLOUDFLARE_ACCOUNT_ID?.trim() ?? "",
        (process.env.CLOUDFLARE_API_TOKEN ?? process.env.CLOUDFLARE_AUTH_TOKEN)?.trim() ?? "",
        fetch,
        options,
      );
  }
}
