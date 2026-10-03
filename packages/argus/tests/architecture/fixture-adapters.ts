import type { EvidenceSink, FrameworkIntegration, SourceCapabilities } from "../../src/analysis/contracts";
import { SourceAdapter } from "../../src/analysis/contracts";
import type { Project, SourceFile, SourceTarget } from "../../src/domain/source-target";

export const FIXTURE_CONFIG = "app.runtime";

export class FixtureFramework implements FrameworkIntegration {
  readonly id = "fixture-runtime";
  readonly configurationFiles = [FIXTURE_CONFIG];

  contribute(project: Project, _target: SourceTarget, evidence: EvidenceSink): void {
    const source = project.configuration.get(FIXTURE_CONFIG);
    if (source) evidence.add(FIXTURE_CONFIG, source);
  }
}

function target(path: string, source: string, name: string): SourceTarget {
  return {
    id: `methods:${path}:${name}`,
    group: "methods",
    path,
    owner: path,
    name,
    line: 1,
    endLine: source.split("\n").length,
    source,
    comments: "",
    declarations: [],
    references: [],
    calls: [],
  };
}

export class TypeScriptFixtureAdapter extends SourceAdapter {
  readonly id = "typescript-fixture";
  readonly language = "TypeScript fixture";

  supports(path: string): boolean {
    return path.endsWith(".ts");
  }

  async parse(path: string, source: string): Promise<SourceFile> {
    const name = /export function (\w+)\(/.exec(source)?.[1];
    if (!name) throw new Error("Fixture requires one exported function");
    const method = target(path, source, name);
    const references = [...source.matchAll(/from "\.\/([^"]+)"/g)].flatMap((match) => (match[1] ? [match[1]] : []));
    return {
      path,
      source,
      adapterId: this.id,
      language: this.language,
      references,
      targets: [method, { ...method, id: `files:${path}`, group: "files" }],
    };
  }

  createContext(project: Project): SourceCapabilities {
    return {
      references: {
        select: (target, options) => {
          const related = new Map<string, string>();
          if (options.depth !== 0)
            for (const path of project.files.get(target.path)?.references ?? []) {
              const file = project.files.get(path);
              if (file) related.set(path, file.source);
            }
          return { source: target.source, related, scope: "Fixture imports only" };
        },
        usages: () => [],
      },
      literalUsages: (literal) =>
        project.targets
          .filter((entry) => entry.group === "methods" && entry.source.includes(JSON.stringify(literal)))
          .map((entry) => ({
            target: entry,
            source: entry.source,
            containsLiteral: (value) => entry.source.includes(JSON.stringify(value)),
            related: [],
          })),
    };
  }
}

export class CatalogueFixtureAdapter extends SourceAdapter {
  readonly id = "catalogue-fixture";
  readonly language = "Fixture catalogue";

  supports(path: string): boolean {
    return path.endsWith(".catalogue");
  }

  async parse(path: string, source: string): Promise<SourceFile> {
    const entry = target(path, source, "screen.title");
    return {
      path,
      source,
      adapterId: this.id,
      language: this.language,
      references: [],
      targets: [
        {
          ...entry,
          id: `translations:${path}`,
          group: "translations",
          translation: { id: "screen.title", context: "" },
        },
      ],
    };
  }

  createContext(): SourceCapabilities {
    return {};
  }
}
