import { expect, test } from "bun:test";
import { createAnalysis } from "../../src/composition/analysis";
import { ProjectScanner } from "../../src/services/ProjectScanner";
import { fixture } from "../helpers";

test("distinct gettext identities survive scanning with colon-containing contexts and paths", async () => {
  const f = fixture();
  f.write("en.po", 'msgctxt "a"\nmsgid "b:c"\nmsgstr "One"\n\nmsgctxt "a:b"\nmsgid "c"\nmsgstr "Two"\n');
  f.write("prefix.po:part.po", 'msgid "x"\nmsgstr "First"\n');
  f.write("prefix.po", 'msgctxt "part.po"\nmsgid ":x"\nmsgstr "Second"\n');
  const message = 'Say "cześć"';
  f.write("quotes.po", `msgid ${JSON.stringify(message)}\nmsgstr "Greeting"\n`);
  const project = await new ProjectScanner(createAnalysis()).scan(f.loaded);
  const expectedEntries = 5;
  expect(project.targets).toHaveLength(expectedEntries);
  expect(new Set(project.targets.map((target) => target.id)).size).toBe(expectedEntries);
  expect(
    project.targets.filter((target) => target.path === "en.po").map(({ line, endLine }) => ({ line, endLine })),
  ).toEqual([
    { line: 1, endLine: 3 },
    { line: 5, endLine: 7 },
  ]);
  const quoted = project.targets.find((target) => target.path === "quotes.po");
  expect(quoted?.translation).toEqual({ id: message, context: "" });
  f.write("quotes.po", `\n\nmsgid ${JSON.stringify(message)}\nmsgstr "Greeting"\n`);
  const moved = await new ProjectScanner(createAnalysis()).scan(f.loaded);
  expect(moved.targets.find((target) => target.path === "quotes.po")?.id).toBe(quoted?.id);
});
