import { describe, expect, test } from "bun:test";
import { OTHER_COMMIT_TYPE } from "../../src/constants";
import type { CommitInfo } from "../../src/domain/Commit";
import { Commit } from "../../src/domain/Commit";

const HASH = "abc1234567890def";
const AUTHOR = "test-author";

describe("Commit.parse", () => {
  test("parses standard feat commit", () => {
    const commit = Commit.parse(HASH, "feat: add feature", AUTHOR);

    expect(commit).toMatchObject({
      breaking: false,
      files: [],
      hash: HASH,
      message: "add feature",
      scope: undefined,
      subject: "feat: add feature",
      type: "feat",
    });
  });

  test("parses standard fix commit", () => {
    const commit = Commit.parse(HASH, "fix: resolve bug", AUTHOR);

    expect(commit).toMatchObject({ breaking: false, message: "resolve bug", type: "fix" });
  });

  test("parses commit with scope", () => {
    const commit = Commit.parse(HASH, "feat(api): add endpoint", AUTHOR);

    expect(commit).toMatchObject({ breaking: false, message: "add endpoint", scope: "api", type: "feat" });
  });

  test("parses breaking change with !", () => {
    const commit = Commit.parse(HASH, "feat!: breaking change", AUTHOR);

    expect(commit).toMatchObject({ breaking: true, message: "breaking change", type: "feat" });
  });

  test("parses breaking change with scope and !", () => {
    const commit = Commit.parse(HASH, "feat(api)!: break it", AUTHOR);

    expect(commit).toMatchObject({ breaking: true, message: "break it", scope: "api", type: "feat" });
  });

  describe("all known commit types", () => {
    const knownTypes = ["build", "chore", "ci", "docs", "feat", "fix", "perf", "refactor", "style", "test"];

    for (const type of knownTypes) {
      test(`recognizes "${type}" as conventional type`, () => {
        const commit = Commit.parse(HASH, `${type}: some message`, AUTHOR);

        expect(commit).toMatchObject({ isConventional: true, message: "some message", type });
      });
    }
  });

  test("unknown type falls back to OTHER_COMMIT_TYPE", () => {
    const commit = Commit.parse(HASH, "unknown: something", AUTHOR);

    expect(commit).toMatchObject({ message: "unknown: something", type: OTHER_COMMIT_TYPE });
  });

  test("non-conventional commit falls back to OTHER_COMMIT_TYPE", () => {
    const commit = Commit.parse(HASH, "just a message", AUTHOR);

    expect(commit).toMatchObject({ message: "just a message", subject: "just a message", type: OTHER_COMMIT_TYPE });
  });

  test("commit with colon but no known type falls back to OTHER_COMMIT_TYPE", () => {
    const commit = Commit.parse(HASH, "WIP: work in progress", AUTHOR);

    expect(commit).toMatchObject({ message: "WIP: work in progress", type: OTHER_COMMIT_TYPE });
  });

  test("empty subject edge case", () => {
    const commit = Commit.parse(HASH, "", AUTHOR);

    expect(commit).toMatchObject({ breaking: false, message: "", subject: "", type: OTHER_COMMIT_TYPE });
  });
});

describe("Commit getters", () => {
  test("shortHash returns first 7 characters", () => {
    expect(Commit.parse(HASH, "feat: something", AUTHOR).shortHash).toBe("abc1234");
  });

  test("shortHash works with exactly 7 char hash", () => {
    expect(Commit.parse("abc1234", "feat: something", AUTHOR).shortHash).toBe("abc1234");
  });

  test("isConventional returns true for known types", () => {
    expect(Commit.parse(HASH, "feat: something", AUTHOR).isConventional).toBe(true);
  });

  test("isConventional returns false for other type", () => {
    expect(Commit.parse(HASH, "random message", AUTHOR).isConventional).toBe(false);
  });
});

describe("Commit.withFiles", () => {
  test("returns new Commit with files set, original unchanged", () => {
    const original = Commit.parse(HASH, "feat: something", AUTHOR);
    const files = ["src/index.ts", "src/utils.ts"];
    const withFiles = original.withFiles(files);

    expect(withFiles).toMatchObject({ files, hash: HASH, message: "something", type: "feat" });
    expect(original.files).toEqual([]);
  });
});

describe("Commit.withBody", () => {
  test("returns new Commit with body set, original unchanged", () => {
    const original = Commit.parse(HASH, "feat: something", AUTHOR);
    const withBody = original.withBody("detailed description");

    expect(withBody).toMatchObject({ body: "detailed description", message: "something", type: "feat" });
    expect(original.body).toBeUndefined();
  });

  test("withBody(undefined) clears the body", () => {
    const original = Commit.parse(HASH, "feat: something", AUTHOR).withBody("some body");

    expect(original.withBody(undefined).body).toBeUndefined();
  });
});

describe("Commit.toInfo", () => {
  test("returns CommitInfo with correct fields", () => {
    const commit = Commit.parse(HASH, "feat(api): add endpoint", AUTHOR)
      .withBody("some body")
      .withFiles(["src/api.ts"]);
    const info: CommitInfo = commit.toInfo(["@org/api"]);

    expect(info).toEqual({
      body: "some body",
      hash: "abc1234",
      message: "add endpoint",
      packages: ["@org/api"],
      scope: "api",
      subject: "feat(api): add endpoint",
      type: "feat",
    });
  });

  test("returns CommitInfo for non-conventional commit", () => {
    const info = Commit.parse(HASH, "just a message", AUTHOR).toInfo([]);

    expect(info).toEqual({
      body: undefined,
      hash: "abc1234",
      message: "just a message",
      packages: [],
      scope: undefined,
      subject: "just a message",
      type: "other",
    });
  });
});
