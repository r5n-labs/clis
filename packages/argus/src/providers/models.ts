import { Exit } from "@r5n/cli-core";

const CLOUDFLARE_MODELS = ["clef", "clef-flash"] as const;
const CLOUDFLARE_PREFIX = "@cf/cloudflare/";
const CLOUDFLARE_MAX_QUESTIONS = 64;
const CLOUDFLARE_MAX_CHOICES = 255;
const CLOUDFLARE_MAX_REQUEST_BYTES = 13 * 1024 * 1024;

export type ReviewModel = {
  id: string;
  provider: "typesafe" | "cloudflare";
  requestModel: string;
  maxQuestions: number;
  maxChoices: number;
  maxRequestBytes: number;
};

export function resolveModel(model: string): ReviewModel {
  const name = model.startsWith(CLOUDFLARE_PREFIX) ? model.slice(CLOUDFLARE_PREFIX.length) : model;
  if (CLOUDFLARE_MODELS.some((candidate) => candidate === name))
    return {
      id: `${CLOUDFLARE_PREFIX}${name}`,
      provider: "cloudflare",
      requestModel: name,
      maxQuestions: CLOUDFLARE_MAX_QUESTIONS,
      maxChoices: CLOUDFLARE_MAX_CHOICES,
      maxRequestBytes: CLOUDFLARE_MAX_REQUEST_BYTES,
    };
  if (model.startsWith("@cf/"))
    throw new Exit(`Unsupported Cloudflare review model: ${model}`, "Choose clef or clef-flash");
  return {
    id: model,
    provider: "typesafe",
    requestModel: model,
    maxQuestions: Number.POSITIVE_INFINITY,
    maxChoices: Number.POSITIVE_INFINITY,
    maxRequestBytes: Number.POSITIVE_INFINITY,
  };
}
