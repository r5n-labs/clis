import { Exit, select } from "@r5n/cli-core";
import type { ReviewQueue } from "../../domain/review-queue";
import type { ReviewCatalogue } from "../../reports/ReviewCatalogue";

export class ReviewPrompts {
  constructor(private readonly catalogue: ReviewCatalogue) {}

  async candidate(): Promise<string> {
    const items = this.catalogue.candidates();
    if (!items.length)
      throw new Exit("No review candidates in this snapshot", "Run 'argus report create' to refresh it");
    return select({
      message: "Review candidate",
      options: items.map((item) => ({
        value: item.reviewId,
        label: `${item.path}:${item.line} · ${item.target} · ${item.question}`,
        hint: item.evaluation?.answer.choice ?? item.status,
      })),
    });
  }

  async evidence(): Promise<string> {
    const id = await this.candidate();
    const { context } = this.catalogue.show(id);
    if (!context) throw new Exit("No evidence saved for this candidate");
    const fragments = new Map([
      [context.sourceId, { path: context.path, hint: "Evaluated source" }],
      ...context.related.map((entry) => [entry.evidenceId, { path: entry.path, hint: "Related evidence" }] as const),
    ]);
    return select({
      message: "Evidence fragment",
      options: [...fragments].map(([value, { path, hint }]) => ({ value, label: path, hint })),
    });
  }

  async batch(queue?: ReviewQueue): Promise<string> {
    const batches = this.catalogue.batches(queue);
    if (!batches.length)
      throw new Exit("No review batches in this selection", "Run 'argus report create' to refresh it");
    return select({
      message: "Review batch",
      options: batches.map((items, index) => ({
        value: String(index + 1),
        label: `Batch ${index + 1}`,
        hint: `${items.length} candidates`,
      })),
    });
  }
}
