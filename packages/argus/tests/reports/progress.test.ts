import { expect, test } from "bun:test";
import { Writable } from "node:stream";
import { ReviewProgress } from "../../src/reports/ReviewProgress";

function output(isTTY: boolean, columns = 80) {
  let text = "";
  const stream = Object.assign(
    new Writable({
      write(chunk, _encoding, callback) {
        text += chunk.toString();
        callback();
      },
    }),
    { isTTY, columns },
  );
  return { stream, text: () => text };
}

test("terminal progress redraws one line and records saved requests", async () => {
  const capture = output(true);
  await new ReviewProgress(capture.stream).track({
    model: "test-model",
    total: 4,
    async run(update) {
      update(1);
      expect(capture.text()).toContain("1/4 requests saved (25%)");
      expect(capture.text()).toContain("[======------------------]");
      update(4);
      expect(capture.text()).toContain("4/4 requests saved (100%)");
    },
  });
  expect(capture.text().match(/\n/g)).toHaveLength(2);
  expect(capture.text()).toContain("\u001b[2K");
  expect(capture.text()).toEndWith("Saved 4/4 requests\n");
});

test("redirected progress prints only start and finish without terminal escapes", async () => {
  const capture = output(false);
  await new ReviewProgress(capture.stream).track({
    model: "test-model",
    total: 3,
    async run(update) {
      update(1);
      update(2);
      update(3);
    },
  });
  expect(capture.text()).toBe("Reviewing 3 requests with test-model…\nSaved 3/3 requests\n");
});

test.each([true, false])(
  "failed reviews retain the saved count and propagate the original error (TTY: %s)",
  async (tty) => {
    const capture = output(tty);
    const error = new Error("API unavailable");
    const promise = new ReviewProgress(capture.stream).track({
      model: "test-model",
      total: 4,
      async run(update) {
        update(1);
        throw error;
      },
    });
    await expect(promise).rejects.toBe(error);
    expect(capture.text()).toEndWith("Stopped after saving 1/4 requests\n");
    expect(capture.text()).not.toContain("100%");
  },
);

test("narrow terminals omit the bar when only the count fits", async () => {
  const capture = output(true, 30);
  await new ReviewProgress(capture.stream).track({
    model: "test-model",
    total: 4805,
    async run(update) {
      update(48);
      expect(capture.text()).toContain("48/4805 requests saved (0%)");
      expect(capture.text()).not.toContain("[=");
    },
  });
});

test.each([true, false])("retry notices retain the saved progress count (TTY: %s)", async (tty) => {
  const capture = output(tty);
  const progress = new ReviewProgress(capture.stream);
  await progress.track({
    model: "test-model",
    total: 2,
    async run(update) {
      update(1);
      progress.retry({ reason: "Jev returned an invalid response", retry: 1, retries: 3, delayMs: 1000 });
      update(2);
    },
  });
  expect(capture.text()).toContain("Jev returned an invalid response; retry 1/3 in at least 1s…");
  expect(capture.text()).toEndWith("Saved 2/2 requests\n");
});
