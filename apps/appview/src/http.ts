export function json(value: unknown, status = 200): Response {
  return Response.json(value, {
    status,
    headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" },
  });
}

export async function readJson<T>(request: Request): Promise<T> {
  const type = request.headers.get("content-type") ?? "";
  if (!type.toLowerCase().startsWith("application/json")) throw new HttpError(415, "expected-json");
  try {
    return (await request.json()) as T;
  } catch {
    throw new HttpError(400, "invalid-json");
  }
}

export class HttpError extends Error {
  constructor(readonly status: number, readonly code: string) { super(code); }
}

export function bearer(request: Request): string | undefined {
  return /^Bearer (.+)$/i.exec(request.headers.get("authorization") ?? "")?.[1];
}

export function errorResponse(error: unknown): Response {
  if (error instanceof HttpError) return json({ error: error.code }, error.status);
  console.error("media gateway request failed", error instanceof Error ? error.message : "unknown error");
  return json({ error: "internal-error" }, 500);
}
