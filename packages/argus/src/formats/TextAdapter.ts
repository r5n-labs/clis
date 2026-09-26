import type { SourceCapabilities } from "../analysis/contracts";
import { SourceAdapter } from "../analysis/contracts";
import type { SourceFile } from "../domain/source-target";

export class TextAdapter extends SourceAdapter {
  readonly id: string = "text";
  readonly language = "Text";

  supports(): boolean {
    return true;
  }

  async parse(path: string, source: string): Promise<SourceFile> {
    return this.sourceFile({ path, source, references: [], targets: [] });
  }

  createContext(): SourceCapabilities {
    return {};
  }
}
