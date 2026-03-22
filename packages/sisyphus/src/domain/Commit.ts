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
  author: string;
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
  readonly author: string;
  readonly body?: string;
  readonly type: string;
  readonly scope?: string;
  readonly breaking: boolean;
  readonly message: string;
  readonly files: string[];

  private constructor(options: CommitOptions) {
    this.hash = options.hash;
    this.subject = options.subject;
    this.author = options.author;
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
      const result = await Bun.$`git log -1 --pretty=format:"%H%x1f%s%x1f%an" ${hash}`.quiet();
      const output = result.stdout.toString().trim();
      if (!output) return null;

      const parts = output.split(FIELD_SEPARATOR);
      if (parts.length < 3) return null;
      const [fullHash, subject, author] = parts;
      if (!fullHash || !subject || !author) return null;

      return Commit.hydrate(fullHash, subject, author);
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
    // Single git call: hash, subject, author, body, and file names via --name-only.
    // %x00 as record separator between commits. Body can contain newlines, so we
    // rely on the blank-line separator that --name-only inserts before the file list.
    const format = "%x00%H%x1f%s%x1f%an%x1f%b";
    const result = await Bun.$`git log ${range} --pretty=format:${format} --name-only --no-merges`.quiet();
    const output = result.stdout.toString().trim();

    if (!output) return [];

    const commits: Commit[] = [];
    const records = output.split("\x00").filter(Boolean);

    for (const record of records) {
      const allLines = record.split("\n");
      const headerLine = allLines[0] ?? "";
      const headerParts = headerLine.split(FIELD_SEPARATOR);
      if (headerParts.length < 3) continue;

      const [hash, subject, author] = headerParts;
      if (!hash || !subject || !author) continue;

      // parts[3+] is the body (may contain field separators if body has them).
      // Subsequent lines until the blank line git inserts are also body lines.
      const bodyFirstLine = headerParts.slice(3).join(FIELD_SEPARATOR);
      const bodyLines: string[] = bodyFirstLine ? [bodyFirstLine] : [];

      let fileStartIndex = allLines.length;
      for (let i = 1; i < allLines.length; i++) {
        if (allLines[i] === "") {
          fileStartIndex = i + 1;
          break;
        }
        bodyLines.push(allLines[i]!);
      }

      const body = bodyLines.join("\n").trim() || undefined;
      const files = allLines.slice(fileStartIndex).filter(Boolean);

      const commit = Commit.parse(hash, subject, author).withFiles(files).withBody(body);
      commits.push(commit);
    }

    return commits;
  }

  // Used by fromHash for single-commit lookups
  private static async hydrate(hash: string, subject: string, author: string): Promise<Commit> {
    const files = await Commit.getFiles(hash);
    const body = await Commit.getBody(hash);

    return Commit.parse(hash, subject, author).withFiles(files).withBody(body);
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

  static parse(hash: string, subject: string, author: string): Commit {
    const match = subject.match(CONVENTIONAL_COMMIT_REGEX);

    if (match) {
      const [, type = "", scope, breaking, message = ""] = match;
      if (type && KNOWN_COMMIT_TYPES.has(type)) {
        return new Commit({ author, breaking: !!breaking, files: [], hash, message, scope, subject, type });
      }
    }

    return new Commit({ author, breaking: false, files: [], hash, message: subject, subject, type: OTHER_COMMIT_TYPE });
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
      author: this.author,
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
