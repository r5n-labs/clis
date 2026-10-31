import { readFile } from "node:fs/promises";

export type HostLookup = { addresses: string[]; durationMs: number; host: string };

const LOOKUP_TIMEOUT_MS = 10_000;
const RESOLV_CONF = "/etc/resolv.conf";
const SCUTIL_NAMESERVER = /^\s*nameserver\[\d+\]\s*:\s*(\S+)/gm;
const RESOLV_CONF_NAMESERVER = /^\s*nameserver\s+(\S+)/gm;
const DSCACHEUTIL_ADDRESS = /^(?:ip|ipv6)_address:\s*(\S+)/gm;
const GETENT_ADDRESS = /^(\S+)\s/gm;

export async function listDnsServers(): Promise<string[]> {
  const [output, pattern] = Bun.which("scutil")
    ? [await capture(["scutil", "--dns"]), SCUTIL_NAMESERVER]
    : [await readResolvConf(), RESOLV_CONF_NAMESERVER];
  return unique(matches(output, pattern));
}

export function hostLookupAvailable(): boolean {
  return Bun.which("dscacheutil") !== null || Bun.which("getent") !== null;
}

export async function lookupHost(host: string): Promise<HostLookup> {
  const [command, pattern] = Bun.which("dscacheutil")
    ? [["dscacheutil", "-q", "host", "-a", "name", host], DSCACHEUTIL_ADDRESS]
    : [["getent", "hosts", host], GETENT_ADDRESS];
  const started = performance.now();
  const output = await capture(command);
  return { addresses: unique(matches(output, pattern)), durationMs: Math.round(performance.now() - started), host };
}

async function capture(command: string[]): Promise<string> {
  const proc = Bun.spawn(command, { stderr: "ignore", stdin: "ignore", stdout: "pipe", timeout: LOOKUP_TIMEOUT_MS });
  const [output] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
  return output;
}

async function readResolvConf(): Promise<string> {
  try {
    return await readFile(RESOLV_CONF, "utf-8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "";
    throw error;
  }
}

function matches(output: string, pattern: RegExp): string[] {
  return [...output.matchAll(pattern)].flatMap((match) => (match[1] ? [match[1]] : []));
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
