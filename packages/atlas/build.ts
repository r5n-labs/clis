import { bunPackageBuilder } from "@r5n/tools/builder";

await bunPackageBuilder({
  banner: "#!/usr/bin/env bun",
  maxSize: "xs",
  packages: "bundle",
  target: "bun",
  type: "cli",
});
