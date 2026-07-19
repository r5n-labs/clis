import { existsSync } from "node:fs";
import { cp, link, mkdir, readdir, readFile, readlink, rm, symlink, unlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { SHARED_DIR } from "../constants";
import type { Profile } from "../types";
import type { GitHubTarget } from "./github-url";
import { describeGitHubTarget, parseGitHubUrl } from "./github-url";
import { DIAG_DIR, discoverLogFiles } from "./log-files";
import type { DownloadResult, RunnerInfo, RunnerLogFile, RunnerProvider } from "./types";

const RUNNER_REPO = "actions/runner";
const PLATFORM_MAP = { linux: "linux-x64", osx: "osx-arm64", windows: "win-x64" } as const;
const HARDLINK_DIRS = ["bin"];
const SYMLINK_DIRS = ["externals"];

export class GitHubRunnerProvider implements RunnerProvider {
  private sharedPath: string | null = null;

  constructor(private profile: Profile) {}

  async download(): Promise<DownloadResult> {
    const platform = PLATFORM_MAP[this.profile.os];
    const version = await this.getLatestVersion();
    const versionDir = join(SHARED_DIR, "github", version);

    if (existsSync(versionDir)) {
      this.sharedPath = versionDir;
      return { path: versionDir, version };
    }

    await mkdir(versionDir, { recursive: true });

    const tarball = `actions-runner-${platform}-${version}.tar.gz`;
    const tarballPath = join(versionDir, tarball);
    const downloadUrl = `https://github.com/${RUNNER_REPO}/releases/download/v${version}/${tarball}`;

    await Bun.$`curl -sL -o ${tarballPath} ${downloadUrl}`;
    await Bun.$`tar xzf ${tarballPath} -C ${versionDir}`;
    await unlink(tarballPath);

    this.sharedPath = versionDir;
    return { path: versionDir, version };
  }

  async create(ids: string[]): Promise<RunnerInfo[]> {
    const shared = await this.ensureDownloaded();
    const runners: RunnerInfo[] = [];

    for (const id of ids) {
      const runnerDir = join(this.profile.directory, id);
      await this.setupRunnerDir(shared, runnerDir);
      await this.registerRunner(runnerDir, id);
      runners.push({ directory: runnerDir, id, name: id, status: "registered" });
    }

    return runners;
  }

  async remove(ids: string[]): Promise<void> {
    for (const id of ids) {
      const runnerDir = join(this.profile.directory, id);
      if (!existsSync(join(runnerDir, ".runner"))) continue;

      const token = await this.fetchRemovalToken(runnerDir);
      await Bun.$`bash ./config.sh remove --token ${token}`.cwd(runnerDir).quiet().nothrow();
    }
  }

  async start(ids: string[]): Promise<void> {
    for (const id of ids) {
      const runnerDir = join(this.profile.directory, id);
      const existingPid = await this.readPidFile(runnerDir);
      if (existingPid && this.isProcessRunning(existingPid)) continue;

      const proc = Bun.spawn(["bash", "./run.sh"], { cwd: resolve(runnerDir), stderr: "pipe", stdout: "pipe" });
      proc.unref();
      await this.writePidFile(runnerDir, proc.pid);
    }
  }

  async stop(ids: string[]): Promise<void> {
    for (const id of ids) {
      const runnerDir = join(this.profile.directory, id);
      const pid = await this.readPidFile(runnerDir);
      if (!pid) continue;

      const absDir = resolve(runnerDir);
      await Bun.$`pkill -f ${absDir}`.quiet().nothrow();

      await this.removePidFile(runnerDir);
    }
  }

  async list(): Promise<RunnerInfo[]> {
    const runnersDir = this.profile.directory;
    if (!existsSync(runnersDir)) return [];

    const entries = await readdir(runnersDir, { withFileTypes: true });
    const runners: RunnerInfo[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const runnerDir = join(runnersDir, entry.name);
      runners.push(await this.getRunnerStatus(runnerDir, entry.name));
    }

    return runners;
  }

  async currentVersion(id: string): Promise<string | null> {
    const runnerDir = join(this.profile.directory, id);
    return this.detectVersion(runnerDir);
  }

  async logFiles(id: string): Promise<RunnerLogFile[]> {
    return discoverLogFiles(join(this.profile.directory, id, DIAG_DIR));
  }

  async update(ids: string[]): Promise<void> {
    const sharedPath = await this.ensureDownloaded();

    for (const id of ids) {
      const runnerDir = join(this.profile.directory, id);
      await this.removeRunnerBinaries(runnerDir);
      await this.setupRunnerDir(sharedPath, runnerDir);
    }
  }

  private async getRunnerStatus(runnerDir: string, id: string): Promise<RunnerInfo> {
    const name = await this.readRunnerName(runnerDir);
    const pid = await this.readPidFile(runnerDir);
    const isRunning = pid !== null && this.isProcessRunning(pid);

    let status: RunnerInfo["status"] = "unknown";
    if (isRunning) status = "running";
    else if (existsSync(join(runnerDir, ".runner"))) status = "registered";

    return { directory: runnerDir, id, name, pid: isRunning ? pid : undefined, status };
  }

  private async ensureDownloaded(): Promise<string> {
    if (this.sharedPath) return this.sharedPath;
    const { path } = await this.download();
    return path;
  }

  private async setupRunnerDir(sharedPath: string, runnerDir: string) {
    await mkdir(runnerDir, { recursive: true });

    for (const dir of HARDLINK_DIRS) {
      await this.hardLinkDir(join(sharedPath, dir), join(runnerDir, dir));
    }

    for (const dir of SYMLINK_DIRS) {
      const target = resolve(sharedPath, dir);
      const linkPath = join(runnerDir, dir);
      if (!existsSync(linkPath)) {
        await symlink(target, linkPath);
      }
    }

    for (const pattern of ["*.sh", "*.sh.template"]) {
      const files = await Array.fromAsync(new Bun.Glob(pattern).scan(sharedPath));
      for (const file of files) {
        await cp(join(sharedPath, file), join(runnerDir, file));
      }
    }
  }

  private async registerRunner(runnerDir: string, name: string) {
    const regToken = await this.fetchRegistrationToken();
    const configArgs = ["--url", this.profile.url, "--token", regToken, "--name", name, "--unattended"];
    if (this.profile.labels) configArgs.push("--labels", this.profile.labels);
    if (this.profile.runnerGroup) configArgs.push("--runnergroup", this.profile.runnerGroup);

    await Bun.$`bash ./config.sh ${configArgs}`.cwd(runnerDir).quiet();
  }

  private async fetchRegistrationToken(): Promise<string> {
    return this.fetchRunnerToken(parseGitHubUrl(this.profile.url), "registration-token");
  }

  private async fetchRemovalToken(runnerDir: string): Promise<string> {
    const content = await readFile(join(runnerDir, ".runner"), "utf-8");
    const config = JSON.parse(this.stripBom(content));
    const url = config.gitHubUrl;
    if (!url) throw new Error("Cannot determine GitHub URL from runner config");

    return this.fetchRunnerToken(parseGitHubUrl(url), "remove-token");
  }

  private async fetchRunnerToken(target: GitHubTarget, action: "registration-token" | "remove-token") {
    const endpoint =
      target.kind === "repo"
        ? `repos/${target.owner}/${target.repo}/actions/runners/${action}`
        : `orgs/${target.org}/actions/runners/${action}`;
    const scopeHint =
      target.kind === "repo" ? "gh needs admin access to the repository" : "gh needs the admin:org scope";

    const result = await Bun.$`gh api ${endpoint} --method POST --jq .token`.quiet().nothrow();
    if (result.exitCode !== 0) {
      const stderr = result.stderr.toString().trim();
      throw new Error(
        `gh api ${endpoint} failed for ${describeGitHubTarget(target)} (${scopeHint})${stderr ? `: ${stderr}` : ""}`,
      );
    }

    const token = result.stdout.toString().trim();
    if (!token) {
      throw new Error(`Failed to fetch ${action} for ${describeGitHubTarget(target)}`);
    }

    return token;
  }

  private async getLatestVersion(): Promise<string> {
    const result = await Bun.$`gh api repos/${RUNNER_REPO}/releases/latest --jq .tag_name`.quiet();
    return result.stdout.toString().trim().replace(/^v/, "");
  }

  private pidFilePath(runnerDir: string) {
    return resolve(runnerDir, ".pid");
  }

  private async writePidFile(runnerDir: string, pid: number) {
    await writeFile(this.pidFilePath(runnerDir), String(pid));
  }

  private async readPidFile(runnerDir: string): Promise<number | null> {
    try {
      const content = await readFile(this.pidFilePath(runnerDir), "utf-8");
      return Number.parseInt(content.trim(), 10);
    } catch {
      return null;
    }
  }

  private async removePidFile(runnerDir: string) {
    try {
      await unlink(this.pidFilePath(runnerDir));
    } catch {}
  }

  private async readRunnerName(runnerDir: string): Promise<string> {
    try {
      const content = await readFile(join(runnerDir, ".runner"), "utf-8");
      return JSON.parse(this.stripBom(content)).agentName ?? "unknown";
    } catch {
      return "unknown";
    }
  }

  private async hardLinkDir(source: string, dest: string) {
    await mkdir(dest, { recursive: true });

    const entries = await readdir(source, { withFileTypes: true });
    for (const entry of entries) {
      const srcPath = join(source, entry.name);
      const destPath = join(dest, entry.name);

      if (entry.isDirectory()) {
        await this.hardLinkDir(srcPath, destPath);
      } else {
        await link(srcPath, destPath);
      }
    }
  }

  private async detectVersion(runnerDir: string): Promise<string | null> {
    try {
      const target = await readlink(join(runnerDir, "externals"));
      const match = target.match(/github\/([^/]+)/);
      return match?.[1] ?? null;
    } catch {
      return null;
    }
  }

  private async removeRunnerBinaries(runnerDir: string) {
    for (const dir of HARDLINK_DIRS) {
      await rm(join(runnerDir, dir), { force: true, recursive: true });
    }
    for (const dir of SYMLINK_DIRS) {
      await rm(join(runnerDir, dir), { force: true });
    }
    for (const pattern of ["*.sh", "*.sh.template"]) {
      const files = await Array.fromAsync(new Bun.Glob(pattern).scan(runnerDir));
      for (const file of files) {
        await rm(join(runnerDir, file), { force: true });
      }
    }
  }

  private stripBom(content: string) {
    return content.replace(/^\uFEFF/, "");
  }

  private isProcessRunning(pid: number): boolean {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }
}
