import { buildGalleryOAuthPermissions } from "@atgallery/atproto";
import { createExperimentalNsids } from "@atgallery/lexicons";

export const IDENTITY_OAUTH_SCOPE = "atproto";
export const OAUTH_CALLBACK_PATH = "/oauth/callback";
export const ATGALLERY_ALPHA_PDS = "https://spaces-alpha.host.bsky.network";
export const DEFAULT_HANDLE_RESOLVER = ATGALLERY_ALPHA_PDS;

type BrowserLocation = Pick<Location, "hostname" | "port" | "protocol">;

type BaseOAuthPermissionConfiguration = Readonly<{
  scope: string;
  scopes: readonly string[];
}>;

export type OAuthPermissionConfiguration =
  | (BaseOAuthPermissionConfiguration & Readonly<{ mode: "identity-only" }>)
  | (BaseOAuthPermissionConfiguration &
      Readonly<{
        accountCollection: string;
        albumCollection: string;
        libraryMediaCollection: string;
        membershipCollection: string;
        mode: "gallery";
        personalSpaceType: string;
        spaceScope: string;
        transferEventCollection: string;
      }>);

export function resolveOAuthPermissionConfiguration(
  nsidAuthority: string | undefined,
): OAuthPermissionConfiguration {
  const authority = nsidAuthority?.trim();
  if (!authority) {
    return { mode: "identity-only", scope: IDENTITY_OAUTH_SCOPE, scopes: [IDENTITY_OAUTH_SCOPE] };
  }

  const nsids = createExperimentalNsids(authority);
  const permissions = buildGalleryOAuthPermissions(nsids);
  return {
    mode: "gallery",
    accountCollection: nsids.account,
    albumCollection: nsids.libraryAlbum,
    libraryMediaCollection: nsids.libraryMedia,
    membershipCollection: nsids.libraryMembership,
    personalSpaceType: nsids.personalLibrarySpace,
    transferEventCollection: nsids.transferEvent,
    ...permissions,
  };
}

function isLoopbackHostname(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

export function buildLoopbackClientId(
  location: BrowserLocation,
  scope = IDENTITY_OAUTH_SCOPE,
): string {
  if (!isLoopbackHostname(location.hostname)) {
    throw new Error("Local OAuth requires a loopback hostname.");
  }

  if (location.protocol !== "http:") {
    throw new Error("Local OAuth expects an http:// loopback origin.");
  }

  const callbackHostname = location.hostname === "localhost" ? "127.0.0.1" : location.hostname;
  const callbackPort = location.port ? `:${location.port}` : "";
  const redirectUri = `http://${callbackHostname}${callbackPort}${OAUTH_CALLBACK_PATH}`;

  return (
    `http://localhost?redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&scope=${encodeURIComponent(scope)}`
  );
}

export function resolveOAuthClientId(
  configuredClientId: string | undefined,
  location: BrowserLocation,
  scope = IDENTITY_OAUTH_SCOPE,
): string {
  const configured = configuredClientId?.trim();
  if (configured) {
    return configured;
  }
  if (isLoopbackHostname(location.hostname)) {
    return buildLoopbackClientId(location, scope);
  }
  const port = location.port ? `:${location.port}` : "";
  return `${location.protocol}//${location.hostname}${port}/oauth-client-metadata.json`;
}
