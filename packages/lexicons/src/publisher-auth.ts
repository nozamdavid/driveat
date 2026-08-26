export type PublisherSession = Readonly<{ accessJwt: string; did: string; handle: string }>;

type LoginOptions = Readonly<{
  expectedDid: string;
  fetcher?: typeof fetch;
  getAuthFactorToken: () => Promise<string>;
  identifier: string;
  password: string;
  pds: string;
}>;

type ErrorBody = Readonly<{ error?: string; message?: string }>;

async function attemptLogin(
  options: LoginOptions,
  authFactorToken?: string,
): Promise<{ response: Response; body: PublisherSession | ErrorBody; retryAfter?: string }> {
  const response = await (options.fetcher ?? fetch)(
    `${options.pds}/xrpc/com.atproto.server.createSession`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        identifier: options.identifier,
        password: options.password,
        ...(authFactorToken ? { authFactorToken } : {}),
      }),
    },
  );
  const text = await response.text();
  let body: PublisherSession | ErrorBody;
  try {
    body = JSON.parse(text) as PublisherSession | ErrorBody;
  } catch {
    body = {
      error: response.status === 429 ? "RateLimited" : "InvalidResponse",
      message: text.slice(0, 1_000) || response.statusText,
    };
  }
  const retryAfter = response.headers.get("retry-after") ?? undefined;
  return { response, body, ...(retryAfter ? { retryAfter } : {}) };
}

/** Logs in, completing the PDS email-code challenge when one is required. */
export async function loginPublisher(options: LoginOptions): Promise<PublisherSession> {
  let attempt = await attemptLogin(options);
  if (
    attempt.response.status === 401 &&
    "error" in attempt.body &&
    attempt.body.error === "AuthFactorTokenRequired"
  ) {
    const authFactorToken = (await options.getAuthFactorToken()).trim();
    if (!authFactorToken) throw new Error("A sign-in code is required.");
    attempt = await attemptLogin(options, authFactorToken);
  }

  if (!attempt.response.ok) {
    const detail = "message" in attempt.body ? attempt.body.message : undefined;
    const code = "error" in attempt.body ? attempt.body.error : undefined;
    const retry = attempt.retryAfter ? `; retry after ${attempt.retryAfter}s` : "";
    throw new Error(
      `Publisher login failed (${attempt.response.status})${code ? ` ${code}` : ""}${detail ? `: ${detail}` : ""}${retry}`,
    );
  }

  const session = attempt.body as PublisherSession;
  if (session.did !== options.expectedDid) {
    throw new Error(`Authenticated as ${session.did}, expected publisher ${options.expectedDid}.`);
  }
  return session;
}
