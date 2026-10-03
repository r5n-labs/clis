import type { Result } from "./select-results";

export function ContextEvidence({ item }: { item: Result }) {
  const context = item.contextReview;
  if (!context) return null;
  return (
    <section>
      <h3>Review context</h3>
      <p>
        {context.expanded ? "Expanded review" : "Initial review"}
        {context.note ? `: ${context.note}` : ""}
      </p>
      {context.notes.map((note) => (
        <p key={note}>{note}</p>
      ))}
      {context.unresolved.length > 0 && (
        <details>
          <summary>Static analysis gaps</summary>
          <p>These are limits of the supplied evidence, not confirmed defects or missing documentation.</p>
          {context.unresolved.map((entry) => (
            <div key={entry.path}>
              <strong>{entry.path}</strong>
              <pre>{entry.expressions.join("\n")}</pre>
            </div>
          ))}
        </details>
      )}
    </section>
  );
}
