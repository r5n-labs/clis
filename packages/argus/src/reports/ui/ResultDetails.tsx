import type { ReviewContext } from "../../domain/review-plan";
import type { Report } from "../report-data";
import { ContextEvidence } from "./ContextEvidence";
import { CopyReview } from "./CopyReview";
import { EvaluatedSource } from "./EvaluatedSource";
import type { Result } from "./select-results";
import { confidence, label } from "./select-results";

export function ResultDetails({ item, context, report }: { item: Result; context?: ReviewContext; report?: Report }) {
  const evaluation = item.evaluation;
  if (!evaluation)
    return (
      <div className="result-details">
        {!!report && <CopyReview report={report} results={[item]} />}
        <h3>{item.status === "blocked" ? "This check could not run" : "Waiting for evaluation"}</h3>
        <p>
          {item.reason ??
            "There is no cached answer for this source and question. Run Argus to evaluate pending checks."}
        </p>
        <ContextEvidence item={item} />
        <EvaluatedSource context={context} item={item} />
      </div>
    );
  return (
    <div className="result-details">
      {!!report && (
        <section className="review-question">
          <CopyReview report={report} results={[item]} />
          <h3>Review question</h3>
          <p>{item.instructions}</p>
          <dl>
            {Object.entries(report.questions[item.definitionId]?.criteria ?? {}).map(([choice, description]) => (
              <div key={choice}>
                <dt>{label(choice)}</dt>
                <dd>{description}</dd>
              </div>
            ))}
          </dl>
          <p>
            {item.selectionReason ?? "Not selected as a candidate"} · Concern probability:{" "}
            {confidence(item.concernProbability)}
          </p>
          {!!item.verification && (
            <p>
              Verified: {label(item.verification.verdict)} — {item.verification.rationale} (
              {item.verification.reviewer.model}, {item.verification.reviewer.promptVersion})
            </p>
          )}
        </section>
      )}
      <ContextEvidence item={item} />
      <section>
        <h3>Answer distribution</h3>
        <div className="probabilities">
          {Object.entries(evaluation.answer.probabilities)
            .sort(([, a], [, b]) => b - a)
            .map(([choice, value]) => (
              <div className="probability" key={choice}>
                <span>{label(choice)}</span>
                <progress aria-label={`${label(choice)} probability`} max={1} value={value} />
                <strong>{confidence(value)}</strong>
              </div>
            ))}
        </div>
        <p className="detail-note">
          Jev returns classifications and probabilities. This answer does not include a written explanation.
        </p>
      </section>
      <section>
        <h3>Evaluation</h3>
        <dl>
          <div>
            <dt>Model</dt>
            <dd>{evaluation.model}</dd>
          </div>
          <div>
            <dt>Evaluated</dt>
            <dd>{new Date(evaluation.evaluatedAt).toLocaleString()}</dd>
          </div>
          <div>
            <dt>Question</dt>
            <dd>
              <code>{item.question}</code>
            </dd>
          </div>
        </dl>
        <details className="provenance">
          <summary>Cache fingerprints</summary>
          <dl>
            <div>
              <dt>Input</dt>
              <dd>
                <code>{item.inputHash}</code>
              </dd>
            </div>
            <div>
              <dt>Question</dt>
              <dd>
                <code>{item.questionHash}</code>
              </dd>
            </div>
            <div>
              <dt>Request</dt>
              <dd>
                <code>{evaluation.requestId}</code>
              </dd>
            </div>
          </dl>
        </details>
      </section>
      <EvaluatedSource context={context} item={item} />
    </div>
  );
}
