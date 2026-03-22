import { bunPackageBuilder } from "@r5n/tools/builder";

await bunPackageBuilder({
  banner: "#!/usr/bin/env bun",
  maxSize: 100,
  packages: "bundle",
  target: "bun",
  type: "cli",
});
