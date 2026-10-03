import { expect, test } from "bun:test";
import { parseQuestion } from "../../src/config/validation";
import { RequestScheduler } from "../../src/providers/RequestScheduler";
import type { RetryNotice } from "../../src/providers/retries";
import { TypeSafeClient } from "../../src/providers/typesafe/TypeSafeClient";
import { RequestBatcher } from "../../src/services/RequestBatcher";
import { ReviewRunner } from "../../src/services/ReviewRunner";
import { fixture, response } from "../helpers";

function scheduler() {
  let now = 0;
  const waits: number[] = [];
  return {
    waits,
    clock: new RequestScheduler({
      now: () => now,
      async sleep(milliseconds) {
        waits.push(milliseconds);
        now += milliseconds;
      },
    }),
  };
}

async function requestFixture() {
  const f = fixture();
  f.write("example.gd", "func value():\n    return 1\n");
  const plan = await f.plan();
  const batches = new RequestBatcher().batches(plan, f.loaded.config);
  const batch = batches[0];
  if (!batch) throw new Error("Missing request");
  return { ...f, reviewPlan: plan, batches, payload: batch.payload };
}

test.each([
  "json",
  "answers",
  "constructor",
  "toString",
  "__proto__",
  "network",
  "timeout",
  408,
  429,
  500,
  502,
  503,
  504,
  520,
  529,
])("retries %s and saves only the valid response", async (failure) => {
  const f = await requestFixture();
  const time = scheduler();
  const notices: RetryNotice[] = [];
  let calls = 0;
  const transport = (async () => {
    calls++;
    if (calls > 1) {
      expect((await f.plan()).items.every((item) => !item.evaluation)).toBe(true);
      return Response.json(response(f.payload));
    }
    if (failure === "network") throw new TypeError("connection lost");
    if (failure === "timeout") throw new DOMException("timeout", "TimeoutError");
    if (failure === "json") return new Response("not json");
    if (failure === "answers") return Response.json({ ...response(f.payload), answers: {} });
    if (failure === "constructor" || failure === "toString" || failure === "__proto__") {
      const invalid = response(f.payload);
      for (const answer of Object.values(invalid.answers)) answer.choice = failure;
      return Response.json(invalid);
    }
    return new Response("unavailable", { status: failure });
  }) as typeof fetch;
  const client = new TypeSafeClient("test-key", transport, {
    scheduler: time.clock,
    onRetry: (notice) => notices.push(notice),
  });
  await new ReviewRunner(f.store, client).run(f.reviewPlan, f.batches);
  expect(calls).toBe(2);
  expect(time.waits).toEqual([1000]);
  expect(notices[0]?.retry).toBe(1);
  expect(f.reviewPlan.items.every((item) => item.evaluation)).toBe(true);
  expect((await f.plan()).items.map((item) => item.evaluation?.answer.choice)).toEqual(["matches"]);
});

test.each(["constructor", "__proto__"])("accepts and caches the declared answer choice %s", async (choice) => {
  const f = fixture();
  f.write("value.ts", "export function value() { return 1; }");
  f.loaded.config.questions.methods = [
    parseQuestion({
      id: "custom",
      type: "choice",
      context: "target",
      instructions: "Check the selected category",
      criteria: Object.fromEntries([
        [choice, "Needs inspection"],
        ["clear", "Clear"],
      ]),
    }),
  ];
  const plan = await f.plan();
  const batches = new RequestBatcher().batches(plan, f.loaded.config);
  const payload = batches[0]?.payload;
  if (!payload) throw new Error("Missing request");
  const client = new TypeSafeClient("test-key", (async () => Response.json(response(payload))) as typeof fetch);
  await new ReviewRunner(f.store, client).run(plan, batches);
  const answer = (await f.plan()).items[0]?.evaluation?.answer;
  expect(answer?.choice).toBe(choice);
  expect(Object.hasOwn(answer?.probabilities ?? {}, choice)).toBe(true);
  expect(answer?.probabilities[choice]).toBe(1);
});

test.each(["invalid response", "HTTP 520"])(
  "persistent %s exhausts retries without caching answers",
  async (failure) => {
    const f = await requestFixture();
    for (const retries of [0, undefined]) {
      let calls = 0;
      const time = scheduler();
      const notices: RetryNotice[] = [];
      const client = new TypeSafeClient(
        "test-key",
        (async () => {
          calls++;
          return failure === "HTTP 520" ? new Response("unavailable", { status: 520 }) : Response.json({});
        }) as typeof fetch,
        { retries, scheduler: time.clock, onRetry: (notice) => notices.push(notice) },
      );
      await expect(new ReviewRunner(f.store, client).run(f.reviewPlan, f.batches)).rejects.toThrow(failure);
      const delays = retries === 0 ? [] : [1000, 2000, 4000];
      expect(calls).toBe(delays.length + 1);
      expect(time.waits).toEqual(delays);
      expect(notices.map((notice) => ({ retry: notice.retry, delayMs: notice.delayMs }))).toEqual(
        delays.map((delayMs, index) => ({ retry: index + 1, delayMs })),
      );
      expect((await f.plan()).items.every((item) => !item.evaluation)).toBe(true);
    }
  },
);

test.each([400, 401, 403, 404, 422])("does not retry permanent HTTP %s failures", async (status) => {
  const f = await requestFixture();
  let calls = 0;
  const time = scheduler();
  const client = new TypeSafeClient(
    "test-key",
    (async () => {
      calls++;
      return new Response("error", { status });
    }) as typeof fetch,
    { scheduler: time.clock },
  );
  await expect(client.evaluate(f.payload)).rejects.toThrow(`HTTP ${status}`);
  expect(calls).toBe(1);
  expect(time.waits).toEqual([]);
});

test.each(["5", "Thu, 01 Jan 1970 00:00:05 GMT"])("honours Retry-After %s", async (header) => {
  const f = await requestFixture();
  const time = scheduler();
  let calls = 0;
  const client = new TypeSafeClient(
    "test-key",
    (async () => {
      calls++;
      return calls === 1
        ? new Response("slow down", { status: 429, headers: { "Retry-After": header } })
        : Response.json(response(f.payload));
    }) as typeof fetch,
    { scheduler: time.clock },
  );
  await client.evaluate(f.payload);
  expect(time.waits).toEqual([5000]);
});

test("scheduler paces concurrent starts and applies shared cooldowns", async () => {
  const time = scheduler();
  await Promise.all(Array.from({ length: 4 }, () => time.clock.acquire(1000)));
  expect(time.waits).toEqual([67, 67, 67]);
  time.clock.pause(5000);
  time.clock.pause(1000);
  await time.clock.acquire(1000);
  expect(time.waits.at(-1)).toBe(5000);
});

test("large requests share a rolling byte budget and oversized requests cannot deadlock the queue", async () => {
  const time = scheduler();
  await time.clock.acquire(100_000);
  await time.clock.acquire(100_000);
  await time.clock.acquire(100_000);
  expect(time.clock.now()).toBe(1000);
  await time.clock.acquire(300_000);
  expect(time.clock.now()).toBe(2000);
  await time.clock.acquire(1000);
  expect(time.clock.now()).toBe(4000);
});
