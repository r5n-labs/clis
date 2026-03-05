export type CommitInfo = {
  hash: string;
  subject: string;
  body?: string;
  type: string;
  scope?: string;
  message: string;
  packages: string[];
};
