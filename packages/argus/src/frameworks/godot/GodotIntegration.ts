import type { EvidenceSink, FrameworkIntegration } from "../../analysis/contracts";
import type { Project, SourceTarget } from "../../domain/source-target";
import { sceneWiring } from "../../formats/godot-resource/records";
import { scenesForScript } from "./project-links";

export class GodotIntegration implements FrameworkIntegration {
  readonly id = "godot";
  readonly configurationFiles = ["project.godot"];

  contribute(project: Project, target: SourceTarget, evidence: EvidenceSink): void {
    for (const scene of scenesForScript(project, target.path))
      evidence.add(scene.path, `Scene wiring (subresource definitions omitted):\n${sceneWiring(scene)}`);
  }
}
