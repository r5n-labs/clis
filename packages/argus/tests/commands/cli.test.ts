import { expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, realpathSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ReportCommand } from "../../src/commands/report";
import { createAnalysis } from "../../src/composition/analysis";
import { parseConfig, parseQuestion } from "../../src/config/validation";
import { collectChanges } from "../../src/contexts/ChangeContextBuilder";
import { ContextBuilder } from "../../src/contexts/ContextBuilder";
import { JevClient } from "../../src/providers/jev/JevClient";
import { parseResponse } from "../../src/providers/jev/schemas";
import { htmlReport } from "../../src/reports/html";
import { reportData } from "../../src/reports/report-data";
import { ProjectScanner } from "../../src/services/ProjectScanner";
import { RequestBatcher } from "../../src/services/RequestBatcher";
import { cli, fixture, response } from "../helpers";

test("report only groups subcommands and shows help without loading a project or creating a snapshot", async () => {
  const group = new ReportCommand();
  group.init();
  expect(group.execute).toBeUndefined();
  expect(group.args).toEqual({});
  expect(group.getSubcommand("create")?.execute).toBeDefined();
  const f = fixture();
  const result = await cli(f.loaded.root, ["report"]);
  expect(result.code).toBe(0);
  expect(result.stdout).toContain("Create and inspect review snapshots");
  expect(result.stdout).toContain("create");
  expect(result.stdout).toContain("list");
  expect(result.stdout).not.toContain("Verdict template:");
  expect(existsSync(join(f.loaded.root, ".argus"))).toBe(false);
});

test.each([
  ["--concurrency", "0"],
  ["--concurrency", "33"],
  ["--concurrency", "1.5"],
  ["--retries", "-1"],
  ["--retries", "11"],
  ["--retries", "1.5"],
])("run rejects invalid %s %s before loading a project", async (flag, value) => {
  const f = fixture();
  const result = await cli(f.loaded.root, ["run", `${flag}=${value}`]);
  expect(result.code).toBe(1);
  expect(result.stdout + result.stderr).toContain(`${flag} must be an integer`);
  expect(existsSync(f.store.directory)).toBe(false);
});

test("CLI initialises external config, previews JSON without writes, rejects typos and never overwrites", async () => {
  const f = fixture();
  f.write("example.gd", "func value():\n    return 1\n");
  const init = await cli(f.directory, ["init", "--root", f.loaded.root, "--config", f.loaded.path]);
  expect(init.code).toBe(0);
  const original = readFileSync(f.loaded.path, "utf8");
  expect((await cli(f.directory, ["init", "--config", f.loaded.path])).code).toBe(1);
  expect(readFileSync(f.loaded.path, "utf8")).toBe(original);
  const preview = await cli(f.directory, ["check", "--config", f.loaded.path, "--json"]);
  expect(preview.code).toBe(0);
  expect(JSON.parse(preview.stdout).summary.pending).toBe(1);
  expect(existsSync(f.store.directory)).toBe(false);
  expect(existsSync(join(f.loaded.root, ".argus"))).toBe(false);
  expect((await cli(f.directory, ["run", "--config", f.loaded.path, "--limti", "1"])).code).toBe(1);
  expect((await cli(f.directory, ["run", "--config", f.loaded.path])).code).toBe(1);
  expect(existsSync(join(f.store.directory, "run.lock"))).toBe(false);
});

test.each([false, true])("bare --html creates a report beside the config (external: %s)", async (external) => {
  const f = fixture();
  f.write("example.gd", "func value():\n    return 1\n");
  const configArgs = external ? ["--config", f.loaded.path] : [];
  expect((await cli(f.loaded.root, ["init", "--root", f.loaded.root, ...configArgs])).code).toBe(0);
  const reports = join(external ? f.loaded.stateDir : join(f.loaded.root, ".argus"), "reports");
  expect((await cli(f.loaded.root, ["report", "create", ...configArgs])).code).toBe(0);
  expect(existsSync(reports)).toBe(false);
  const conflict = await cli(f.loaded.root, ["report", "create", ...configArgs, "--html", "--json"]);
  expect(conflict.code).toBe(1);
  expect(conflict.stdout + conflict.stderr).toContain("Choose either --json or --html");
  expect(existsSync(reports)).toBe(false);
  const result = await cli(f.loaded.root, ["report", "create", ...configArgs, "--html"]);
  expect(result.code).toBe(0);
  const files = readdirSync(reports);
  expect(files).toHaveLength(1);
  const filename = files[0];
  if (!filename) throw new Error("Missing HTML report");
  expect(filename).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.\d{3}Z\.html$/);
  const path = join(reports, filename);
  expect(realpathSync(result.stdout.trim().replace(/^Report: /, ""))).toBe(realpathSync(path));
  expect(readFileSync(path, "utf8")).toContain('<script id="argus-report-data"');
});

test("--html creates explicit parent directories and preserves existing reports", async () => {
  const f = fixture();
  expect((await cli(f.loaded.root, ["init"])).code).toBe(0);
  const relativePath = ".argus/reports/full.html";
  const result = await cli(f.loaded.root, ["report", "create", "--html", relativePath]);
  expect(result.code).toBe(0);
  const path = join(f.loaded.root, relativePath);
  expect(realpathSync(result.stdout.trim().replace(/^Report: /, ""))).toBe(realpathSync(path));
  const original = readFileSync(path, "utf8");
  expect(original).toContain("<!doctype html>");
  expect((await cli(f.loaded.root, ["report", "create", "--html", relativePath])).code).toBe(1);
  expect(readFileSync(path, "utf8")).toBe(original);
});

test("closed configuration rejects unknown fields, malformed choices, duplicate questions and invalid confidence or context", () => {
  expect(() => parseConfig({ version: 1, root: ".", questions: {}, unexpected: true })).toThrow("Unknown");
  expect(() => parseQuestion({ id: "a", type: "choice", instructions: "Ask", criteria: { a: "One" } })).toThrow(
    "two choices",
  );
  expect(() =>
    parseQuestion({ id: "a", type: "choice", instructions: "Ask", criteria: { a: "One", b: "Two" }, minConfidence: 2 }),
  ).toThrow("probability");
  const f = fixture();
  const naming = f.loaded.config.questions.methods[0];
  if (!naming) throw new Error("Missing naming question");
  expect(() => parseConfig({ ...f.loaded.config, questions: { methods: [naming, naming] } })).toThrow("Duplicate");
  expect(() =>
    parseConfig({ ...f.loaded.config, questions: { classes: [{ ...naming, context: "unknown" }] } }),
  ).toThrow("Unknown context mode");
});

test("Jev client sends the expected HTTP request and validates the response at the transport boundary", async () => {
  const f = fixture();
  f.write("example.gd", "func value():\n    return 1\n");
  const plan = await f.plan();
  const batch = new RequestBatcher().batches(plan, f.loaded.config)[0];
  if (!batch) throw new Error("Missing request");
  let received = false;
  const transport = (async (input: string | URL | Request, init?: RequestInit) => {
    const request = new Request(input, init);
    expect(request.url).toBe("https://api.typesafe.ai/v1/systemone");
    expect(request.redirect).toBe("error");
    expect(request.headers.get("authorization")).toBe("Bearer test-key");
    expect(await request.json()).toEqual(batch.payload);
    received = true;
    return Response.json(response(batch.payload));
  }) as typeof fetch;
  const result = await new JevClient("test-key", transport).evaluate(batch.payload);
  expect(result.usage.input_tokens).toBe(100);
  expect(received).toBe(true);
  const bad = response(batch.payload);
  bad.answers = {};
  expect(() => parseResponse(bad, batch.payload)).toThrow("question IDs");
  const invalid = response(batch.payload);
  const answer = invalid.answers.q0;
  if (!answer) throw new Error("Missing answer");
  answer.confidence = Number.NaN;
  expect(() => parseResponse(invalid, batch.payload)).toThrow("probability");
});

test("HTML escapes reviewed text and oversized checks remain visibly unreviewed", async () => {
  const f = fixture();
  f.write("example.gd", "func value():\n    return 1\n");
  f.loaded.config.maxRequestBytes = 10;
  const plan = await f.plan();
  const report = reportData(plan, new RequestBatcher().batches(plan, f.loaded.config).length);
  expect(report.summary.blocked).toBe(1);
  expect(report.summary.checked).toBe(0);
  expect(report.summary.requests).toBe(0);
  const row = report.results[0];
  if (!row) throw new Error("Missing result");
  row.target = '<script>alert("bad")</script>';
  const html = await htmlReport(report);
  expect(html).not.toContain('<script>alert("bad")</script>');
  expect(html).toContain("\\u003cscript\\u003e");
});

test("change review handles modified, new and deleted paths relative to a project subdirectory", async () => {
  const f = fixture("all");
  const git = (...args: string[]) => {
    const result = Bun.spawnSync(["git", ...args], {
      cwd: f.directory,
      env: { ...Bun.env, GIT_CONFIG_NOSYSTEM: "1" },
      stdout: "pipe",
      stderr: "pipe",
    });
    if (result.exitCode !== 0) throw new Error(result.stderr.toString());
  };
  git("init", "--quiet");
  f.write("old.gd", "func value():\n    return 1\n");
  f.write("deleted.gd", "func removed():\n    pass\n");
  f.write("caller.gd", "func amount():\n    return Cost.value()\n");
  f.write("cost.gd", "class_name Cost\nstatic func value():\n    return 10\n");
  git("add", "project");
  git(
    "-c",
    "user.name=Argus Test",
    "-c",
    "user.email=argus@example.invalid",
    "-c",
    "commit.gpgsign=false",
    "commit",
    "--quiet",
    "-m",
    "fixture",
  );
  git("rm", "project/deleted.gd");
  f.write("old.gd", "func value():\n    return 2\n");
  f.write("caller.gd", "func amount():\n    return Cost.value() + 1\n");
  f.write("cost.gd", "class_name Cost\nstatic func value():\n    return 20\n");
  f.write("new [file].gd", "func added():\n    pass\n");
  writeFileSync(join(f.directory, "outside.gd"), "func outside(): pass\n");
  const project = await new ProjectScanner(createAnalysis()).scan(f.loaded);
  const changes = await collectChanges(f.loaded, project, "HEAD");
  expect(changes.map((item) => item.path)).toEqual(["caller.gd", "cost.gd", "deleted.gd", "new [file].gd", "old.gd"]);
  const changed = changes.find((item) => item.path === "old.gd");
  const parsed = JSON.parse(changed?.source ?? "{}");
  expect(parsed.before).toContain("return 1");
  expect(parsed.after).toContain("return 2");
  expect(parsed.diff).toContain("-    return 1");
  const caller = changes.find((item) => item.path === "caller.gd");
  const question = f.loaded.config.questions.changes[0];
  if (!caller || !question) throw new Error("Missing change fixture");
  const context = new ContextBuilder(project).build(caller, question);
  expect(context.related.find((entry) => entry.path === "before:cost.gd")?.source).toContain("return 10");
  expect(context.related.find((entry) => entry.path === "after:cost.gd")?.source).toContain("return 20");
});

test.each(["excluded", "excluded/", "excluded/**"])(
  "change reviews respect directory exclusion %s",
  async (exclude) => {
    const f = fixture();
    f.loaded.config.exclude.push(exclude);
    const git = (...args: string[]) => {
      const result = Bun.spawnSync(["git", ...args], { cwd: f.loaded.root, stdout: "pipe", stderr: "pipe" });
      if (result.exitCode) throw new Error(result.stderr.toString());
    };
    git("init", "--quiet");
    f.write("public.gd", "func value():\n    return 1\n");
    f.write("excluded/modified.gd", "func value():\n    return 1\n");
    f.write("excluded/deleted.gd", "func value():\n    return 1\n");
    git("add", ".");
    git(
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@example.invalid",
      "-c",
      "commit.gpgsign=false",
      "commit",
      "--quiet",
      "--allow-empty",
      "-m",
      "baseline",
    );
    f.write("excluded/internal.gd", 'func value():\n    return "DO_NOT_REVIEW"\n');
    f.write("excluded/modified.gd", "func value():\n    return 2\n");
    unlinkSync(join(f.loaded.root, "excluded/deleted.gd"));
    f.write("public.gd", "func value():\n    return 2\n");
    const question = f.loaded.config.questions.methods[0];
    if (!question) throw new Error("Missing question");
    question.contextFiles = ["excluded/**"];
    const project = await new ProjectScanner(createAnalysis()).scan(f.loaded);
    expect([...project.files.keys()]).toEqual(["public.gd"]);
    const changes = await collectChanges(f.loaded, project, "HEAD");
    expect(changes.map((target) => target.path)).toEqual(["public.gd"]);
    expect([...(changes[0]?.changeContext?.before.files.keys() ?? [])]).toEqual(["public.gd"]);
  },
);
