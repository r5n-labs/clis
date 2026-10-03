import { object, string } from "banditypes";
import type { ReviewContext } from "../../domain/review-plan";
import { sourceLanguage } from "./syntax/highlight";

export type SourceView = { id: string; label: string; source: string; language: string };
const changeSource = object<{ before: string; after: string; diff: string }>({
  before: string(),
  after: string(),
  diff: string(),
});
const JSON_INDENT = 2;

export function sourceViews(context: ReviewContext, group: string): SourceView[] {
  const views: SourceView[] = [
    {
      id: "primary",
      label: `Primary · ${context.path}`,
      source: context.source,
      language: group === "changes" ? "json" : sourceLanguage(context.path),
    },
  ];
  if (group === "changes") {
    try {
      const change = changeSource(JSON.parse(context.source));
      views.push(
        {
          id: "before",
          label: `Before · ${context.path}`,
          source: change.before,
          language: sourceLanguage(context.path),
        },
        { id: "after", label: `After · ${context.path}`, source: change.after, language: sourceLanguage(context.path) },
        { id: "diff", label: "Diff", source: change.diff, language: "diff" },
      );
    } catch {
      return withSupportingFiles(views, context);
    }
  }
  return withSupportingFiles(views, context);
}

function withSupportingFiles(views: SourceView[], context: ReviewContext): SourceView[] {
  return [
    ...views,
    ...context.related.map(
      (entry): SourceView => ({
        id: `related:${entry.path}`,
        label: `Supporting · ${entry.path}`,
        source: entry.source,
        language: sourceLanguage(entry.path),
      }),
    ),
    {
      id: "context",
      label: "Full review context · JSON",
      source: JSON.stringify(context, null, JSON_INDENT),
      language: "json",
    },
  ];
}
