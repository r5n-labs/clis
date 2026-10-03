import type { SourceFile, SourceTarget } from "../../domain/source-target";
import { checksum } from "../../storage/fingerprints";

const OVERVIEW_SHARE = 0.4;
const SOURCE_ALLOWANCE = 65_000;
const INVENTORY_SHARE = 0.5;

export function architectureTarget(
  target: SourceTarget,
  file: SourceFile | undefined,
  requestBytes: number,
): SourceTarget {
  const allowance = Math.min(SOURCE_ALLOWANCE, Math.floor(requestBytes * OVERVIEW_SHARE));
  if (target.group !== "classes" || Buffer.byteLength(JSON.stringify(target.source)) <= allowance || !file)
    return target;
  const methods = file.targets.filter(
    (entry) => entry.group === "methods" && entry.line >= target.line && entry.endLine <= target.endLine,
  );
  const parts = [
    "PARTIAL ARCHITECTURE OVERVIEW — not the complete class implementation.",
    `Class: ${target.owner}.${target.name}; lines ${target.line}–${target.endLine}; complete-source SHA-256: ${checksum(target.source)}`,
    "Judge ownership only where declarations, dependency inventory and included bodies provide evidence. Omitted bodies are unknown, not evidence of good or bad ownership. Use insufficient_context if they are necessary.",
  ];
  let bytes = Buffer.byteLength(JSON.stringify(parts));
  const append = (text: string, limit = allowance) => {
    const size = Buffer.byteLength(JSON.stringify(text));
    if (bytes + size > limit) return false;
    parts.push(text);
    bytes += size;
    return true;
  };
  if (target.documentation) append(target.documentation);
  let omittedDeclarations = 0;
  for (const declaration of target.declarations)
    if (!append(declaration, allowance * INVENTORY_SHARE)) omittedDeclarations++;
  let omittedInventory = 0;
  for (const method of methods) {
    const inventory = `${method.owner}.${method.name} [${method.line}–${method.endLine}]; calls: ${method.calls.join(", ")}; references: ${method.references.join(", ")}`;
    if (!append(inventory, allowance * INVENTORY_SHARE)) omittedInventory++;
  }
  const included: SourceTarget[] = [];
  for (const method of [...methods].sort((a, b) => a.source.length - b.source.length || a.line - b.line)) {
    if (append(`Complete method at ${method.path}:${method.line}\n${method.source}`)) included.push(method);
  }
  parts.push(
    `Coverage: ${included.length}/${methods.length} complete method bodies included. ${methods.length - included.length} bodies, ${omittedInventory} inventory entries and ${omittedDeclarations} declarations omitted by the byte allowance. The full-source fingerprint includes omitted code.`,
  );
  return { ...target, source: parts.join("\n\n") };
}
