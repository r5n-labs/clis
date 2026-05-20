import { bunPackageBuilder } from "@r5n/tools/builder";

await bunPackageBuilder({ banner: "#!/usr/bin/env bun", maxSize: "s", packages: "bundle", target: "bun", type: "cli" });
