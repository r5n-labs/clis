import { expect } from "bun:test";
import { resolve } from "node:path";

const CLI = resolve(import.meta.dir, "../src/cli.ts");
const PROMPT_TIMEOUT_MS = 5000;
const POLL_INTERVAL_MS = 10;
const KEY_DELAY_MS = 30;
export const DOWN = "\u001b[B";
export const UP = "\u001b[A";
export const ENTER = "\r";
export const ESCAPE = "\u001b";

type Step = { prompt: string; keys: string[]; contains?: string };

export async function interactive(cwd: string, args: string[], steps: Step[]): Promise<string> {
  let output = "";
  let transcript = "";
  const terminal = new Bun.Terminal({
    cols: 160,
    rows: 40,
    data(_terminal, data) {
      const chunk = new TextDecoder().decode(data);
      output += chunk;
      transcript += chunk;
    },
  });
  const child = Bun.spawn(["bun", CLI, ...args], {
    cwd,
    env: { ...Bun.env, TERM: "xterm-256color", NO_COLOR: undefined, FORCE_COLOR: "1", TYPESAFE_API_KEY: "" },
    terminal,
  });
  try {
    for (const { prompt, keys, contains } of steps) {
      const deadline = Date.now() + PROMPT_TIMEOUT_MS;
      while (!Bun.stripANSI(output).includes(`◆  ${prompt}`)) {
        if (Date.now() > deadline) throw new Error(`Missing prompt '${prompt}': ${Bun.stripANSI(output)}`);
        await Bun.sleep(POLL_INTERVAL_MS);
      }
      if (contains) expect(Bun.stripANSI(output)).toContain(contains);
      output = "";
      for (const key of keys) {
        terminal.write(key);
        await Bun.sleep(KEY_DELAY_MS);
      }
    }
    const timeout = setTimeout(() => child.kill(), PROMPT_TIMEOUT_MS);
    try {
      expect(await child.exited).toBe(0);
    } finally {
      clearTimeout(timeout);
    }
  } finally {
    child.kill();
    terminal.close();
  }
  return Bun.stripANSI(transcript);
}
