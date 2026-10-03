import { Exit } from "@r5n/cli-core";
import { API_ENDPOINT } from "../../constants";
import { resolveModel } from "../models";
import { type ClientOptions, SystemOneClient } from "../systemone/SystemOneClient";

export class TypeSafeClient extends SystemOneClient {
  constructor(key: string, transport: typeof fetch = fetch, options: ClientOptions = {}) {
    if (!key || /\s/.test(key)) throw new Exit("Set TYPESAFE_API_KEY to a valid API key");
    super(
      {
        name: "TypeSafe",
        key,
        endpoint: (payload) => {
          if (resolveModel(payload.model).provider !== "typesafe") throw new Exit("Expected a TypeSafe model");
          return API_ENDPOINT;
        },
        unwrap: (value) => value,
      },
      transport,
      options,
    );
  }
}
