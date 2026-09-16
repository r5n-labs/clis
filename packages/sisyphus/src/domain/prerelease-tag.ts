import { Exit } from "@r5n/cli-core";
import { fail, string } from "banditypes";

const PRERELEASE_TAG_PATTERN = /^[A-Za-z][0-9A-Za-z]*$/;
const prereleaseTagSchema = string().map((tag) => (PRERELEASE_TAG_PATTERN.test(tag) ? tag : fail()));

export function requirePrereleaseTag(value: unknown, message = "Invalid prerelease tag"): string {
  try {
    return prereleaseTagSchema(value);
  } catch {
    throw new Exit(message, "Start with a letter and use only letters or numbers");
  }
}
