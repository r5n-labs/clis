import * as clack from "@clack/prompts";

import { Cancel } from "./cancel";
import { color } from "./util/color";

function unwrap<T>(result: T | symbol): T {
  if (clack.isCancel(result)) {
    throw new Cancel();
  }
  return result;
}

type HintPart = { key?: string; text: string };

function formatHint(parts: readonly HintPart[]): string {
  return parts
    .map((part) => (part.key ? `${color.bold(part.key)} ${color.dim(part.text)}` : color.dim(part.text)))
    .join(color.dim(" · "));
}

function logHint(parts: readonly HintPart[]) {
  clack.log.info(formatHint(parts));
}

const hints = {
  confirm: [
    { key: "Enter", text: "confirm" },
    { key: "Esc", text: "cancel" },
  ],
  multiselect: [
    { key: "↑↓", text: "navigate" },
    { key: "Space", text: "toggle" },
    { key: "a", text: "all" },
    { key: "Enter", text: "confirm" },
    { key: "Esc", text: "cancel" },
  ],
  select: [
    { key: "↑↓", text: "navigate" },
    { key: "Enter", text: "select" },
    { key: "Esc", text: "cancel" },
  ],
  text: [
    { key: "Enter", text: "submit" },
    { key: "Esc", text: "cancel" },
  ],
} as const;

export async function confirm(params: Parameters<typeof clack.confirm>[0]): Promise<boolean> {
  logHint(hints.confirm);
  return unwrap(await clack.confirm(params));
}

export async function text(params: Parameters<typeof clack.text>[0]): Promise<string> {
  logHint(hints.text);
  return unwrap(await clack.text(params));
}

export async function select<T>(params: Parameters<typeof clack.select<T>>[0]): Promise<T> {
  logHint(hints.select);
  return unwrap(await clack.select({ showInstructions: false, ...params }));
}

export async function multiselect<T>(params: Parameters<typeof clack.multiselect<T>>[0]): Promise<T[]> {
  logHint(hints.multiselect);
  return unwrap(await clack.multiselect({ showInstructions: false, ...params }));
}

export { cancel, group, intro, log, note, outro, spinner } from "@clack/prompts";
