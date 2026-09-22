import type { Project } from "../../domain/source-target";
import type { RuntimeResource, ScriptRuntime } from "../../languages/gdscript/runtime";
import { attachedScript, autoloads, scenesForScript } from "./project-links";

const PROJECT_FILE = "project.godot";
const RESOURCE_PREFIX = "res://";

export class GodotRuntime implements ScriptRuntime {
  private readonly singletons: Record<string, string>;

  constructor(private readonly project: Project) {
    this.singletons = autoloads(project.configuration.get(PROJECT_FILE) ?? "");
  }

  resource(reference: string): RuntimeResource | undefined {
    if (!reference.startsWith(RESOURCE_PREFIX)) return undefined;
    const path = reference.slice(RESOURCE_PREFIX.length);
    if (!this.project.files.has(path)) return undefined;
    return {
      path,
      kind: path.endsWith(".tscn") ? "scene" : path.endsWith(".tres") ? "resource" : "data",
      script: attachedScript(this.project, path),
    };
  }

  singleton(name: string) {
    const reference = this.singletons[name];
    return reference
      ? { reference, evidence: { path: PROJECT_FILE, source: `[autoload]\n${name}="*${reference}"` } }
      : undefined;
  }

  node(script: string, node: string) {
    const scenes = scenesForScript(this.project, script);
    const paths = new Set(scenes.map((scene) => attachedScript(this.project, scene.path, node)));
    const path = paths.size === 1 ? [...paths][0] : undefined;
    return path
      ? {
          reference: `${RESOURCE_PREFIX}${path}`,
          evidence: scenes.map((scene) => ({ path: scene.path, source: scene.source })),
        }
      : undefined;
  }
}
