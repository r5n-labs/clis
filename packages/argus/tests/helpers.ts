import { afterEach } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createAnalysis } from "../src/composition/analysis";
import type { LoadedConfig } from "../src/config/types";
import type { ApiPayload } from "../src/domain/review-plan";
import { defaultConfig } from "../src/presets";
import type { ApiResponse } from "../src/providers/jev/schemas";
import { ProjectScanner } from "../src/services/ProjectScanner";
import { ReviewPlanner } from "../src/services/ReviewPlanner";
import { EvaluationStore } from "../src/storage/EvaluationStore";

const directories: string[] = [];
const CLI = resolve(import.meta.dir, "../src/cli.ts");

export async function cli(cwd: string, args: string[]) {
  const child = Bun.spawn(["bun", CLI, ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...Bun.env, TYPESAFE_API_KEY: "" },
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { stdout, stderr, code };
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

export function fixture(preset: "naming" | "all" = "naming") {
  const directory = mkdtempSync(join(tmpdir(), "argus-test-"));
  directories.push(directory);
  const root = join(directory, "project");
  mkdirSync(root);
  const loaded: LoadedConfig = {
    root,
    stateDir: join(directory, "state"),
    path: join(directory, "state", "config.json"),
    config: defaultConfig(root, preset),
  };
  const store = new EvaluationStore(join(loaded.stateDir, "cache"));
  return {
    directory,
    loaded,
    store,
    write(path: string, source: string) {
      const file = join(root, path);
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, source);
    },
    async plan() {
      return new ReviewPlanner(store).plan(await new ProjectScanner(createAnalysis()).scan(loaded), loaded.config);
    },
  };
}

export function response(payload: ApiPayload): ApiResponse {
  return {
    model: payload.model,
    answers: Object.fromEntries(
      Object.entries(payload.questions).map(([key, question]) => {
        const choices = Object.keys(question.criteria);
        const choice = choices[0];
        if (!choice) throw new Error("Expected choices");
        return [
          key,
          {
            type: "choice",
            choice,
            confidence: 1,
            probabilities: Object.fromEntries(choices.map((option) => [option, option === choice ? 1 : 0])),
          },
        ];
      }),
    ),
    usage: { input_tokens: 100, output_tokens: 10 },
  };
}
