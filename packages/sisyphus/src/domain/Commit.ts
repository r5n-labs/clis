import { OTHER_COMMIT_TYPE, SHORT_HASH_LENGTH } from "../constants";

const CONVENTIONAL_COMMIT_REGEX = /^(\w+)(?:\(([^)]+)\))?(!)?: (.+)$/;

const FIELD_SEPARATOR = "\x1f";

const KNOWN_COMMIT_TYPES = new Set([
  "build",
  "chore",
  "ci",
  "docs",
  "feat",
  "fix",
  "perf",
  "refactor",
  "style",
  "test",
]);

export type CommitInfo = {
  hash: string;
  subject: string;
  body?: string;
  type: string;
  scope?: string;
  message: string;
  packages: string[];
};

type CommitOptions = {
  hash: string;
  subject: string;
  body?: string;
  type: string;
  scope?: string;
  breaking: boolean;
  message: string;
  files: string[];
};

export class Commit {
  readonly hash: string;
  readonly subject: string;
  readonly body?: string;
  readonly type: string;
  readonly scope?: string;
  readonly breaking: boolean;
  readonly message: string;
  readonly files: string[];

  private constructor(options: CommitOptions) {
    this.hash = options.hash;
    this.subject = options.subject;
    this.body = options.body;
    this.type = options.type;
    this.scope = options.scope;
    this.breaking = options.breaking;
    this.message = options.message;
    this.files = options.files;
  }

  static async since(commitHash?: string): Promise<Commit[]> {
    if (commitHash) {
      const commits = await Commit.tryFetchFromRange(`${commitHash}..HEAD`);
      if (commits) return commits;
    }

    return Commit.fetchFromRange("HEAD");
  }

  static async inRange(base: string, head: string): Promise<Commit[]> {
    const ranges = [`origin/${base}..origin/${head}`, `${base}..${head}`];

    for (const range of ranges) {
      const commits = await Commit.tryFetchFromRange(range);
      if (commits) return commits;
    }

    return [];
  }

  static async fromHash(hash: string): Promise<Commit | null> {
    try {
      const result = await Bun.$`git log -1 --pretty=format:"%H%x1f%s" ${hash}`.quiet();
      const output = result.stdout.toString().trim();
      if (!output) return null;

      const [fullHash, subject] = output.split(FIELD_SEPARATOR);
      if (!fullHash || !subject) return null;

      return Commit.hydrate(fullHash, subject);
    } catch {
      return null;
    }
  }

  static async fromMerge(mergeCommitSha: string): Promise<Commit[]> {
    try {
      const result = await Bun.$`git rev-parse ${mergeCommitSha}^2`.quiet();
      const branchTip = result.stdout.toString().trim();
      if (!branchTip) return [];

      return Commit.fetchFromRange(`${mergeCommitSha}^1..${branchTip}`);
    } catch {
      return [];
    }
  }

  private static async tryFetchFromRange(range: string): Promise<Commit[] | null> {
    try {
      return await Commit.fetchFromRange(range);
    } catch {
      return null;
    }
  }

  private static async fetchFromRange(range: string): Promise<Commit[]> {
    const result = await Bun.$`git log ${range} --pretty=format:"%H%x1f%s" --no-merges`.quiet();
    const output = result.stdout.toString().trim();

    if (!output) return [];

    const commits: Commit[] = [];

    for (const line of output.split("\n")) {
      const sepIndex = line.indexOf(FIELD_SEPARATOR);
      if (sepIndex === -1) continue;
      const hash = line.slice(0, sepIndex);
      const subject = line.slice(sepIndex + 1);
      if (!hash || !subject) continue;

      const commit = await Commit.hydrate(hash, subject);
      commits.push(commit);
    }

    return commits;
  }

  private static async hydrate(hash: string, subject: string): Promise<Commit> {
    const files = await Commit.getFiles(hash);
    const body = await Commit.getBody(hash);

    return Commit.parse(hash, subject).withFiles(files).withBody(body);
  }

  private static async getFiles(hash: string): Promise<string[]> {
    const result = await Bun.$`git diff-tree --no-commit-id --name-only -r ${hash}`.quiet();
    return result.stdout.toString().trim().split("\n").filter(Boolean);
  }

  private static async getBody(hash: string): Promise<string | undefined> {
    const result = await Bun.$`git log -1 --pretty=format:"%b" ${hash}`.quiet();
    const body = result.stdout.toString().trim();
    return body || undefined;
  }

  static parse(hash: string, subject: string): Commit {
    const match = subject.match(CONVENTIONAL_COMMIT_REGEX);

    if (match) {
      const [, type = "", scope, breaking, message = ""] = match;
      if (type && KNOWN_COMMIT_TYPES.has(type)) {
        return new Commit({ breaking: !!breaking, files: [], hash, message, scope, subject, type });
      }
    }

    return new Commit({ breaking: false, files: [], hash, message: subject, subject, type: OTHER_COMMIT_TYPE });
  }

  get shortHash(): string {
    return this.hash.slice(0, SHORT_HASH_LENGTH);
  }

  get isConventional(): boolean {
    return this.type !== OTHER_COMMIT_TYPE;
  }

  withFiles(files: string[]): Commit {
    return new Commit({ ...this.toOptions(), files });
  }

  withBody(body: string | undefined): Commit {
    return new Commit({ ...this.toOptions(), body });
  }

  toInfo(packages: string[]): CommitInfo {
    return {
      body: this.body,
      hash: this.shortHash,
      message: this.message,
      packages,
      scope: this.scope,
      subject: this.subject,
      type: this.type,
    };
  }

  private toOptions(): CommitOptions {
    return {
      body: this.body,
      breaking: this.breaking,
      files: this.files,
      hash: this.hash,
      message: this.message,
      scope: this.scope,
      subject: this.subject,
      type: this.type,
    };
  }
}
