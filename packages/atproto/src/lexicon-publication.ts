import { parseErrorBody } from "./internal-error-body.js";

export type LexiconPublicationStatus =
  | Readonly<{ status: "published"; cid: string; uri: string }>
  | Readonly<{ status: "missing" }>
  | Readonly<{ status: "invalid-response"; httpStatus: number }>
  | Readonly<{ status: "unavailable"; httpStatus: number }>;

export type LexiconPublicationReport = Readonly<{
  complete: boolean;
  lexicons: Readonly<Record<string, LexiconPublicationStatus>>;
}>;

export type PublicFetch = (input: string, init?: RequestInit) => Promise<Response>;

type ResolvedLexicon = Readonly<{ cid: string; uri: string }>;

function isResolvedLexicon(value: unknown): value is ResolvedLexicon {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.cid === "string" && typeof candidate.uri === "string";
}

export async function verifyLexiconPublication(
  serviceUrl: string,
  nsids: readonly string[],
  publicFetch: PublicFetch = fetch,
): Promise<LexiconPublicationReport> {
  const base = serviceUrl.replace(/\/$/, "");
  const lexicons: Record<string, LexiconPublicationStatus> = {};

  await Promise.all(
    nsids.map(async (nsid) => {
      const url = `${base}/xrpc/com.atproto.lexicon.resolveLexicon?nsid=${encodeURIComponent(nsid)}`;
      const response = await publicFetch(url, { method: "GET" });

      if (!response.ok) {
        const errorBody = await parseErrorBody(response);
        if (response.status === 404 || errorBody.error === "LexiconNotFound") {
          lexicons[nsid] = { status: "missing" };
          return;
        }
        lexicons[nsid] = { status: "unavailable", httpStatus: response.status };
        return;
      }

      const data: unknown = await response.json();
      if (!isResolvedLexicon(data)) {
        lexicons[nsid] = { status: "invalid-response", httpStatus: response.status };
        return;
      }
      lexicons[nsid] = { status: "published", cid: data.cid, uri: data.uri };
    }),
  );

  return {
    complete: nsids.every((nsid) => lexicons[nsid]?.status === "published"),
    lexicons,
  };
}
