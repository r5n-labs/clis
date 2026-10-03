import type { ApiPayload } from "../../domain/review-plan";
import { resolveModel } from "../models";

export function serialisePayload(payload: ApiPayload): string {
  return JSON.stringify({ ...payload, model: resolveModel(payload.model).requestModel });
}
