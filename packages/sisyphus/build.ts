import { cp } from "node:fs/promises";
import { bunPackageBuilder } from "@r5n/tools/builder";

await bunPackageBuilder({ banner: "#!/usr/bin/env bun", maxSize: 210, packages: "bundle", target: "bun", type: "cli" });

await cp("src/commands/actions/templates", "dist/templates", { recursive: true });
