import type { EvidenceSource } from "../../analysis/contracts";

export type RuntimeResource = { path: string; kind: "scene" | "resource" | "data"; script?: string };

export interface ScriptRuntime {
  resource(reference: string): RuntimeResource | undefined;
  singleton(name: string): { reference: string; evidence: EvidenceSource } | undefined;
  node(script: string, node: string): { reference: string; evidence: EvidenceSource[] } | undefined;
}

export class StandaloneRuntime implements ScriptRuntime {
  resource(): undefined {
    return undefined;
  }

  singleton(): undefined {
    return undefined;
  }

  node(): undefined {
    return undefined;
  }
}
