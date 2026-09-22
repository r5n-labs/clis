import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { Exit } from "@r5n/cli-core";
import { array, object } from "banditypes";
import { readJson } from "../config/loader";
import { textValue } from "../config/validation";
import { CACHE_VERSION, JSON_INDENT } from "../constants";
import type { Evaluation } from "../domain/evaluation";
import type { ReviewItem } from "../domain/review-plan";
import { parseAnswer } from "../providers/jev/schemas";

const HASH_PATTERN = /^[a-f0-9]{64}$/;
const PRIVATE_MODE = 0o600;
const DIRECTORY_MODE = 0o700;

export function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true, mode: DIRECTORY_MODE });
  const temporary = `${path}.${crypto.randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, `${JSON.stringify(value, null, JSON_INDENT)}\n`, { flag: "wx", mode: PRIVATE_MODE });
    renameSync(temporary, path);
  } finally {
    if (existsSync(temporary)) unlinkSync(temporary);
  }
}

export class EvaluationStore {
  private recovered = new Map<string, Evaluation>();
  constructor(readonly directory: string) {}

  find(item: Pick<ReviewItem, "inputHash" | "questionHash" | "question">): Evaluation | undefined {
    const path = this.path(item.inputHash, item.questionHash);
    const pending = this.recovered.get(path);
    if (!existsSync(path) && !pending) return undefined;
    try {
      const value = parseEvaluation(existsSync(path) ? readJson(path) : pending, item.question.criteria);
      if (value.inputHash !== item.inputHash || value.questionHash !== item.questionHash)
        throw new Error("fingerprint");
      return value;
    } catch {
      throw new Exit(`Invalid evaluation cache: ${path}`, "Restore or remove the damaged entry before continuing");
    }
  }

  save(evaluation: Evaluation): void {
    writeJson(this.path(evaluation.inputHash, evaluation.questionHash), evaluation);
  }

  saveBatch(evaluations: Evaluation[]): void {
    if (!evaluations.length) return;
    const path = join(this.directory, "pending", `${crypto.randomUUID()}.json`);
    writeJson(path, evaluations);
    for (const evaluation of evaluations) this.save(evaluation);
    unlinkSync(path);
  }

  recover(): void {
    this.recovered.clear();
    for (const { evaluations } of this.journals()) {
      for (const evaluation of evaluations)
        this.recovered.set(this.path(evaluation.inputHash, evaluation.questionHash), evaluation);
    }
  }

  private *journals(): Generator<{ path: string; evaluations: Evaluation[] }> {
    const directory = join(this.directory, "pending");
    if (!existsSync(directory)) return;
    for (const name of readdirSync(directory)
      .filter((name) => name.endsWith(".json"))
      .sort()) {
      const path = join(directory, name);
      let evaluations: Evaluation[];
      try {
        evaluations = array((value) => parseEvaluation(value))(readJson(path));
        for (const evaluation of evaluations) this.path(evaluation.inputHash, evaluation.questionHash);
      } catch {
        throw new Exit(`Invalid evaluation journal: ${path}`, "Restore or remove the damaged entry before continuing");
      }
      yield { path, evaluations };
    }
  }

  private restorePending(): void {
    for (const { path, evaluations } of this.journals()) {
      for (const evaluation of evaluations) {
        if (!existsSync(this.path(evaluation.inputHash, evaluation.questionHash))) this.save(evaluation);
      }
      unlinkSync(path);
    }
    this.recovered.clear();
  }

  lock(): () => void {
    mkdirSync(this.directory, { recursive: true, mode: DIRECTORY_MODE });
    const path = join(this.directory, "run.lock");
    const owner = JSON.stringify({ pid: process.pid, started: new Date().toISOString(), token: crypto.randomUUID() });
    try {
      writeFileSync(path, owner, { flag: "wx", mode: PRIVATE_MODE });
    } catch {
      throw new Exit(
        `Argus cache is locked: ${path}`,
        "If a previous run was terminated, verify it is no longer running before removing run.lock",
      );
    }
    const release = () => {
      if (existsSync(path) && readFileSync(path, "utf8") === owner) unlinkSync(path);
    };
    try {
      this.restorePending();
    } catch (error) {
      release();
      throw error;
    }
    return release;
  }

  private path(input: string, question: string): string {
    if (!HASH_PATTERN.test(input) || !HASH_PATTERN.test(question)) throw new Exit("Invalid cache fingerprint");
    return join(this.directory, "evaluations", input, `${question}.json`);
  }
}

function parseEvaluation(value: unknown, criteria?: Record<string, string>): Evaluation {
  return object<Evaluation>({
    version: (v) => {
      if (v !== CACHE_VERSION) throw new Error("version");
      return v;
    },
    inputHash: textValue,
    questionHash: textValue,
    targetId: textValue,
    questionId: textValue,
    answer: (v) => parseAnswer(v, criteria),
    model: textValue,
    evaluatedAt: textValue,
    requestId: textValue,
  })(value);
}
