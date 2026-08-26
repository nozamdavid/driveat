import { BrowserOAuthClient } from "@atproto/oauth-client-browser";
import { retryDpopNonceChallenge } from "@atgallery/atproto";

import {
  DEFAULT_HANDLE_RESOLVER,
  resolveOAuthClientId,
  resolveOAuthPermissionConfiguration,
} from "./oauth-config";
import { createOAuthInitializer } from "./oauth-initializer";

let clientPromise: Promise<BrowserOAuthClient> | undefined;

const rawAuthority = process.env.NEXT_PUBLIC_ATGALLERY_NSID_AUTHORITY?.trim() || undefined;
export const oauthPermissionConfiguration = resolveOAuthPermissionConfiguration(rawAuthority);

export function getOAuthClient(): Promise<BrowserOAuthClient> {
  if (typeof window === "undefined") {
    throw new Error("The browser OAuth client cannot run on the server.");
  }

  const rawClientId = process.env.NEXT_PUBLIC_ATPROTO_OAUTH_CLIENT_ID?.trim() || undefined;
  const rawResolver =
    process.env.NEXT_PUBLIC_ATPROTO_HANDLE_RESOLVER?.trim() ||
    process.env.NEXT_PUBLIC_ATPROTO_ALPHA_PDS?.trim() ||
    DEFAULT_HANDLE_RESOLVER;

  clientPromise ??= BrowserOAuthClient.load({
    clientId: resolveOAuthClientId(
      rawClientId,
      window.location,
      oauthPermissionConfiguration.scope,
    ),
    handleResolver: rawResolver,
  });

  return clientPromise;
}

export const initializeOAuth = createOAuthInitializer(async () => {
  const client = await getOAuthClient();
  return retryDpopNonceChallenge(() => client.init());
});
