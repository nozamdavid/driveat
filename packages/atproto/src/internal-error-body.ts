export type ErrorBody = Readonly<{ error?: unknown; message?: unknown }>;

export async function parseErrorBody(response: Response): Promise<ErrorBody> {
  try {
    const body: unknown = await response.clone().json();
    if (typeof body === "object" && body !== null) return body as ErrorBody;
  } catch {
    // Some upstream errors have an empty or plain-text body.
  }
  return {};
}
