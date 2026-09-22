import { expect, test } from "bun:test";
import type { ApiPayload } from "../../src/domain/review-plan";
import { RequestBatcher } from "../../src/services/RequestBatcher";
import { ReviewRunner } from "../../src/services/ReviewRunner";
import { ReviewSession } from "../../src/services/ReviewSession";
import { fixture, response } from "../helpers";

function prepared() {
  const f = fixture();
  f.write("owner.gd", "func answer():\n    return Counter.value()\n");
  f.write("counter.gd", "class_name Counter\nstatic func value():\n    return 42\n");
  f.loaded.config.questions.methods = f.loaded.config.questions.methods.map((q) => ({ ...q, include: ["owner.gd"] }));
  return f;
}
function insufficient(payload: ApiPayload) {
  const result = response(payload);
  for (const answer of Object.values(result.answers)) {
    answer.choice = "insufficient_context";
    for (const key of Object.keys(answer.probabilities)) answer.probabilities[key] = key === answer.choice ? 1 : 0;
  }
  return result;
}

test("an unresolved local answer gets one expanded request, cached against the exact added evidence", async () => {
  const f = prepared();
  const requests: ApiPayload[] = [];
  const runner = new ReviewRunner(f.store, {
    async evaluate(payload) {
      requests.push(payload);
      return requests.length === 1 ? insufficient(payload) : response(payload);
    },
  });
  const plan = await f.plan();
  const progress: number[] = [];
  await new ReviewSession(runner).run(plan, f.loaded.config, { limit: 0, followUpLimit: 10 }, (count) =>
    progress.push(count),
  );
  expect(requests).toHaveLength(2);
  expect(requests[0]?.state.related).toHaveLength(0);
  expect(requests[1]?.state.related[0]?.source).toContain("return 42");
  expect(plan.items[0]?.expanded).toBe(true);
  expect(plan.items[0]?.evaluation?.answer.choice).toBe("matches");
  expect(progress.at(-1)).toBe(2);
  expect(new RequestBatcher().batches(await f.plan(), f.loaded.config)).toHaveLength(0);
  f.write("counter.gd", "class_name Counter\nstatic func value():\n    return 43\n");
  const changed = await f.plan();
  expect(changed.items[0]?.expanded).toBe(true);
  expect(changed.items[0]?.evaluation).toBeUndefined();
});

test("overall limit includes follow-ups and pending expansion resumes without repeating the initial request", async () => {
  const f = prepared();
  const requests: ApiPayload[] = [];
  const runner = new ReviewRunner(f.store, {
    async evaluate(payload) {
      requests.push(payload);
      return insufficient(payload);
    },
  });
  await new ReviewSession(runner).run(await f.plan(), f.loaded.config, { limit: 1, followUpLimit: 10 }, () => {});
  expect(requests).toHaveLength(1);
  const pending = await f.plan();
  expect(pending.items[0]?.expanded).toBe(true);
  await new ReviewSession(runner).run(pending, f.loaded.config, { limit: 1, followUpLimit: 10 }, () => {});
  expect(requests).toHaveLength(2);
  expect(requests[1]?.state.related[0]?.source).toContain("return 42");
  await new ReviewSession(runner).run(await f.plan(), f.loaded.config, { limit: 0, followUpLimit: 10 }, () => {});
  expect(requests).toHaveLength(2);
});

test("follow-up limit zero disables extra billing while retaining the pending expanded check", async () => {
  const f = prepared();
  let calls = 0;
  const session = new ReviewSession(
    new ReviewRunner(f.store, {
      async evaluate(payload) {
        calls++;
        return insufficient(payload);
      },
    }),
  );
  const plan = await f.plan();
  await session.run(plan, f.loaded.config, { limit: 0, followUpLimit: 0 }, () => {});
  expect(calls).toBe(1);
  expect(plan.items[0]?.expanded).toBe(true);
  expect(plan.items[0]?.evaluation).toBeUndefined();
  await session.run(await f.plan(), f.loaded.config, { limit: 0, followUpLimit: 0 }, () => {});
  expect(calls).toBe(1);
});

test("no additional evidence means no follow-up and an explicit context note", async () => {
  const f = fixture();
  f.write("plain.gd", "func answer():\n    return mystery()\n");
  let calls = 0;
  const plan = await f.plan();
  await new ReviewSession(
    new ReviewRunner(f.store, {
      async evaluate(payload) {
        calls++;
        return insufficient(payload);
      },
    }),
  ).run(plan, f.loaded.config, { limit: 0, followUpLimit: 10 }, () => {});
  expect(calls).toBe(1);
  expect(plan.items[0]?.contextNote).toContain("No additional static evidence");
  expect(plan.items[0]?.evaluation?.answer.choice).toBe("insufficient_context");
});

test("oversized expansion retains the initial answer without billing or truncating it", async () => {
  const f = prepared();
  f.loaded.config.maxRequestBytes = 6000;
  f.write("counter.gd", `class_name Counter\nstatic func value():\n    return "${"x".repeat(9000)}"\n`);
  let calls = 0;
  const plan = await f.plan();
  await new ReviewSession(
    new ReviewRunner(f.store, {
      async evaluate(payload) {
        calls++;
        return insufficient(payload);
      },
    }),
  ).run(plan, f.loaded.config, { limit: 0, followUpLimit: 10 }, () => {});
  expect(calls).toBe(1);
  expect(plan.items[0]?.contextNote).toContain("Expanded context requires");
  expect(plan.items[0]?.evaluation?.answer.choice).toBe("insufficient_context");
});

test("the follow-up cap counts only submitted expanded requests across both phases", async () => {
  const f = prepared();
  f.write(
    "owner.gd",
    "func first():\n    return Counter.value()\nfunc second():\n    return Counter.value()\nfunc third():\n    return Counter.value()\n",
  );
  let calls = 0;
  const session = new ReviewSession(
    new ReviewRunner(f.store, {
      async evaluate(payload) {
        calls++;
        return insufficient(payload);
      },
    }),
  );
  const plan = await f.plan();
  await session.run(plan, f.loaded.config, { limit: 0, followUpLimit: 1 }, () => {});
  expect(calls).toBe(4);
  expect(plan.items.filter((item) => item.expanded && !item.evaluation)).toHaveLength(2);
  await session.run(await f.plan(), f.loaded.config, { limit: 1, followUpLimit: 1 }, () => {});
  expect(calls).toBe(5);
  expect((await f.plan()).items.filter((item) => !item.evaluation)).toHaveLength(1);
});
