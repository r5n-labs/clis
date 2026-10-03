import type { ApiPayload } from "../domain/review-plan";
import type { ApiResponse } from "./systemone/schemas";

export interface Evaluator {
  evaluate(payload: ApiPayload): Promise<ApiResponse>;
}
