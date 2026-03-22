import { Exit } from "@r5n/cli-core";
import {
  type CreateLabelOptions,
  type CreatePrOptions,
  type CreateReleaseOptions,
  type FindPrOptions,
  GitProvider,
  type PullRequest,
  type UpdatePrOptions,
} from "./GitProvider";

export class BitbucketProvider extends GitProvider {
  readonly name = "bitbucket" as const;

  // Gate: ensureAvailable() is always called first, preventing any other method from executing
  async ensureAvailable(): Promise<void> {
    throw new Exit("Bitbucket is not supported yet", "Use GitHub or GitLab instead");
  }

  // Abstract method stubs — unreachable after ensureAvailable() throws
  async getDefaultBranch(): Promise<string> { throw this.unreachable(); }
  async findPr(_options: FindPrOptions): Promise<PullRequest | null> { throw this.unreachable(); }
  async createPr(_options: CreatePrOptions): Promise<PullRequest> { throw this.unreachable(); }
  async updatePr(_number: number, _options: UpdatePrOptions): Promise<void> { throw this.unreachable(); }
  async getPr(_number: number): Promise<PullRequest> { throw this.unreachable(); }
  async getPrFromCurrentBranch(): Promise<PullRequest> { throw this.unreachable(); }
  async getPrCommits(_number: number): Promise<string[]> { throw this.unreachable(); }
  async getPrFiles(_number: number): Promise<string[]> { throw this.unreachable(); }
  async ensureLabelExists(_name: string, _options?: CreateLabelOptions): Promise<void> { throw this.unreachable(); }
  async createRelease(_options: CreateReleaseOptions): Promise<void> { throw this.unreachable(); }
  async deleteRelease(_tag: string): Promise<void> { throw this.unreachable(); }

  private unreachable(): Error {
    return new Error("BitbucketProvider: method called without ensureAvailable() check");
  }
}
