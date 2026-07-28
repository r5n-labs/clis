export async function runInContext<T>(fn: () => Promise<T>, context: string): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    const detail = getErrorDetail(error);
    throw new Error(detail ? `${context}: ${detail}` : context);
  }
}

export function getErrorDetail(error: unknown): string {
  const stderr = getStderr(error);
  if (stderr) return stderr;
  return error instanceof Error ? error.message : String(error);
}

function getStderr(error: unknown): string | undefined {
  if (error && typeof error === "object" && "stderr" in error) {
    const stderr = error.stderr;
    if (stderr instanceof Buffer) return stderr.toString().trim();
    if (typeof stderr === "string") return stderr.trim();
  }
  return undefined;
}
