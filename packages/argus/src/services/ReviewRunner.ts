import { existsSync } from "node:fs";
import { join } from "node:path";
import { Exit } from "@r5n/cli-core";
import { readJson } from "../config/loader";
import { record } from "../config/validation";
import { CACHE_VERSION } from "../constants";
import type { RequestBatch, ReviewPlan } from "../domain/review-plan";
import type { Evaluator } from "../providers/jev/JevClient";
import type { ApiResponse } from "../providers/jev/schemas";
import { parseResponse } from "../providers/jev/schemas";
import type { EvaluationStore } from "../storage/EvaluationStore";
import { writeJson } from "../storage/EvaluationStore";
import { fingerprint } from "../storage/fingerprints";

type BatchEvaluation = { response: ApiResponse; evaluatedAt: string };
export const DEFAULT_CONCURRENCY = 8;
export const MAX_CONCURRENCY = 32;

export class ReviewRunner {
  constructor(
    private readonly store: EvaluationStore,
    private readonly client: Evaluator,
    private readonly concurrency = DEFAULT_CONCURRENCY,
  ) {
    if (!Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > MAX_CONCURRENCY)
      throw new Exit(`--concurrency must be an integer between 1 and ${MAX_CONCURRENCY}`);
  }

  async run(
    plan: ReviewPlan,
    batches: RequestBatch[],
    progress: (completed: number, total: number) => void = () => {},
  ): Promise<void> {
    let completed = 0;
    let next = 0;
    let failure: { error: unknown } | undefined;
    const work = async () => {
      while (!failure) {
        const batch = batches[next++];
        if (!batch) return;
        try {
          const evaluation = await this.evaluateBatch(batch);
          this.saveEvaluations(batch, evaluation);
          completed++;
          progress(completed, batches.length);
        } catch (error) {
          failure ??= { error };
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(this.concurrency, batches.length) }, work));
    if (failure) throw failure.error;
    for (const item of plan.items) item.evaluation = this.store.find(item);
    plan.refresh?.();
  }

  private async evaluateBatch(batch: RequestBatch): Promise<BatchEvaluation> {
    const requestPath = join(this.store.directory, "requests", `${batch.id}.json`);
    const recovered = this.recoverResponse(batch, requestPath);
    const evaluation = recovered ?? (await this.requestEvaluation(batch, requestPath));
    writeJson(requestPath, { payload: batch.payload, ...evaluation });
    return evaluation;
  }

  private recoverResponse(batch: RequestBatch, requestPath: string): BatchEvaluation | undefined {
    if (!existsSync(requestPath)) return undefined;
    const saved = record(readJson(requestPath), "saved request");
    if (!saved.response || fingerprint(saved.payload) !== batch.id) return undefined;
    return {
      response: parseResponse(saved.response, batch.payload),
      evaluatedAt: typeof saved.evaluatedAt === "string" ? saved.evaluatedAt : new Date().toISOString(),
    };
  }

  private async requestEvaluation(batch: RequestBatch, requestPath: string): Promise<BatchEvaluation> {
    const evaluatedAt = new Date().toISOString();
    writeJson(requestPath, { payload: batch.payload, evaluatedAt });
    const response = parseResponse(await this.client.evaluate(batch.payload), batch.payload);
    return { response, evaluatedAt };
  }

  private saveEvaluations(batch: RequestBatch, { response, evaluatedAt }: BatchEvaluation): void {
    const evaluations = batch.items.map((item, index) => {
      const answer = response.answers[`q${index}`];
      if (!answer) throw new Error("Validated answer is missing");
      return {
        version: CACHE_VERSION,
        inputHash: item.inputHash,
        questionHash: item.questionHash,
        targetId: item.target.id,
        questionId: item.question.id,
        answer,
        model: response.model,
        evaluatedAt,
        requestId: batch.id,
      };
    });
    this.store.saveBatch(evaluations);
  }
}
