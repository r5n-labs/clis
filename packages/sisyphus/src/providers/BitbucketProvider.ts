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

  private notImplemented(): never {
    throw new Exit("Bitbucket is not supported yet", "Bitbucket support is coming soon");
  }

  async ensureAvailable(): Promise<void> {
    this.notImplemented();
  }

  async getDefaultBranch(): Promise<string> {
    this.notImplemented();
  }

  async findPr(_options: FindPrOptions): Promise<PullRequest | null> {
    this.notImplemented();
  }

  async createPr(_options: CreatePrOptions): Promise<PullRequest> {
    this.notImplemented();
  }

  async updatePr(_number: number, _options: UpdatePrOptions): Promise<void> {
    this.notImplemented();
  }

  async getPr(_number: number): Promise<PullRequest> {
    this.notImplemented();
  }

  async getPrFromCurrentBranch(): Promise<PullRequest> {
    this.notImplemented();
  }

  async getPrCommits(_number: number): Promise<string[]> {
    this.notImplemented();
  }

  async ensureLabelExists(_name: string, _options?: CreateLabelOptions): Promise<void> {
    this.notImplemented();
  }

  async createRelease(_options: CreateReleaseOptions): Promise<void> {
    this.notImplemented();
  }

  async deleteRelease(_tag: string): Promise<void> {
    this.notImplemented();
  }
}
