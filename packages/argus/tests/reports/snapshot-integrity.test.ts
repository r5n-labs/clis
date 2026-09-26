import { expect, test } from "bun:test";
import { realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { reportData } from "../../src/reports/report-data";
import { checksum } from "../../src/storage/fingerprints";
import { ReviewSnapshotStore } from "../../src/verification/ReviewSnapshotStore";
import { VerificationStore } from "../../src/verification/VerificationStore";
import { fixture } from "../helpers";

const ORIGINAL_BYTES = Buffer.from([0x63, 0x61, 0x66, 0xe9]);
const CHANGED_BYTES = Buffer.from([0x63, 0x61, 0x66, 0xf1]);
const NUL_BYTES = Buffer.from([0x61, 0x00, 0x62]);

async function snapshotFixture() {
  const f = fixture();
  f.loaded.root = realpathSync(f.loaded.root);
  f.loaded.config.root = f.loaded.root;
  f.write("example.gd", "func value():\n    return 1\n");
  const evidencePath = join(f.loaded.root, "guide.txt");
  writeFileSync(evidencePath, ORIGINAL_BYTES);
  const report = reportData(await f.plan(), 0);
  const snapshots = new ReviewSnapshotStore(f.loaded);
  snapshots.save(report, snapshots.captureFiles());
  const item = report.results[0];
  if (!item) throw new Error("Missing review");
  const submission = {
    version: 2,
    snapshotId: report.snapshotId,
    reviewer: { model: "fixture", promptVersion: "v1" },
    verdicts: [
      { reviewId: item.reviewId, verdict: "confirmed", rationale: "Inspected guide", evidence: ["guide.txt"] },
    ],
  };
  const store = new VerificationStore(f.loaded.root, join(f.loaded.stateDir, "verifications"));
  return { ...f, evidencePath, item, report, snapshots, store, submission };
}

test("snapshot submissions reject changed supplementary bytes with identical decoded text", async () => {
  const f = await snapshotFixture();
  expect(ORIGINAL_BYTES.toString()).toBe(CHANGED_BYTES.toString());
  writeFileSync(f.evidencePath, CHANGED_BYTES);
  expect(() => f.store.import(f.snapshots.resolve(f.submission), f.report)).toThrow("evidence changed");
});

test("saved verdicts accept unchanged non-UTF-8 evidence and expire when its bytes change", async () => {
  const f = await snapshotFixture();
  expect(f.store.import(f.snapshots.resolve(f.submission), f.report)).toBe(1);
  f.store.apply(f.report);
  expect(f.item.verification?.verdict).toBe("confirmed");
  writeFileSync(f.evidencePath, CHANGED_BYTES);
  f.store.apply(f.report);
  expect(f.item.verification).toBeNull();
});

test("snapshot byte hashes preserve UTF-8 digests and exclude NUL-containing files", async () => {
  const f = await snapshotFixture();
  const text = "café";
  f.write("utf8.txt", text);
  writeFileSync(join(f.loaded.root, "binary.dat"), NUL_BYTES);
  const files = f.snapshots.captureFiles();
  expect(files["utf8.txt"]).toBe(checksum(text));
  expect(files["guide.txt"]).not.toBe(checksum(ORIGINAL_BYTES.toString()));
  expect(Object.hasOwn(files, "binary.dat")).toBe(false);
  const legacy = f.snapshots.resolve(f.submission);
  const evidence = legacy.verdicts[0]?.evidence[0];
  if (!evidence) throw new Error("Missing evidence");
  evidence.sha256 = checksum(ORIGINAL_BYTES.toString());
  expect(() => f.store.import(legacy, f.report)).toThrow("evidence changed");
});
