import { Exit } from "@r5n/cli-core";
import { OTHER_COMMIT_TYPE, SHORT_HASH_LENGTH } from "../constants";

const CONVENTIONAL_COMMIT_REGEX = /^(\w+)(?:\(([^)]+)\))?(!)?: (.+)$/;
const BREAKING_FOOTER_REGEX = /^BREAKING(?: CHANGE|-CHANGE):[\t ]+\S/m;
const LOG_FORMAT = "%x00%H%x00%s%x00%an%x00%b";
const LOG_FIELD_COUNT = 4;
const DIFF_PREFIX = "\n";

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
  author: string;
  body?: string;
  type: string;
  scope?: string;
  message: string;
  files: string[];
};

export class Commit {
  readonly hash: string;
  readonly subject: string;
  readonly author: string;
  readonly body?: string;
  readonly type: string;
  readonly scope?: string;
  readonly breaking: boolean;
  readonly message: string;
  readonly files: string[];

  private constructor(options: CommitOptions) {
    const [, , , breaking] = options.subject.match(CONVENTIONAL_COMMIT_REGEX) ?? [];
    this.hash = options.hash;
    this.subject = options.subject;
    this.author = options.author;
    this.body = options.body;
    this.type = options.type;
    this.scope = options.scope;
    this.breaking = !!breaking || BREAKING_FOOTER_REGEX.test(options.body ?? "");
    this.message = options.message;
    this.files = options.files;
  }

  static async since(commitHash?: string): Promise<Commit[]> {
    if (commitHash !== undefined) {
      try {
        const resolved = await Bun.$`git rev-parse --verify --end-of-options ${`${commitHash}^{commit}`}`.quiet();
        const baseline = resolved.stdout.toString().trim();
        return await Commit.fetchFromRange(`${baseline}..HEAD`);
      } catch (error) {
        const failure = new Exit(
          `Failed to read commits since ${commitHash}`,
          "Fetch the missing commit or correct the configured baseline before creating stones",
        );
        failure.cause = error;
        throw failure;
      }
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
      const [commit] = await Commit.readCommits(["-1", hash]);
      return commit ?? null;
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
    return Commit.readCommits([range, "--no-merges"]);
  }

  private static async readCommits(args: string[]): Promise<Commit[]> {
    const result = await Bun.$`git log ${args} -z --format=${LOG_FORMAT} --name-only --root`.quiet();
    const segments = result.stdout.toString().split("\x00");
    const commits: Commit[] = [];
    let cursor = 0;

    while (cursor < segments.length) {
      cursor++;
      const [hash, subject, author, body] = segments.slice(cursor, cursor + LOG_FIELD_COUNT);
      cursor += LOG_FIELD_COUNT;
      const files: string[] = [];

      while (cursor < segments.length && segments[cursor] !== "") {
        const file = segments[cursor++];
        if (file === undefined) continue;
        files.push(files.length === 0 && file.startsWith(DIFF_PREFIX) ? file.slice(DIFF_PREFIX.length) : file);
      }

      if (!hash || !subject || !author) continue;

      commits.push(
        Commit.parse(hash, subject, author)
          .withFiles(files)
          .withBody(body?.trim() || undefined),
      );
    }

    return commits;
  }

  static parse(hash: string, subject: string, author: string): Commit {
    const match = subject.match(CONVENTIONAL_COMMIT_REGEX);

    if (match) {
      const [, rawType = "", scope, , message = ""] = match;
      const type = rawType.toLowerCase();
      if (type && KNOWN_COMMIT_TYPES.has(type)) {
        return new Commit({ author, files: [], hash, message, scope, subject, type });
      }
    }

    return new Commit({ author, files: [], hash, message: subject, subject, type: OTHER_COMMIT_TYPE });
  }

  get shortHash(): string {
    return this.hash.slice(0, SHORT_HASH_LENGTH);
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
      author: this.author,
      body: this.body,
      files: this.files,
      hash: this.hash,
      message: this.message,
      scope: this.scope,
      subject: this.subject,
      type: this.type,
    };
  }
}
