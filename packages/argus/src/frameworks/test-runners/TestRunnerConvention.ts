import type { TestConvention, TestInvocation, TestRole } from "../../languages/typescript/testing";

const TESTS = new Set(["test", "it"]);
const SUITES = new Set(["describe", "suite"]);
const FIXTURES = new Set(["beforeAll", "beforeEach", "afterEach", "afterAll"]);
const MODIFIERS = new Set(["each", "only", "skip", "todo", "concurrent", "sequential", "fails", "skipIf", "runIf"]);

export class TestRunnerConvention implements TestConvention {
  constructor(private readonly module: "bun:test" | "vitest" | "@jest/globals") {}

  classify(invocation: TestInvocation): TestRole | undefined {
    const globalTestFile =
      invocation.unbound && /(?:\.(?:test|spec)\.[cm]?tsx?$|(?:^|\/)__tests__\/)/.test(invocation.path);
    if (invocation.module !== this.module && !(this.module === "@jest/globals" && globalTestFile)) return undefined;
    if (!invocation.modifiers.every((modifier) => MODIFIERS.has(modifier))) return undefined;
    if (TESTS.has(invocation.name)) return "test";
    if (SUITES.has(invocation.name)) return "suite";
    if (FIXTURES.has(invocation.name)) return "fixture";
    return undefined;
  }
}
