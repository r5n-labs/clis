import { Exit } from "@r5n/cli-core";
import { REQUEST_TIMEOUT_MS } from "../../constants";
import type { ApiPayload } from "../../domain/review-plan";
import type { Evaluator } from "../Evaluator";
import { RequestScheduler } from "../RequestScheduler";
import { DEFAULT_RETRIES, httpFailure, MAX_RETRIES, RequestFailure, type RetryNotice, retryDelay } from "../retries";
import { serialisePayload } from "./payload";
import type { ApiResponse } from "./schemas";
import { parseResponse } from "./schemas";

export type ClientOptions = { retries?: number; scheduler?: RequestScheduler; onRetry?: (notice: RetryNotice) => void };
type Provider = {
  name: string;
  key: string;
  endpoint: (payload: ApiPayload) => string;
  unwrap: (value: unknown, payload: ApiPayload) => unknown;
};

export class SystemOneClient implements Evaluator {
  private readonly scheduler: RequestScheduler;
  private readonly retries: number;

  constructor(
    private readonly provider: Provider,
    private readonly transport: typeof fetch = fetch,
    private readonly options: ClientOptions = {},
  ) {
    this.scheduler = options.scheduler ?? new RequestScheduler();
    this.retries = options.retries ?? DEFAULT_RETRIES;
    if (!Number.isSafeInteger(this.retries) || this.retries < 0 || this.retries > MAX_RETRIES)
      throw new Exit(`--retries must be an integer between 0 and ${MAX_RETRIES}`);
  }

  async evaluate(payload: ApiPayload): Promise<ApiResponse> {
    const body = serialisePayload(payload);
    const endpoint = this.provider.endpoint(payload);
    const bytes = Buffer.byteLength(body);
    for (let attempt = 0; ; attempt++) {
      await this.scheduler.acquire(bytes);
      try {
        return await this.request(payload, body, endpoint);
      } catch (error) {
        if (!(error instanceof RequestFailure)) throw error;
        if (!error.retryable || attempt >= this.retries)
          throw new Exit(
            error.message,
            "Completed evaluations are saved. No invalid answers were marked as checked. Rerun to resume.",
          );
        const delayMs = retryDelay(attempt, error);
        this.scheduler.pause(delayMs);
        this.options.onRetry?.({ reason: error.message, retry: attempt + 1, retries: this.retries, delayMs });
      }
    }
  }

  private async request(payload: ApiPayload, body: string, endpoint: string): Promise<ApiResponse> {
    let response: Response;
    try {
      response = await this.transport(endpoint, {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        headers: { Authorization: `Bearer ${this.provider.key}`, "Content-Type": "application/json" },
        body,
      });
    } catch {
      throw new RequestFailure(`${this.provider.name} request failed or timed out`, true);
    }
    if (!response.ok) {
      const failure = httpFailure(response, this.scheduler.now(), this.provider.name);
      try {
        await response.body?.cancel();
      } catch {
        throw failure;
      }
      throw failure;
    }
    try {
      return parseResponse(this.provider.unwrap(await response.json(), payload), payload);
    } catch (error) {
      if (error instanceof RequestFailure) throw error;
      throw new RequestFailure(`${this.provider.name} returned an invalid response`, true);
    }
  }
}
