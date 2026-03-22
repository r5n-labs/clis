import { describe, expect, test } from "bun:test";
import { Commit, OTHER_COMMIT_TYPE } from "../../src/domain/Commit";
import type { CommitInfo } from "../../src/domain/Commit";

const HASH = "abc1234567890def";

describe("Commit.parse", () => {
  test("parses standard feat commit", () => {
    const commit = Commit.parse(HASH, "feat: add feature");

    expect(commit.type).toBe("feat");
    expect(commit.message).toBe("add feature");
    expect(commit.breaking).toBe(false);
    expect(commit.scope).toBeUndefined();
    expect(commit.subject).toBe("feat: add feature");
    expect(commit.hash).toBe(HASH);
    expect(commit.files).toEqual([]);
  });

  test("parses standard fix commit", () => {
    const commit = Commit.parse(HASH, "fix: resolve bug");

    expect(commit.type).toBe("fix");
    expect(commit.message).toBe("resolve bug");
    expect(commit.breaking).toBe(false);
  });

  test("parses commit with scope", () => {
    const commit = Commit.parse(HASH, "feat(api): add endpoint");

    expect(commit.type).toBe("feat");
    expect(commit.scope).toBe("api");
    expect(commit.message).toBe("add endpoint");
    expect(commit.breaking).toBe(false);
  });

  test("parses breaking change with !", () => {
    const commit = Commit.parse(HASH, "feat!: breaking change");

    expect(commit.type).toBe("feat");
    expect(commit.breaking).toBe(true);
    expect(commit.message).toBe("breaking change");
  });

  test("parses breaking change with scope and !", () => {
    const commit = Commit.parse(HASH, "feat(api)!: break it");

    expect(commit.type).toBe("feat");
    expect(commit.scope).toBe("api");
    expect(commit.breaking).toBe(true);
    expect(commit.message).toBe("break it");
  });

  describe("all known commit types", () => {
    const knownTypes = ["build", "chore", "ci", "docs", "feat", "fix", "perf", "refactor", "style", "test"];

    for (const type of knownTypes) {
      test(`recognizes "${type}" as conventional type`, () => {
        const commit = Commit.parse(HASH, `${type}: some message`);

        expect(commit.type).toBe(type);
        expect(commit.message).toBe("some message");
        expect(commit.isConventional).toBe(true);
      });
    }
  });

  test("unknown type falls back to OTHER_COMMIT_TYPE", () => {
    const commit = Commit.parse(HASH, "unknown: something");

    expect(commit.type).toBe(OTHER_COMMIT_TYPE);
    expect(commit.type).toBe("other");
    expect(commit.message).toBe("unknown: something");
  });

  test("non-conventional commit falls back to OTHER_COMMIT_TYPE", () => {
    const commit = Commit.parse(HASH, "just a message");

    expect(commit.type).toBe(OTHER_COMMIT_TYPE);
    expect(commit.message).toBe("just a message");
    expect(commit.subject).toBe("just a message");
  });

  test("commit with colon but no known type falls back to OTHER_COMMIT_TYPE", () => {
    const commit = Commit.parse(HASH, "WIP: work in progress");

    expect(commit.type).toBe(OTHER_COMMIT_TYPE);
    expect(commit.message).toBe("WIP: work in progress");
  });

  test("empty subject edge case", () => {
    const commit = Commit.parse(HASH, "");

    expect(commit.type).toBe(OTHER_COMMIT_TYPE);
    expect(commit.message).toBe("");
    expect(commit.subject).toBe("");
    expect(commit.breaking).toBe(false);
  });
});

describe("Commit getters", () => {
  test("shortHash returns first 7 characters", () => {
    const commit = Commit.parse(HASH, "feat: something");

    expect(commit.shortHash).toBe("abc1234");
    expect(commit.shortHash).toHaveLength(7);
  });

  test("shortHash works with exactly 7 char hash", () => {
    const commit = Commit.parse("abc1234", "feat: something");

    expect(commit.shortHash).toBe("abc1234");
  });

  test("isConventional returns true for known types", () => {
    const commit = Commit.parse(HASH, "feat: something");

    expect(commit.isConventional).toBe(true);
  });

  test("isConventional returns false for other type", () => {
    const commit = Commit.parse(HASH, "random message");

    expect(commit.isConventional).toBe(false);
  });
});

describe("Commit.withFiles", () => {
  test("returns new Commit with files set", () => {
    const original = Commit.parse(HASH, "feat: something");
    const files = ["src/index.ts", "src/utils.ts"];
    const withFiles = original.withFiles(files);

    expect(withFiles.files).toEqual(files);
    expect(withFiles.type).toBe("feat");
    expect(withFiles.message).toBe("something");
    expect(withFiles.hash).toBe(HASH);
    // Original is unchanged
    expect(original.files).toEqual([]);
  });
});

describe("Commit.withBody", () => {
  test("returns new Commit with body set", () => {
    const original = Commit.parse(HASH, "feat: something");
    const withBody = original.withBody("detailed description");

    expect(withBody.body).toBe("detailed description");
    expect(withBody.type).toBe("feat");
    expect(withBody.message).toBe("something");
    // Original is unchanged
    expect(original.body).toBeUndefined();
  });

  test("returns new Commit with undefined body", () => {
    const original = Commit.parse(HASH, "feat: something").withBody("some body");
    const withoutBody = original.withBody(undefined);

    expect(withoutBody.body).toBeUndefined();
  });
});

describe("Commit.toInfo", () => {
  test("returns CommitInfo with correct fields", () => {
    const commit = Commit.parse(HASH, "feat(api): add endpoint").withBody("some body").withFiles(["src/api.ts"]);

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
    const commit = Commit.parse(HASH, "just a message");

    const info = commit.toInfo([]);

    expect(info.type).toBe("other");
    expect(info.message).toBe("just a message");
    expect(info.hash).toBe("abc1234");
    expect(info.packages).toEqual([]);
    expect(info.scope).toBeUndefined();
    expect(info.body).toBeUndefined();
  });
});
