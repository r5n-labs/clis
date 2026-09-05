import { cp } from "node:fs/promises";
import { bunPackageBuilder } from "@r5n/tools/builder";

const MAX_CLI_SIZE_KB = 272;

await bunPackageBuilder({
  banner: "#!/usr/bin/env bun",
  maxSize: MAX_CLI_SIZE_KB,
  packages: "bundle",
  target: "bun",
  type: "cli",
});

await cp("src/commands/actions/templates", "dist/templates", { recursive: true });
