import type { Project, SourceFile } from "../../domain/source-target";
import { attribute, parseResource, resourceSections } from "../../formats/godot-resource/parser";

export function autoloads(source: string): Record<string, string> {
  const section = parseResource("project.godot", source).find((entry) => entry.kind === "autoload");
  return Object.fromEntries(
    [...(section?.properties ?? [])].flatMap(([name, value]) =>
      value.string?.startsWith("*res://") ? [[name, value.string.slice(1)]] : [],
    ),
  );
}

export function attachedScript(
  project: Project,
  path: string,
  nodePath = ".",
  visited = new Set<string>(),
): string | undefined {
  const key = `${path}:${nodePath}`;
  if (visited.has(key)) return undefined;
  visited.add(key);
  const file = project.files.get(path);
  if (!file) return undefined;
  if (!file.path.endsWith(".tscn") && !file.path.endsWith(".tres")) return undefined;
  const records = resourceSections(file);
  const nodes = records.filter((entry) => entry.kind === "node" || entry.kind === "resource");
  const matches = nodes.filter((entry) => {
    if (nodePath === ".") return entry.kind === "resource" || attribute(entry, "parent") === undefined;
    const name = attribute(entry, "name");
    if (nodePath.startsWith("%"))
      return name === nodePath.slice(1) && entry.properties.get("unique_name_in_owner")?.text === "true";
    const parent = attribute(entry, "parent");
    return (parent === "." ? name : `${parent}/${name}`) === nodePath;
  });
  if (matches.length !== 1) return undefined;
  const node = matches[0];
  if (!node) return undefined;
  const script = node.properties.get("script")?.reference;
  const instance = node.attributes.get("instance")?.reference;
  const scriptId = script?.kind === "ext_resource" ? script.id : undefined;
  const instanceId = instance?.kind === "ext_resource" ? instance.id : undefined;
  const id = scriptId ?? instanceId;
  if (id === undefined) return undefined;
  const reference = records.find((entry) => entry.kind === "ext_resource" && attribute(entry, "id") === id);
  const resource = reference ? attribute(reference, "path") : undefined;
  if (!resource?.startsWith("res://")) return undefined;
  const resourcePath = resource.slice("res://".length);
  return scriptId ? resourcePath : attachedScript(project, resourcePath, ".", visited);
}

export function scenesForScript(project: Project, script: string): SourceFile[] {
  return [...project.files.values()].filter(
    (file) => file.path.endsWith(".tscn") && attachedScript(project, file.path) === script,
  );
}
