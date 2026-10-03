import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { ApiPayload, ReviewContext } from "../../src/domain/review-plan";
import { htmlReport } from "../../src/reports/html";
import { reportData } from "../../src/reports/report-data";
import { ResultDetails } from "../../src/reports/ui/ResultDetails";
import { sourceViews } from "../../src/reports/ui/source-files";
import { highlightSource, sourceLanguage } from "../../src/reports/ui/syntax/highlight";
import { RequestBatcher } from "../../src/services/RequestBatcher";
import { ReviewRunner } from "../../src/services/ReviewRunner";
import { fixture, response } from "../helpers";

function textContent(html: string): string {
  const entities: Record<string, string> = { "&lt;": "<", "&gt;": ">", "&amp;": "&", "&quot;": '"', "&#x27;": "'" };
  return html.replace(/<[^>]+>/g, "").replace(/&(lt|gt|amp|quot|#x27);/g, (entity) => entities[entity] ?? entity);
}

test.each([
  ["script.gd", '## Żółć\nfunc greet(name: String):\n\treturn "<script> & " + name\n'],
  ["translations.po", '# Polish\nmsgid "Hello %s"\nmsgstr "Cześć %s"\n'],
  ["config.json", '{"name": "<img src=x onerror=alert(1)>", "value": 42}'],
  ["app.tsx", 'export const App = () => <div title="sample">Hello</div>;'],
  ["data.tres", '[gd_resource type="Resource" format=3]\n[resource]\nvalue = 42\n'],
  ["example.py", 'def greet(name):\n    return "Hello " + name\n'],
  ["example.php", '<?php echo "Hello " . $name; ?>'],
  ["file.unknown", '</code><script>alert("x")</script>\n	&lt;'],
])("highlighting preserves the exact text of %s and never interprets it as HTML", (path, source) => {
  const html = renderToStaticMarkup(<code>{highlightSource(source, sourceLanguage(path))}</code>);
  expect(textContent(html)).toBe(source);
  expect(html).not.toContain("<script>");
  expect(html).not.toContain("<img");
  if (!path.endsWith(".unknown")) expect(html).toContain('class="token ');
});

test("diff tokens retain Prism aliases for insertion and deletion colours", () => {
  const html = renderToStaticMarkup(<code>{highlightSource("-old\n+new\n", "diff")}</code>);
  expect(html).toContain("deleted-sign deleted");
  expect(html).toContain("inserted-sign inserted");
});

test("reports embed the evaluated request context once for questions sharing it and preserve existing detail sections", async () => {
  const f = fixture();
  f.write("example.gd", "func value():\n    return Counter.value()\n");
  f.write("counter.gd", 'class_name Counter\nstatic func value():\n    return "<script>Żółć</script>"\n');
  const question = f.loaded.config.questions.methods[0];
  if (!question) throw new Error("Missing question");
  question.context = "references";
  question.include = ["example.gd"];
  f.loaded.config.questions.methods.push({ ...question, id: "second", instructions: "Another question" });
  const requests: ApiPayload[] = [];
  const plan = await f.plan();
  await new ReviewRunner(f.store, {
    async evaluate(payload) {
      requests.push(structuredClone(payload));
      return response(payload);
    },
  }).run(plan, new RequestBatcher().batches(plan, f.loaded.config));
  const report = reportData(plan, 0);
  const row = report.results[0];
  if (!row) throw new Error("Missing report row");
  const context = report.contexts[row.contextId];
  expect(requests).toHaveLength(1);
  expect(Object.keys(report.contexts)).toHaveLength(1);
  expect(context).toEqual(requests[0]?.state);
  expect(report.results[1]?.contextId).toBe(row.contextId);
  const html = renderToStaticMarkup(<ResultDetails context={context} item={row} />);
  for (const title of ["Review context", "Answer distribution", "Evaluation", "Cache fingerprints", "Evaluated source"])
    expect(html).toContain(title);
  expect(html).toContain("Supporting · counter.gd");
  expect(html).toContain('class="token keyword"');
  const document = await htmlReport(report);
  const embedded = /id="argus-report-data" type="application\/json">([\s\S]*?)<\/script>/.exec(document)?.[1];
  expect(JSON.parse(embedded ?? "null").contexts[row.contextId]).toEqual(requests[0]?.state);
  expect(document).not.toContain("<script>Żółć</script>");
  if (plan.items[0]) plan.items[0].context.source = "changed after snapshot";
  expect(context).toEqual(requests[0]?.state);
  f.write("example.gd", 'func value():\n    return "new source"\n');
  const current = reportData(await f.plan(), 1);
  const pending = current.results[0];
  if (!pending) throw new Error("Missing pending row");
  expect(pending.status).toBe("pending");
  const pendingHtml = renderToStaticMarkup(
    <ResultDetails context={current.contexts[pending.contextId]} item={pending} />,
  );
  expect(pendingHtml).toContain("Planned source · not evaluated");
  expect(pendingHtml).not.toContain("Answer distribution");
  expect(pendingHtml).not.toContain("Exact source and supporting context supplied for this evaluation.");
});

test("translation views retain complete entries, partner catalogues and the full context", () => {
  const context: ReviewContext = {
    language: "Godot project data",
    path: "pl.po",
    source: 'msgid "effect.name"\nmsgstr "Osłona"\n',
    related: [{ path: "en.po", source: 'msgid "effect.name"\nmsgstr "Guarded"\n' }],
    notes: ["A translator note"],
  };
  const views = sourceViews(context, "translations");
  expect(views[0]?.language).toBe("gettext");
  expect(views[0]?.source).toBe(context.source);
  expect(views.find((view) => view.id === "related:en.po")?.source).toBe(context.related[0]?.source);
  expect(JSON.parse(views.find((view) => view.id === "context")?.source ?? "null")).toEqual(context);
});

test("change views expose exact before, after and diff strings without losing the original JSON", () => {
  const change = {
    base: "abc",
    before: "func value():\n    return 1\n",
    after: "func value():\n    return 2\n",
    diff: "-    return 1\n+    return 2\n",
  };
  const context: ReviewContext = {
    language: "GDScript",
    path: "script.gd",
    source: JSON.stringify(change),
    related: [{ path: "before:dependency.gd", source: "pass" }],
  };
  const views = sourceViews(context, "changes");
  expect(views[0]?.source).toBe(context.source);
  expect(views.find((view) => view.id === "before")?.source).toBe(change.before);
  expect(views.find((view) => view.id === "after")?.source).toBe(change.after);
  expect(views.find((view) => view.id === "diff")?.source).toBe(change.diff);
  expect(views.find((view) => view.id === "related:before:dependency.gd")?.language).toBe("gdscript");
});
