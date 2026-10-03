export type TestRole = "test" | "suite" | "fixture";
export type TestInvocation = {
  path: string;
  name: string;
  module?: string;
  modifiers: readonly string[];
  unbound: boolean;
};

export interface TestConvention {
  classify(invocation: TestInvocation): TestRole | undefined;
}
