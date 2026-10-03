import type { ChangeEvent } from "react";
import { useCallback, useId, useMemo, useState } from "react";
import type { ReviewContext } from "../../domain/review-plan";
import type { Result } from "./select-results";
import { sourceViews } from "./source-files";
import { highlightSource } from "./syntax/highlight";

export function EvaluatedSource({ item, context }: { item: Result; context?: ReviewContext }) {
  const selectId = useId();
  const [selected, setSelected] = useState(item.group === "changes" ? "after" : "primary");
  const selectSource = useCallback(
    (event: ChangeEvent<HTMLSelectElement>) => setSelected(event.currentTarget.value),
    [],
  );
  const views = useMemo(() => (context ? sourceViews(context, item.group) : []), [context, item.group]);
  const view = views.find((entry) => entry.id === selected) ?? views[0];
  const highlighted = useMemo(() => (view ? highlightSource(view.source, view.language) : undefined), [view]);
  return (
    <section className="evaluated-source">
      <h3>{item.evaluation ? "Evaluated source" : "Planned source · not evaluated"}</h3>
      {!view ? (
        <p>Source was not embedded in this report. Regenerate it to include the review context.</p>
      ) : (
        <>
          <p>
            {item.evaluation
              ? "Exact source and supporting context supplied for this evaluation."
              : "Context prepared for this check; it has not been evaluated."}
          </p>
          <div className="source-viewer">
            <div className="source-toolbar">
              <label htmlFor={selectId}>Source</label>
              <select id={selectId} onChange={selectSource} value={view.id}>
                {views.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.label}
                  </option>
                ))}
              </select>
              <span className="source-language">{view.language}</span>
            </div>
            <pre className="source-code">
              <code>{highlighted}</code>
            </pre>
          </div>
        </>
      )}
    </section>
  );
}
