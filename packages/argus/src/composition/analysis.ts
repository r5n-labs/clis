import { AnalysisRegistry } from "../analysis/AnalysisRegistry";
import { GettextAdapter } from "../formats/gettext/GettextAdapter";
import { GodotResourceAdapter } from "../formats/godot-resource/GodotResourceAdapter";
import { TextAdapter } from "../formats/TextAdapter";
import { GodotIntegration } from "../frameworks/godot/GodotIntegration";
import { GodotRuntime } from "../frameworks/godot/GodotRuntime";
import { TestRunnerConvention } from "../frameworks/test-runners/TestRunnerConvention";
import { GDScriptAdapter } from "../languages/gdscript/GDScriptAdapter";
import { TypeScriptAdapter } from "../languages/typescript/TypeScriptAdapter";
import { ArchitectureContextPolicy } from "../reviews/architecture/ArchitectureContextPolicy";
import { TranslationEvidence } from "../reviews/translations/TranslationEvidence";

export function createAnalysis(): AnalysisRegistry {
  return new AnalysisRegistry({
    adapters: [
      new GDScriptAdapter((project) => new GodotRuntime(project)),
      new TypeScriptAdapter([
        new TestRunnerConvention("bun:test"),
        new TestRunnerConvention("vitest"),
        new TestRunnerConvention("@jest/globals"),
      ]),
      new GettextAdapter(),
      new GodotResourceAdapter(),
    ],
    fallback: new TextAdapter(),
    frameworks: [new GodotIntegration()],
    reviews: [new TranslationEvidence()],
    policies: [new ArchitectureContextPolicy()],
  });
}
