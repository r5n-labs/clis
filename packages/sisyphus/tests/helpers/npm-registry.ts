import { writeFileSync } from "node:fs";
import { join } from "node:path";

const NPM_ENVIRONMENT_KEYS = [
  "BUN_CONFIG_REGISTRY",
  "BUN_CONFIG_TOKEN",
  "NPM_CONFIG_FETCH_RETRIES",
  "NPM_CONFIG_PROVENANCE",
  "NPM_CONFIG_REGISTRY",
  "NPM_CONFIG_USERCONFIG",
] as const;

export type Packument = { name: string; versions: Record<string, { dist: { integrity: string } }> };

export type PackumentView = (packument: Packument) => Packument | undefined;

export type FakeNpmRegistry = { published: string[]; readsAfterPublish: string[]; stop(): void };

export function startFakeNpmRegistry(root: string, view: PackumentView): FakeNpmRegistry {
  const packuments = new Map<string, Packument>();
  const published: string[] = [];
  const readsAfterPublish: string[] = [];
  const originalEnvironment = NPM_ENVIRONMENT_KEYS.map((key) => [key, process.env[key]] as const);

  const server = Bun.serve({
    async fetch(request) {
      const name = decodeURIComponent(new URL(request.url).pathname.slice(1));
      if (request.method === "PUT") {
        const { _attachments: _, ...packument } = (await request.json()) as Packument & { _attachments: unknown };
        packuments.set(name, packument);
        published.push(name);
        return Response.json({ ok: true }, { status: 201 });
      }
      if (published.length > 0) readsAfterPublish.push(name);
      const stored = packuments.get(name);
      const served = stored ? view(structuredClone(stored)) : undefined;
      return served ? Response.json(served) : Response.json({ error: "not found" }, { status: 404 });
    },
    port: 0,
  });

  const userConfig = join(root, ".git/npmrc-test");
  writeFileSync(userConfig, `registry=${server.url}\n//${server.url.host}/:_authToken=test-token\n`);
  process.env.BUN_CONFIG_REGISTRY = String(server.url);
  process.env.BUN_CONFIG_TOKEN = crypto.randomUUID();
  process.env.NPM_CONFIG_FETCH_RETRIES = "0";
  process.env.NPM_CONFIG_PROVENANCE = "false";
  process.env.NPM_CONFIG_REGISTRY = String(server.url);
  process.env.NPM_CONFIG_USERCONFIG = userConfig;

  return {
    published,
    readsAfterPublish,
    stop() {
      server.stop(true);
      for (const [key, value] of originalEnvironment) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    },
  };
}
