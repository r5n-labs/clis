import { type ChangeEvent, type FocusEvent, useCallback, useState } from "react";
import { llmParts } from "../llm";
import type { Report } from "../report-data";

export function CopyReview({
  report,
  results,
  label = "Copy for LLM",
}: {
  report: Report;
  results?: Report["results"];
  label?: string;
}) {
  const [parts, setParts] = useState<string[]>([]);
  const [part, setPart] = useState(0);
  const [message, setMessage] = useState("");
  const text = parts[part] ?? "";
  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text);
      setMessage("Copied");
    } catch {
      setMessage("Select the text below and copy it. Clipboard access is unavailable in this browser.");
    }
  }, [text]);
  const open = useCallback(() => {
    setParts(llmParts(report, results));
    setPart(0);
    setMessage("");
  }, [report, results]);
  const close = useCallback(() => setParts([]), []);
  const selectPart = useCallback((event: ChangeEvent<HTMLSelectElement>) => {
    setPart(Number(event.target.value));
    setMessage("");
  }, []);
  const selectText = useCallback((event: FocusEvent<HTMLTextAreaElement>) => event.currentTarget.select(), []);
  return (
    <div className="llm-export">
      <button className="reset-button" onClick={open} type="button">
        {label}
      </button>
      {parts.length > 0 && (
        <section aria-label="LLM review handoff" className="llm-dialog">
          <div className="llm-toolbar">
            <strong>LLM review handoff</strong>
            <label>
              Part{" "}
              <select onChange={selectPart} value={part}>
                {parts.map((content, index) => (
                  <option key={content} value={index}>
                    {index + 1} / {parts.length}
                  </option>
                ))}
              </select>
            </label>
            <button className="reset-button" onClick={copy} type="button">
              Copy this part
            </button>
            <button className="reset-button" onClick={close} type="button">
              Close
            </button>
          </div>
          <p role="status">{message || "Paste into your coding agent. Source, questions and evidence are included."}</p>
          <textarea aria-label="Copyable LLM report" onFocus={selectText} readOnly value={text} />
        </section>
      )}
    </div>
  );
}
