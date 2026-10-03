import type { SourceCapabilities } from "../../analysis/contracts";
import { SourceAdapter } from "../../analysis/contracts";
import type { SourceFile } from "../../domain/source-target";
import { translationTargets } from "./parser";

export class GettextAdapter extends SourceAdapter {
  readonly id = "gettext";
  readonly language = "GNU gettext catalogue";

  supports(path: string): boolean {
    return path.endsWith(".po");
  }

  async parse(path: string, source: string): Promise<SourceFile> {
    return this.sourceFile({ path, source, references: [], targets: translationTargets(path, source) });
  }

  createContext(): SourceCapabilities {
    return {};
  }
}
