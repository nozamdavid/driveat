import { parseErrorBody } from "./internal-error-body.js";

export type PersonalSpaceCapability =
  | Readonly<{ status: "available" }>
  | Readonly<{
      status: "permission-denied";
      httpStatus: 401 | 403;
      error?: string;
      message?: string;
      wwwAuthenticate?: string;
    }>
  | Readonly<{ status: "unsupported" }>
  | Readonly<{ status: "unavailable"; httpStatus: number }>;

export type AuthenticatedFetch = (pathname: string, init?: RequestInit) => Promise<Response>;

export async function probePersonalSpaceCapability(
  authenticatedFetch: AuthenticatedFetch,
  spaceType: string,
  ownerDid: string,
): Promise<PersonalSpaceCapability> {
  const query = new URLSearchParams({ type: spaceType, did: ownerDid });
  const response = await authenticatedFetch(
    `/xrpc/com.atproto.space.listSpaces?${query.toString()}`,
    { method: "GET" },
  );

  if (response.ok) return { status: "available" };
  if (response.status === 401 || response.status === 403) {
    const body = await parseErrorBody(response);
    const error = typeof body.error === "string" ? body.error : undefined;
    const message = typeof body.message === "string" ? body.message : undefined;
    const wwwAuthenticate = response.headers.get("www-authenticate") ?? undefined;
    return {
      status: "permission-denied",
      httpStatus: response.status,
      ...(error ? { error } : {}),
      ...(message ? { message } : {}),
      ...(wwwAuthenticate ? { wwwAuthenticate } : {}),
    };
  }
  if (response.status === 404 || response.status === 501) {
    return { status: "unsupported" };
  }
  return { status: "unavailable", httpStatus: response.status };
}
