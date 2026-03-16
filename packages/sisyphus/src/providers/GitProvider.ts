export type MergeMethod = "merge" | "squash" | "rebase";

export type PullRequest = {
  number: number;
  url: string;
  title: string;
  body: string;
  labels: string[];
  author: string;
  headBranch: string;
  baseBranch: string;
  merged: boolean;
  mergeCommitSha: string | null;
};

export type CreatePrOptions = { head: string; base: string; title: string; body: string; labels?: string[] };

export type UpdatePrOptions = { title?: string; body?: string };

export type FindPrOptions = { head?: string; label?: string };

export type CreateLabelOptions = { description?: string; color?: string };

export type CreateReleaseOptions = { tag: string; title: string; notes: string };

export type Provider = "github" | "gitlab" | "bitbucket";

export type RemoteInfo = { provider: Provider; owner: string; repo: string };

export type PrUrlInfo = { provider: Provider; owner: string; repo: string; number: number };

export abstract class GitProvider {
  abstract readonly name: Provider;

  protected owner: string;
  protected repo: string;

  constructor(info: RemoteInfo) {
    this.owner = info.owner;
    this.repo = info.repo;
  }

  abstract ensureAvailable(): Promise<void>;

  abstract getDefaultBranch(): Promise<string>;

  abstract findPr(options: FindPrOptions): Promise<PullRequest | null>;
  abstract createPr(options: CreatePrOptions): Promise<PullRequest>;
  abstract updatePr(number: number, options: UpdatePrOptions): Promise<void>;
  abstract getPr(number: number): Promise<PullRequest>;
  abstract getPrFromCurrentBranch(): Promise<PullRequest>;
  abstract getPrCommits(number: number): Promise<string[]>;
  abstract getPrFiles(number: number): Promise<string[]>;

  abstract ensureLabelExists(name: string, options?: CreateLabelOptions): Promise<void>;

  abstract createRelease(options: CreateReleaseOptions): Promise<void>;
  abstract deleteRelease(tag: string): Promise<void>;
}
