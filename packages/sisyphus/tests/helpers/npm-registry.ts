import { writeFileSync } from "node:fs";
import { join } from "node:path";

const HTTP_CREATED = 201;
const HTTP_NOT_FOUND = 404;

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

export type NpmRegistryServer = { url: string; stop(): void };

export type FakeNpmRegistry = { published: string[]; readsAfterPublish: string[]; stop(): void };

function configureNpmRegistry(root: string, url: URL): () => void {
  const originalEnvironment = NPM_ENVIRONMENT_KEYS.map((key) => [key, process.env[key]] as const);
  const userConfig = join(root, ".git/npmrc-test");
  writeFileSync(userConfig, `registry=${url.href}\n//${url.host}/:_authToken=test-token\n`);
  process.env.BUN_CONFIG_REGISTRY = url.href;
  process.env.BUN_CONFIG_TOKEN = crypto.randomUUID();
  process.env.NPM_CONFIG_FETCH_RETRIES = "0";
  process.env.NPM_CONFIG_PROVENANCE = "false";
  process.env.NPM_CONFIG_REGISTRY = url.href;
  process.env.NPM_CONFIG_USERCONFIG = userConfig;

  return () => {
    for (const [key, value] of originalEnvironment) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
}

export function serveNpmRegistry(
  root: string,
  fetch: (request: Request) => Response | Promise<Response>,
): NpmRegistryServer {
  const server = Bun.serve({ fetch, port: 0 });
  const restoreEnvironment = configureNpmRegistry(root, server.url);

  return {
    url: server.url.href,
    stop() {
      server.stop(true);
      restoreEnvironment();
    },
  };
}

export function startFakeNpmRegistry(root: string, view: PackumentView, publishStatus = HTTP_CREATED): FakeNpmRegistry {
  const packuments = new Map<string, Packument>();
  const published: string[] = [];
  const readsAfterPublish: string[] = [];

  const server = serveNpmRegistry(root, async (request) => {
    const name = decodeURIComponent(new URL(request.url).pathname.slice(1));
    if (request.method === "PUT") {
      const { _attachments: _, ...packument } = (await request.json()) as Packument & { _attachments: unknown };
      packuments.set(name, packument);
      published.push(name);
      return Response.json({ ok: publishStatus === HTTP_CREATED }, { status: publishStatus });
    }
    if (published.length > 0) readsAfterPublish.push(name);
    const stored = packuments.get(name);
    const served = stored ? view(structuredClone(stored)) : undefined;
    return served ? Response.json(served) : Response.json({ error: "not found" }, { status: HTTP_NOT_FOUND });
  });

  return { published, readsAfterPublish, stop: server.stop };
}
