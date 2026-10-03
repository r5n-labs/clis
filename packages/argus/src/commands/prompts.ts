import { Exit, text } from "@r5n/cli-core";
import type { LoadedConfig } from "../config/types";

export function requireInteractive(interactive: boolean, usage: string): void {
  if (!interactive || process.stdin.isTTY !== true || process.stdout.isTTY !== true)
    throw new Exit(usage, "Supply the required input or run this command in a terminal");
}

export async function reviewBase(loaded: LoadedConfig, base: string | undefined, interactive: boolean) {
  if (base || !loaded.config.questions.changes.length || !interactive) return base;
  requireInteractive(interactive, "Change questions require --base <git-revision>");
  return (
    await text({
      message: "Git base revision for change questions",
      placeholder: "HEAD",
      validate: (value) => (value?.trim() ? undefined : "Enter the revision to compare against"),
    })
  ).trim();
}
