import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseConfig } from "../../src/config/validation";
import type { ApiPayload } from "../../src/domain/review-plan";
import { CloudflareClient } from "../../src/providers/cloudflare/CloudflareClient";
import { RequestBatcher } from "../../src/services/RequestBatcher";
import { ReviewRunner } from "../../src/services/ReviewRunner";
import { writeJson } from "../../src/storage/EvaluationStore";
import { cli, fixture, response } from "../helpers";

const ACCOUNT = "0123456789abcdef0123456789abcdef";

function httpFixture(handler: (request: Request) => Promise<Response>) {
  const server = Bun.serve({ port: 0, fetch: handler });
  const destinations: { url: string; redirect: RequestRedirect }[] = [];
  const transport = (async (input: string | URL | Request, init?: RequestInit) => {
    const request = new Request(input, init);
    destinations.push({ url: request.url, redirect: request.redirect });
    return fetch(new URL(new URL(request.url).pathname, server.url), init);
  }) as typeof fetch;
  return { server, transport, destinations };
}

async function reviewFixture(model = "clef") {
  const f = fixture();
  f.loaded.config.model = model;
  f.write("example.ts", "export function value() { return 1; }");
  const plan = await f.plan();
  const batches = new RequestBatcher().batches(plan, f.loaded.config);
  const batch = batches[0];
  if (!batch) throw new Error("Missing request");
  return { ...f, reviewPlan: plan, batches, batch };
}

test.each(["clef", "clef-flash"])(
  "Cloudflare %s sends its documented REST request and caches validated answers",
  async (model) => {
    const f = await reviewFixture(model);
    const received: { method: string; key: string | null; type: string | null; payload: ApiPayload }[] = [];
    const http = httpFixture(async (request) => {
      const payload = (await request.json()) as ApiPayload;
      received.push({
        method: request.method,
        key: request.headers.get("authorization"),
        type: request.headers.get("content-type"),
        payload,
      });
      return Response.json({ success: true, result: response(payload), errors: [], messages: [] });
    });
    try {
      await new ReviewRunner(f.store, new CloudflareClient(ACCOUNT, "fixture-token", http.transport)).run(
        f.reviewPlan,
        f.batches,
      );
      expect(http.destinations).toEqual([
        {
          url: `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/ai/run/@cf/cloudflare/${model}`,
          redirect: "error",
        },
      ]);
      expect(received).toEqual([
        {
          method: "POST",
          key: "Bearer fixture-token",
          type: "application/json",
          payload: { ...f.batch.payload, model },
        },
      ]);
      f.loaded.config.model = `@cf/cloudflare/${model}`;
      expect(new RequestBatcher().batches(await f.plan(), f.loaded.config)).toHaveLength(0);
      expect(f.reviewPlan.items[0]?.evaluation?.model).toBe(model);
      f.loaded.config.model = model === "clef" ? "clef-flash" : "clef";
      expect(new RequestBatcher().batches(await f.plan(), f.loaded.config)).toHaveLength(1);
      f.loaded.config.model = "jev-1.13.0";
      expect(new RequestBatcher().batches(await f.plan(), f.loaded.config)).toHaveLength(1);
    } finally {
      await http.server.stop(true);
    }
  },
);

test.each(["failed", "missing envelope", "missing result", "wrong model", "HTTP 401"])(
  "Cloudflare rejects %s responses without saving an evaluation or successful receipt",
  async (failure) => {
    const f = await reviewFixture();
    let calls = 0;
    const http = httpFixture(async (request) => {
      calls++;
      const payload = (await request.json()) as ApiPayload;
      const result = response(payload);
      switch (failure) {
        case "failed":
          return Response.json({ success: false, result, errors: [{ message: "sensitive upstream details" }] });
        case "missing envelope":
          return Response.json(result);
        case "missing result":
          return Response.json({ success: true });
        case "wrong model":
          return Response.json({ success: true, result: { ...result, model: "clef-flash" } });
        default:
          return new Response("sensitive upstream details", { status: 401 });
      }
    });
    try {
      const retries = failure === "failed" || failure === "HTTP 401" ? undefined : 0;
      const client = new CloudflareClient(ACCOUNT, "fixture-token", http.transport, { retries });
      const expected =
        failure === "failed"
          ? "Cloudflare reported an unsuccessful inference"
          : failure === "HTTP 401"
            ? "Cloudflare HTTP 401"
            : "Cloudflare returned an invalid response";
      await expect(new ReviewRunner(f.store, client).run(f.reviewPlan, f.batches)).rejects.toThrow(expected);
      expect(calls).toBe(1);
      expect((await f.plan()).items.every((item) => !item.evaluation)).toBe(true);
      const receipt = JSON.parse(readFileSync(join(f.store.directory, "requests", `${f.batch.id}.json`), "utf8"));
      expect(receipt.response).toBeUndefined();
    } finally {
      await http.server.stop(true);
    }
  },
);

test("Cloudflare previews need no credentials and unsupported selectors fail offline", async () => {
  const f = fixture();
  f.write("example.ts", "export function value() { return 1; }");
  writeJson(f.loaded.path, { ...f.loaded.config, model: "clef" });
  const preview = await cli(f.directory, ["check", "--config", f.loaded.path, "--json"]);
  expect(preview.code).toBe(0);
  expect(JSON.parse(preview.stdout)).toMatchObject({ model: "@cf/cloudflare/clef", summary: { pending: 1 } });
  expect(existsSync(f.store.directory)).toBe(false);
  const run = await cli(f.directory, ["run", "--config", f.loaded.path]);
  expect(run.code).toBe(1);
  expect(run.stdout + run.stderr).toContain("CLOUDFLARE_ACCOUNT_ID");
  expect(existsSync(join(f.store.directory, "run.lock"))).toBe(false);
  writeJson(f.loaded.path, { ...f.loaded.config, model: "@cf/meta/llama-3.1-8b-instruct" });
  const unsupported = await cli(f.directory, ["check", "--config", f.loaded.path]);
  expect(unsupported.code).toBe(1);
  expect(unsupported.stdout + unsupported.stderr).toContain("Unsupported Cloudflare review model");
});

test("Cloudflare question limits apply offline while TypeSafe keeps its configured limits", async () => {
  const f = await reviewFixture();
  const naming = f.loaded.config.questions.methods[0];
  if (!naming) throw new Error("Missing question");
  f.loaded.config.maxQuestions = 100;
  f.loaded.config.maxRequestBytes = 1_000_000;
  f.loaded.config.questions.methods = Array.from({ length: 65 }, (_, index) => ({
    ...naming,
    id: `question-${index}`,
    instructions: `Check concern ${index}`,
  }));
  expect(new RequestBatcher().batches(await f.plan(), f.loaded.config).map((batch) => batch.items.length)).toEqual([
    64, 1,
  ]);
  f.loaded.config.model = "jev-next";
  expect(new RequestBatcher().batches(await f.plan(), f.loaded.config).map((batch) => batch.items.length)).toEqual([
    65,
  ]);
  const criteria = Object.fromEntries(
    Array.from({ length: 256 }, (_, index) => [`option-${index}`, `Option ${index}`]),
  );
  const config = {
    ...f.loaded.config,
    questions: { methods: [{ ...naming, flag: [], reviewQueues: undefined, criteria }] },
  };
  expect(() => parseConfig({ ...config, model: "clef" })).toThrow("limit of 255 choices");
  expect(parseConfig({ ...config, model: "jev-next" }).model).toBe("jev-next");
});

test("benchmark uses Cloudflare selection and stays offline without --live", async () => {
  const f = fixture();
  const script = resolve(import.meta.dir, "../../benchmarks/run.ts");
  const run = async (live: boolean) => {
    const child = Bun.spawn(
      ["bun", script, "--model", "clef", "--output", join(f.directory, "benchmark"), ...(live ? ["--live"] : [])],
      {
        stdout: "pipe",
        stderr: "pipe",
        env: {
          ...Bun.env,
          TYPESAFE_API_KEY: "",
          CLOUDFLARE_ACCOUNT_ID: "",
          CLOUDFLARE_API_TOKEN: "",
          CLOUDFLARE_AUTH_TOKEN: "",
        },
      },
    );
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    return { stdout, stderr, code };
  };
  const offline = await run(false);
  expect(offline.code).toBe(0);
  expect(JSON.parse(offline.stdout).evaluated).toBe(0);
  const live = await run(true);
  expect(live.code).not.toBe(0);
  expect(live.stderr).toContain("CLOUDFLARE_ACCOUNT_ID");
});
