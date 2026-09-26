import { Exit } from "@r5n/cli-core";
import type { ArgusConfig } from "../config/types";
import type { ApiPayload, RequestBatch, ReviewItem, ReviewPlan } from "../domain/review-plan";
import { fingerprint } from "../storage/fingerprints";

type BatchLimits = Pick<ArgusConfig, "maxQuestions" | "maxRequestBytes">;

export class RequestBatcher {
  batches(plan: ReviewPlan, limits: BatchLimits): RequestBatch[] {
    const groups = this.groupPendingQuestions(plan.items);
    return groups.flatMap((items) => this.splitGroup(plan.model, items, limits));
  }

  private groupPendingQuestions(items: ReviewItem[]): ReviewItem[][] {
    const groups = new Map<string, ReviewItem[]>();
    for (const item of items) {
      if (item.evaluation || item.blocked) continue;
      const key = fingerprint(item.context);
      const group = groups.get(key) ?? [];
      if (
        !group.some((existing) => existing.inputHash === item.inputHash && existing.questionHash === item.questionHash)
      )
        group.push(item);
      groups.set(key, group);
    }
    return [...groups.values()];
  }

  private splitGroup(model: string, items: ReviewItem[], limits: BatchLimits): RequestBatch[] {
    const batches: RequestBatch[] = [];
    let current: ReviewItem[] = [];
    for (const item of items) {
      const next = [...current, item];
      if (current.length && this.exceedsLimits(model, next, limits)) {
        batches.push(this.batch(model, current));
        current = [];
      }
      current.push(item);
      if (this.bytes(this.payload(model, current)) > limits.maxRequestBytes)
        throw new Exit(
          `Context too large: ${item.target.path} / ${item.question.id}`,
          "Narrow contextFiles or choose a smaller context mode; Argus never truncates source",
        );
    }
    if (current.length) batches.push(this.batch(model, current));
    return batches;
  }

  private exceedsLimits(model: string, items: ReviewItem[], limits: BatchLimits): boolean {
    return items.length > limits.maxQuestions || this.bytes(this.payload(model, items)) > limits.maxRequestBytes;
  }

  private payload(model: string, items: ReviewItem[]): ApiPayload {
    const first = items[0];
    if (!first) throw new Error("Cannot batch an empty request");
    return {
      model,
      state: first.context,
      questions: Object.fromEntries(items.map((item, index) => [`q${index}`, item.apiQuestion])),
    };
  }

  private batch(model: string, items: ReviewItem[]): RequestBatch {
    const payload = this.payload(model, items);
    return { id: fingerprint(payload), items, payload };
  }

  private bytes(payload: ApiPayload): number {
    return Buffer.byteLength(JSON.stringify(payload));
  }
}
