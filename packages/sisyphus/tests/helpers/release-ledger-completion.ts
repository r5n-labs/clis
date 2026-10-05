import { mock } from "bun:test";
import fs from "node:fs";
import { join } from "node:path";
import { type CreateReleaseLedgerInput, ReleaseLedger } from "../../src/services/release-ledger";

const [root, serializedFirstInput, serializedNextInput] = process.argv.slice(2);
if (!root || !serializedFirstInput || !serializedNextInput) {
  throw new Error("Expected repository, first ledger input and next ledger input");
}
const firstInput = JSON.parse(serializedFirstInput) as CreateReleaseLedgerInput;
const nextInput = JSON.parse(serializedNextInput) as CreateReleaseLedgerInput;
const first = await ReleaseLedger.create(firstInput, root);
const firstHistoryPath = join(first.releaseDirectory, "history", `${first.id}.json`);
const originalRename = fs.promises.rename;
let intercepted = false;
let nextCreated = false;
const barrierRename: typeof fs.promises.rename = async (from, to) => {
  if (!intercepted && from === first.activePath && to === firstHistoryPath) {
    intercepted = true;
    const competing = await ReleaseLedger.loadActive(root);
    if (!competing) throw new Error("Expected completed active ledger");
    try {
      await competing.complete();
      await ReleaseLedger.create(nextInput, root);
      nextCreated = true;
    } catch (error) {
      if (!(error instanceof Error) || !error.message.includes("lock owner is still live")) throw error;
    }
  }
  await originalRename(from, to);
};

mock.module("node:fs/promises", () => ({ ...fs.promises, rename: barrierRename }));
try {
  const history = await first.complete();
  if (!nextCreated) await ReleaseLedger.create(nextInput, root);
  console.log(
    JSON.stringify({
      intercepted,
      active: (await ReleaseLedger.loadActive(root))?.data ?? null,
      history: JSON.parse(fs.readFileSync(history, "utf8")),
    }),
  );
} finally {
  mock.restore();
}
