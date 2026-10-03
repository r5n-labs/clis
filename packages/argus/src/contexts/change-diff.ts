import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { FileMode } from "../domain/source-target";
import { GIT_DIFFERENCES, git } from "../services/git-snapshot";

const REGULAR_MODE = 0o644;
const EXECUTABLE_MODE = 0o755;
type SnapshotFile = { source: string; mode: FileMode };

export async function changeDiff(path: string, before?: SnapshotFile, after?: SnapshotFile): Promise<string> {
  const directory = mkdtempSync(join(tmpdir(), "argus-diff-"));
  try {
    for (const [side, file] of [
      ["a", before],
      ["b", after],
    ] as const) {
      mkdirSync(join(directory, side));
      if (!file) continue;
      const target = join(directory, side, path);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, file.source);
      chmodSync(target, file.mode === "100755" ? EXECUTABLE_MODE : REGULAR_MODE);
    }
    return await git(
      directory,
      [
        "-c",
        "core.filemode=true",
        "diff",
        "--no-index",
        "--no-prefix",
        "--no-color",
        "--no-ext-diff",
        "--no-textconv",
        "--no-renames",
        "--unified=5",
        "--",
        "a",
        "b",
      ],
      GIT_DIFFERENCES,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}
