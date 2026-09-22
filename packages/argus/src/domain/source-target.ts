import type { AnalysisServices } from "../analysis/contracts";
import type { TargetGroup } from "./question";

export type SourceTarget = {
  id: string;
  group: TargetGroup;
  path: string;
  owner: string;
  name: string;
  line: number;
  endLine: number;
  source: string;
  comments: string;
  declarations: string[];
  references: string[];
  calls: string[];
  documentation?: string;
  strings?: string[];
  translation?: { id: string; context: string };
  changeContext?: { before: Project; after: Project };
};
export type SourceFile = {
  adapterId: string;
  language: string;
  path: string;
  source: string;
  references: string[];
  targets: SourceTarget[];
};
export type Project = {
  root: string;
  files: ReadonlyMap<string, SourceFile>;
  targets: SourceTarget[];
  analysis: AnalysisServices;
  configuration: ReadonlyMap<string, string>;
};
