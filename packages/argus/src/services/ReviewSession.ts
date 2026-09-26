import type { ArgusConfig } from "../config/types";
import type { RequestBatch, ReviewPlan } from "../domain/review-plan";
import { RequestBatcher } from "./RequestBatcher";
import type { ReviewRunner } from "./ReviewRunner";

export const DEFAULT_FOLLOW_UP_LIMIT = 10;
type SessionOptions = { limit: number; followUpLimit: number };

export function selectRequests(batches: RequestBatch[], options: SessionOptions): RequestBatch[] {
  const selected: RequestBatch[] = [];
  let followUps = 0;
  for (const batch of batches) {
    if (options.limit && selected.length >= options.limit) break;
    if (batch.items.some((item) => item.expanded)) {
      if (followUps >= options.followUpLimit) continue;
      followUps++;
    }
    selected.push(batch);
  }
  return selected;
}

export class ReviewSession {
  constructor(private readonly runner: ReviewRunner) {}

  async run(
    plan: ReviewPlan,
    config: ArgusConfig,
    options: SessionOptions,
    progress: (completed: number, total: number) => void,
  ): Promise<void> {
    let completed = 0;
    const batcher = new RequestBatcher();
    const initial = selectRequests(batcher.batches(plan, config), options);
    const initialFollowUps = initial.filter((batch) => batch.items.some((item) => item.expanded)).length;
    const initialTotal = initial.length;
    await this.runner.run(plan, initial, (done) => {
      completed = done;
      progress(completed, initialTotal);
    });
    if (options.limit && completed >= options.limit) return;
    const expanded = selectRequests(
      batcher.batches(plan, config).filter((batch) => batch.items.every((item) => item.expanded)),
      { limit: options.limit ? options.limit - completed : 0, followUpLimit: options.followUpLimit - initialFollowUps },
    );
    const finalTotal = completed + expanded.length;
    progress(completed, finalTotal);
    const offset = completed;
    await this.runner.run(plan, expanded, (done) => {
      completed = offset + done;
      progress(completed, finalTotal);
    });
  }
}
