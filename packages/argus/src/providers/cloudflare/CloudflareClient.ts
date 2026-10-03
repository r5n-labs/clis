import { Exit } from "@r5n/cli-core";
import { boolean } from "banditypes";
import { record, textValue } from "../../config/validation";
import { resolveModel } from "../models";
import { RequestFailure } from "../retries";
import { type ClientOptions, SystemOneClient } from "../systemone/SystemOneClient";

const ACCOUNT_ID_PATTERN = /^[a-f\d]{32}$/i;
const API_ORIGIN = "https://api.cloudflare.com/client/v4/accounts";

export class CloudflareClient extends SystemOneClient {
  constructor(account: string, key: string, transport: typeof fetch = fetch, options: ClientOptions = {}) {
    if (!ACCOUNT_ID_PATTERN.test(account)) throw new Exit("Set CLOUDFLARE_ACCOUNT_ID to a valid account ID");
    if (!key || /\s/.test(key))
      throw new Exit("Set CLOUDFLARE_API_TOKEN (or CLOUDFLARE_AUTH_TOKEN) to a valid Workers AI API token");
    super(
      {
        name: "Cloudflare",
        key,
        endpoint: (payload) => {
          const model = resolveModel(payload.model);
          if (model.provider !== "cloudflare") throw new Exit("Expected a Cloudflare model");
          return `${API_ORIGIN}/${account}/ai/run/${model.id}`;
        },
        unwrap: (value, payload) => {
          const envelope = record(value, "Cloudflare response");
          if (!boolean()(envelope.success))
            throw new RequestFailure("Cloudflare reported an unsuccessful inference", false);
          const result = record(envelope.result, "Cloudflare result");
          if (resolveModel(textValue(result.model)).id !== resolveModel(payload.model).id)
            throw new Exit("Cloudflare response model does not match the request");
          return result;
        },
      },
      transport,
      options,
    );
  }
}
