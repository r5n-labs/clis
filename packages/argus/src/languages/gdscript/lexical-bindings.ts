import type { SourceBinding, SourceName } from "./symbols";

export function localBinding(name: SourceName, bindings: readonly SourceBinding[]): SourceBinding | undefined {
  let nearest: SourceBinding | undefined;
  for (const binding of bindings) {
    const scope = binding.scope;
    if (
      binding.name !== name.name ||
      !scope ||
      name.position < scope.available ||
      name.position < scope.start ||
      name.position >= scope.end
    )
      continue;
    if (!nearest?.scope || scope.start >= nearest.scope.start) nearest = binding;
  }
  return nearest;
}
