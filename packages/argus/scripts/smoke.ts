import assert from "node:assert/strict";
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const EXECUTABLE_MODE = 0o755;
const EXPECTED_FILES = 5;
const directory = mkdtempSync(join(tmpdir(), "argus-bundle-smoke-"));
const root = join(directory, "project");
const configPath = join(directory, "reviewer's state", "config.json");
const artifact = join(directory, "argus");
const htmlPath = join(directory, "report.html");

async function command(args: string[]): Promise<string> {
  const child = Bun.spawn([artifact, ...args], {
    cwd: root,
    env: { PATH: process.env.PATH ?? "", TYPESAFE_API_KEY: "" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  assert.equal(code, 0, `${args.join(" ")} failed:\n${stdout}\n${stderr}`);
  return stdout;
}

try {
  mkdirSync(root);
  copyFileSync(resolve(import.meta.dir, "../dist/cli.js"), artifact);
  chmodSync(artifact, EXECUTABLE_MODE);
  const fixtures = {
    "types.ts": 'export type * from "./widget";\nexport type Value = import("./widget").Props[];\n',
    "widget.tsx": "export interface Props { title: string }\nexport const Widget = () => <div>Ready</div>;\n",
    "player.gd": "extends Node\nclass_name Player\nfunc score() -> int:\n\treturn 7\n",
    "settings.tres": '[gd_resource type="Resource" format=3]\n\n[resource]\nresource_name = &"Example"\n',
    "messages.po":
      'msgid ""\nmsgstr ""\n"Content-Type: text/plain; charset=UTF-8\\n"\n\nmsgid "Ready"\nmsgstr "Ready"\n',
  };
  for (const [name, source] of Object.entries(fixtures)) writeFileSync(join(root, name), source);
  assert.match(await command(["--version"]), /\d+\.\d+\.\d+/);
  assert.match(await command(["--help"]), /Argus/i);
  await command(["init", "--root", root, "--config", configPath, "--preset", "all"]);
  const config = JSON.parse(readFileSync(configPath, "utf8"));
  config.questions.changes = [];
  writeFileSync(configPath, JSON.stringify(config));
  const report = JSON.parse(await command(["check", "--config", configPath, "--json"]));
  assert.equal(report.summary.files, EXPECTED_FILES);
  assert.equal(report.summary.checked, 0);
  assert.ok(report.summary.pending > 0);
  assert.deepEqual(
    new Set(report.results.map((item: { group: string }) => item.group)),
    new Set(["methods", "classes", "translations"]),
  );
  await command(["report", "create", "--config", configPath, "--html", htmlPath]);
  const html = readFileSync(htmlPath, "utf8");
  assert.match(html, /id="argus-report-data"/);
  assert.match(html, /id="root"/);
  assert.match(html, /default-src 'none'/);
  assert.doesNotMatch(html, /<script[^>]+src=|<link[^>]+href=/);
  console.log(`Copied Argus executable passed: ${EXPECTED_FILES} files, all parser adapters and embedded HTML.`);
} finally {
  rmSync(directory, { recursive: true, force: true });
}
