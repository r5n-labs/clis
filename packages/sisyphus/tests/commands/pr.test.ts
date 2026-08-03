import { describe, expect, test } from "bun:test";
import { intersectCommitPackages } from "../../src/commands/pr";
import type { CommitInfo } from "../../src/domain";

const makeCommit = (hash: string, packages: string[]): CommitInfo => ({
  hash,
  message: `fix: ${hash}`,
  packages,
  subject: `fix: ${hash}`,
  type: "fix",
});

describe("intersectCommitPackages", () => {
  test("keeps the full commit set unchanged when every package is selected", () => {
    const commits = [makeCommit("abc1234", ["@app/core", "@app/utils"]), makeCommit("def5678", ["@app/utils"])];

    const result = intersectCommitPackages(commits, ["@app/core", "@app/utils"]);

    expect(JSON.stringify(result)).toBe(JSON.stringify(commits));
  });

  test("narrows each commit's packages to the selected set", () => {
    const commits = [makeCommit("abc1234", ["@app/core", "@app/utils"])];

    const result = intersectCommitPackages(commits, ["@app/core"]);

    expect(result).toHaveLength(1);
    expect(result?.[0]?.packages).toEqual(["@app/core"]);
    expect(commits[0]?.packages).toEqual(["@app/core", "@app/utils"]);
  });

  test("drops commits whose packages were all de-selected", () => {
    const commits = [makeCommit("abc1234", ["@app/core"]), makeCommit("def5678", ["@app/utils"])];

    const result = intersectCommitPackages(commits, ["@app/core"]);

    expect(result).toHaveLength(1);
    expect(result?.[0]?.hash).toBe("abc1234");
  });

  test("normalizes empty results to undefined", () => {
    expect(intersectCommitPackages(undefined, ["@app/core"])).toBeUndefined();
    expect(intersectCommitPackages([], ["@app/core"])).toBeUndefined();
    expect(intersectCommitPackages([makeCommit("abc1234", ["@app/utils"])], ["@app/core"])).toBeUndefined();
  });
});
