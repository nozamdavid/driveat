import { BrowserOAuthClient } from "@atproto/oauth-client-browser";
import { retryDpopNonceChallenge } from "@atgallery/atproto";

import {
  DEFAULT_HANDLE_RESOLVER,
  resolveOAuthClientId,
  resolveOAuthPermissionConfiguration,
} from "./oauth-config";
import { createOAuthInitializer } from "./oauth-initializer";

let clientPromise: Promise<BrowserOAuthClient> | undefined;

export const oauthPermissionConfiguration = resolveOAuthPermissionConfiguration(
  process.env.NEXT_PUBLIC_ATGALLERY_NSID_AUTHORITY,
);

export function getOAuthClient(): Promise<BrowserOAuthClient> {
  if (typeof window === "undefined") {
    throw new Error("The browser OAuth client cannot run on the server.");
  }

  clientPromise ??= BrowserOAuthClient.load({
    clientId: resolveOAuthClientId(
      process.env.NEXT_PUBLIC_ATPROTO_OAUTH_CLIENT_ID,
      window.location,
      oauthPermissionConfiguration.scope,
    ),
    handleResolver:
      process.env.NEXT_PUBLIC_ATPROTO_HANDLE_RESOLVER ??
      process.env.NEXT_PUBLIC_ATPROTO_ALPHA_PDS ??
      DEFAULT_HANDLE_RESOLVER,
  });

  return clientPromise;
}

export const initializeOAuth = createOAuthInitializer(async () => {
  const client = await getOAuthClient();
  return retryDpopNonceChallenge(() => client.init());
});
