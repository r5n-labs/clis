export type CliMetadata = {
  name: string;
  bin?: string;
  version?: string;
  description?: string;
  promptMessage?: string;
  exitLabel?: string;
  exitHint?: string;
  goodbyeMessage?: string;
  clearOnStart?: boolean;
  onError?: (error: unknown) => boolean | undefined;
};
