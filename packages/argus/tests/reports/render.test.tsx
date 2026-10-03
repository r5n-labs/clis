import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { reportData } from "../../src/reports/report-data";
import { ReportApp } from "../../src/reports/ui/ReportApp";
import { ResultDetails } from "../../src/reports/ui/ResultDetails";
import { PAGE_SIZE } from "../../src/reports/ui/select-results";
import { fixture } from "../helpers";

test("React renders categories, filter controls and a bounded first page", async () => {
  const f = fixture();
  f.write("example.gd", "func value():\n    return 1\n");
  const report = reportData(await f.plan(), 1);
  const item = report.results[0];
  if (!item) throw new Error("Missing result");
  report.results = Array.from({ length: PAGE_SIZE + 1 }, (_, index) => ({
    ...item,
    target: `Example.value_${index}`,
    line: index + 1,
  }));
  report.summary.questions = report.results.length;
  const html = renderToStaticMarkup(<ReportApp report={report} />);
  expect(html).toContain("Naming accuracy");
  expect(html).toContain('aria-label="Check categories"');
  expect(html).toContain('aria-label="Minimum confidence percent"');
  expect(html).toContain('aria-sort="none"');
  expect(html).toContain(`Example.value_${PAGE_SIZE - 1}`);
  expect(html).not.toContain(`Example.value_${PAGE_SIZE}<`);
  expect(html).toContain("Page 1 of 2");
});

test("React renders empty reports and blocked details without implying an evaluation", async () => {
  const f = fixture();
  const report = reportData(await f.plan(), 0);
  expect(renderToStaticMarkup(<ReportApp report={report} />)).toContain("No checks in this report");
  f.write("example.gd", "func value():\n    return 1\n");
  f.loaded.config.maxRequestBytes = 10;
  const blocked = reportData(await f.plan(), 0).results[0];
  if (!blocked) throw new Error("Missing blocked result");
  const html = renderToStaticMarkup(<ResultDetails item={blocked} />);
  expect(html).toContain("This check could not run");
  expect(html).toContain("request limit is 10");
  expect(html).not.toContain("Answer distribution");
});
