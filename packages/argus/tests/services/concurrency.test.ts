import { expect, test } from "bun:test";
import type { ApiPayload } from "../../src/domain/review-plan";
import type { ApiResponse } from "../../src/providers/jev/schemas";
import { RequestBatcher } from "../../src/services/RequestBatcher";
import { ReviewRunner } from "../../src/services/ReviewRunner";
import { fixture, response } from "../helpers";

async function concurrentFixture() {
  const f = fixture();
  f.write(
    "example.gd",
    Array.from({ length: 5 }, (_, index) => `func value_${index}():\n    return ${index}\n`).join("\n"),
  );
  const plan = await f.plan();
  const batches = new RequestBatcher().batches(plan, f.loaded.config);
  const pending: { payload: ApiPayload; result: ReturnType<typeof Promise.withResolvers<ApiResponse>> }[] = [];
  const client = {
    evaluate(payload: ApiPayload) {
      const result = Promise.withResolvers<ApiResponse>();
      pending.push({ payload, result });
      return result.promise;
    },
  };
  const complete = (index: number) => {
    const request = pending[index];
    if (!request) throw new Error("Missing pending request");
    request.result.resolve(response(request.payload));
  };
  return { ...f, reviewPlan: plan, batches, pending, client, complete };
}

test("worker pool bounds concurrency and saves out-of-order completions immediately", async () => {
  const f = await concurrentFixture();
  const updates: number[] = [];
  const run = new ReviewRunner(f.store, f.client, 2).run(f.reviewPlan, f.batches, (done) => updates.push(done));
  expect(f.pending).toHaveLength(2);
  f.complete(1);
  await Bun.sleep(0);
  expect(f.pending).toHaveLength(3);
  expect((await f.plan()).items.filter((item) => item.evaluation)).toHaveLength(1);
  f.complete(0);
  f.complete(2);
  await Bun.sleep(0);
  expect(f.pending).toHaveLength(5);
  f.complete(4);
  f.complete(3);
  await run;
  expect(updates).toEqual([1, 2, 3, 4, 5]);
  expect(new RequestBatcher().batches(await f.plan(), f.loaded.config)).toHaveLength(0);
});

test("terminal failure stops dispatch, drains active requests, and preserves successes for resume", async () => {
  const f = await concurrentFixture();
  let finished = false;
  const updates: number[] = [];
  const run = new ReviewRunner(f.store, f.client, 2).run(f.reviewPlan, f.batches, (done) => updates.push(done));
  const outcome = run.catch((error: unknown) => {
    finished = true;
    return error;
  });
  f.pending[0]?.result.reject(new Error("exhausted retries"));
  await Bun.sleep(0);
  expect(finished).toBe(false);
  expect(f.pending).toHaveLength(2);
  f.complete(1);
  expect(await outcome).toEqual(new Error("exhausted retries"));
  expect(updates).toEqual([1]);
  expect(f.pending).toHaveLength(2);
  const resumed = await f.plan();
  expect(resumed.items.filter((item) => item.evaluation)).toHaveLength(1);
  expect(new RequestBatcher().batches(resumed, f.loaded.config)).toHaveLength(4);
});

test("concurrency one retains sequential execution", async () => {
  const f = await concurrentFixture();
  const run = new ReviewRunner(f.store, f.client, 1).run(f.reviewPlan, f.batches);
  for (let index = 0; index < f.batches.length; index++) {
    expect(f.pending).toHaveLength(index + 1);
    f.complete(index);
    await Bun.sleep(0);
  }
  await run;
});
