import { color, Exit, log, validateKnownArgs } from "@r5n/cli-core";
import { BaseCommand, type Ctx } from "../base-command";
import type { JobHookState, RunnerInfo } from "../providers";
import {
  createProvider,
  hostLookupAvailable,
  inspectJobHooks,
  listDnsServers,
  lookupHost,
  resolveJobHooks,
} from "../providers";
import type { DnsHookConfig, JobHooksConfig, Profile, RunnerEntry } from "../types";

type DoctorCtx = Ctx;

const HOOK_STATE_LABELS: Record<JobHookState, { paint: (text: string) => string; text: string }> = {
  configured: { paint: color.green, text: "configured" },
  foreign: { paint: color.yellow, text: "set to another script" },
  missing: { paint: color.yellow, text: "missing" },
  off: { paint: color.dim, text: "off" },
  outdated: { paint: color.yellow, text: "outdated" },
};

const NEEDS_UPDATE: ReadonlySet<JobHookState> = new Set(["missing", "outdated"]);

export class DoctorCommand extends BaseCommand {
  name = "doctor";
  description = "Check DNS and each runner's job hooks";

  async execute(ctx: DoctorCtx) {
    validateKnownArgs(ctx.args, this.args, "Run 'hydra doctor --help' for supported options");
    const profiles = ctx.config.get("profiles");

    if (Object.keys(profiles).length === 0) {
      throw new Exit("No profiles configured", "Run hydra init to set up a profile");
    }

    const entries = ctx.config.get("runners") ?? [];
    const servers = await listDnsServers();
    const lines = [`${color.bold("DNS servers")} ${servers.length > 0 ? servers.join(", ") : color.dim("unknown")}`];
    let needsUpdate = false;
    let needsRestart = false;

    for (const [name, profile] of Object.entries(profiles)) {
      const hooks = resolveJobHooks(profile.jobHooks);
      lines.push("", `${color.bold(name)} ${color.dim(profile.url)}`);
      lines.push(...(await this.dnsLines(hooks.dns)));
      lines.push(this.cleanupLine(hooks));

      const report = await this.runnerLines(
        profile,
        hooks,
        entries.filter((entry) => entry.profile === name),
      );
      lines.push(...report.lines);
      needsUpdate ||= report.needsUpdate;
      needsRestart ||= report.needsRestart;
    }

    if (needsUpdate) lines.push("", color.yellow(`Run ${color.green("hydra update")} to write the missing hooks.`));
    if (needsRestart) {
      lines.push(
        "",
        color.yellow(
          `Restart runners marked "restart" once they are idle: hydra stop <profile> && hydra start <profile>`,
        ),
      );
    }
    log.info(lines.join("\n"));
  }

  private async dnsLines(dns: DnsHookConfig): Promise<string[]> {
    const lines = [`  DNS wait: ${dns.enabled ? `on, up to ${dns.timeoutSeconds} s` : color.dim("off")}`];
    if (!hostLookupAvailable()) return [...lines, color.yellow("    No dscacheutil or getent to look hosts up with")];

    for (const host of dns.hosts) {
      const lookup = await lookupHost(host);
      lines.push(
        lookup.addresses.length > 0
          ? `    ${color.green("✓")} ${host} ${color.dim(`${lookup.durationMs} ms · ${lookup.addresses.join(", ")}`)}`
          : `    ${color.red("✗")} ${host} ${color.red(`no address after ${lookup.durationMs} ms`)}`,
      );
    }

    return lines;
  }

  private cleanupLine(hooks: JobHooksConfig): string {
    const { enabled, keepToolCache } = hooks.workspaceCleanup;
    const detail = keepToolCache ? "keeps _tool" : "empties _tool";
    return `  Workspace cleanup: ${enabled ? `on, ${detail}` : color.dim("off")}`;
  }

  private async runnerLines(profile: Profile, hooks: JobHooksConfig, entries: RunnerEntry[]) {
    if (entries.length === 0) return { lines: [color.dim("  No runners.")], needsRestart: false, needsUpdate: false };

    const statuses = new Map((await createProvider(profile).list()).map((runner) => [runner.id, runner]));
    const sorted = [...entries].sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
    const lines: string[] = [];
    let needsRestart = false;
    let needsUpdate = false;

    for (const entry of sorted) {
      const status = statuses.get(entry.id);
      const { envModifiedAt, states } = await inspectJobHooks(entry.directory, hooks);
      const restart = this.loadedBefore(status, envModifiedAt);
      needsRestart ||= restart;
      needsUpdate ||= NEEDS_UPDATE.has(states.started) || NEEDS_UPDATE.has(states.completed);

      lines.push(
        [
          `  ${entry.id}`,
          color.dim(status?.status ?? "unknown"),
          `DNS wait ${this.stateLabel(states.started)}`,
          `cleanup ${this.stateLabel(states.completed)}`,
          restart ? color.yellow("restart") : "",
        ]
          .filter(Boolean)
          .join("  "),
      );
    }

    return { lines, needsRestart, needsUpdate };
  }

  private stateLabel(state: JobHookState): string {
    const { paint, text } = HOOK_STATE_LABELS[state];
    return paint(text);
  }

  private loadedBefore(status: RunnerInfo | undefined, envModifiedAt: Date | null): boolean {
    if (status?.status !== "running" || !status.startedAt || !envModifiedAt) return false;
    return envModifiedAt > status.startedAt;
  }
}
