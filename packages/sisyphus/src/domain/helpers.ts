export const nonEmpty = <T>(arr: readonly T[]) => (arr.length > 0 ? arr : undefined);
