"use client";

import {
  createPersonalLibrarySpace,
  discoverPersonalLibrarySpace,
  probePersonalSpaceCapability,
  type PersonalSpaceCapability,
  type PersonalSpaceDiscovery,
} from "@atgallery/atproto";
import { Agent } from "@atproto/api";
import type { OAuthSession } from "@atproto/oauth-client-browser";
import Link from "next/link";
import { type FormEvent, useEffect, useMemo, useState } from "react";

import { errorMessage } from "../../lib/error-message";
import { clearLibrarySnapshots } from "../../lib/library-snapshot";
import { clearCachedTransferEvents } from "../../lib/transfer-quota";
import {
  connectMediaGateway,
  resolveMediaGatewayUrl,
  type MediaGatewayAccess,
} from "../../lib/media-gateway";
import {
  getOAuthClient,
  initializeOAuth,
  oauthPermissionConfiguration,
} from "../../lib/oauth-client";
import { ensureAccountRecord } from "../../lib/account-record";
import { ATGALLERY_ALPHA_PDS } from "../../lib/oauth-config";
import { clearPreviewCache } from "../../lib/preview-cache";
import { formatBlobLimit, parsePdsBlobUploadLimit } from "../../lib/pds-blob-limit";
import { PrivateLibrary } from "./private-library";

type ViewState =
  | { status: "loading" }
  | { status: "anonymous" }
  | { status: "authenticated"; session: OAuthSession }
  | { status: "error"; message: string };

type PersonalSpaceView =
  | Exclude<PersonalSpaceCapability, Readonly<{ status: "available" }>>
  | PersonalSpaceDiscovery
  | Readonly<{
      status: "checking" | "not-configured" | "probe-failed" | "creating" | "create-failed";
      message?: string;
    }>;

type SessionDiagnostics = Readonly<{
  audience: string;
  grantedScope: string;
  requestedScope: string;
}>;

type BlobLimitState =
  | Readonly<{ status: "loading" | "unavailable" }>
  | Readonly<{ bytes: number; status: "available" }>;

function personalSpaceMessage(space: PersonalSpaceView): string {
  switch (space.status) {
    case "ready":
      return `Personal Library Space ready: ${space.uri}`;
    case "missing":
      return "No personal Library Space exists yet. Create it to start storing private gallery records.";
    case "conflict":
      return `Found ${space.uris.length} personal Library Spaces. AT Storage will not choose one automatically.`;
    case "creating":
      return "Creating your personal Library Space…";
    case "create-failed":
      return space.message ?? "The personal Library Space could not be created.";
    case "permission-denied":
      return space.message ?? "The PDS denied the authenticated Space capability probe.";
    case "unsupported":
      return "This PDS does not expose the required Spaces alpha endpoint.";
    case "unavailable":
      return `The Spaces alpha probe returned HTTP ${space.httpStatus}.`;
    case "probe-failed":
      return "The Spaces alpha probe could not reach the PDS.";
    case "checking":
      return "Checking the Spaces alpha API…";
    case "not-configured":
      return "Space checks are waiting for an alpha NSID authority.";
  }
}

export function OAuthPanel() {
  const [identifier, setIdentifier] = useState(
    process.env.NEXT_PUBLIC_ATPROTO_ALPHA_PDS?.trim() || ATGALLERY_ALPHA_PDS,
  );
  const [view, setView] = useState<ViewState>({ status: "loading" });
  const [submitting, setSubmitting] = useState(false);
  const [personalSpace, setPersonalSpace] = useState<PersonalSpaceView>();
  const [sessionDiagnostics, setSessionDiagnostics] = useState<SessionDiagnostics>();
  const [mediaGatewayAccess, setMediaGatewayAccess] = useState<MediaGatewayAccess>();
  const [gatewayError, setGatewayError] = useState<string>();
  const [blobLimit, setBlobLimit] = useState<BlobLimitState>({ status: "loading" });

  useEffect(() => {
    let active = true;

    void initializeOAuth()
      .then((result) => {
        if (!active) return;
        setView(
          result?.session
            ? { status: "authenticated", session: result.session }
            : { status: "anonymous" },
        );
      })
      .catch((error: unknown) => {
        if (active) setView({ status: "error", message: errorMessage(error, "The OAuth request failed.") });
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (view.status !== "authenticated" || oauthPermissionConfiguration.mode !== "gallery") {
      return;
    }

    const permissionConfiguration = oauthPermissionConfiguration;
    let active = true;
    void view.session.getTokenInfo().then((token) => {
      if (active) {
        setSessionDiagnostics({
          audience: token.aud,
          grantedScope: String(token.scope),
          requestedScope: permissionConfiguration.scope,
        });
      }
    }).catch(() => undefined);

    void probePersonalSpaceCapability(
      view.session.fetchHandler.bind(view.session),
      permissionConfiguration.personalSpaceType,
      view.session.did,
    )
      .then(async (capability) => {
        if (!active) return;
        if (capability.status !== "available") {
          setPersonalSpace(capability);
          return;
        }

        const agent = new Agent(view.session);
        void ensureAccountRecord(
          agent.com.atproto.repo,
          permissionConfiguration.accountCollection,
          view.session.did,
        );
        const discovery = await discoverPersonalLibrarySpace(
          agent.com.atproto.space,
          permissionConfiguration.personalSpaceType,
          view.session.did,
        );
        if (active) setPersonalSpace(discovery);
      })
      .catch(() => {
        if (active) setPersonalSpace({ status: "probe-failed" });
      });

    return () => {
      active = false;
    };
  }, [view]);

  useEffect(() => {
    if (view.status !== "authenticated") return;
    let active = true;
    const agent = new Agent(view.session);
    void agent.com.atproto.server.describeServer()
      .then((response) => {
        if (!active) return;
        const bytes = parsePdsBlobUploadLimit(response.data.blobUploadLimit);
        setBlobLimit(bytes ? { bytes, status: "available" } : { status: "unavailable" });
      })
      .catch(() => {
        if (active) setBlobLimit({ status: "unavailable" });
      });
    return () => {
      active = false;
    };
  }, [view]);

  const displayedPersonalSpace: PersonalSpaceView = useMemo(
    () => oauthPermissionConfiguration.mode === "identity-only"
      ? { status: "not-configured" }
      : (personalSpace ?? { status: "checking" }),
    [personalSpace],
  );

  useEffect(() => {
    let active = true;
    const updateGatewayState = (
      access: MediaGatewayAccess | undefined,
      error: string | undefined,
    ) => queueMicrotask(() => {
      if (!active) return;
      setMediaGatewayAccess(access);
      setGatewayError(error);
    });

    if (
      view.status !== "authenticated" ||
      displayedPersonalSpace.status !== "ready" ||
      oauthPermissionConfiguration.mode !== "gallery"
    ) {
      updateGatewayState(undefined, undefined);
      return () => { active = false; };
    }

    let gatewayUrl: string | undefined;
    try {
      gatewayUrl = resolveMediaGatewayUrl(
        process.env.NEXT_PUBLIC_ATGALLERY_MEDIA_GATEWAY_URL,
      );
    } catch (urlErr) {
      updateGatewayState(undefined, errorMessage(urlErr, "Invalid media gateway URL."));
      return () => { active = false; };
    }

    if (!gatewayUrl) {
      updateGatewayState(undefined, "NEXT_PUBLIC_ATGALLERY_MEDIA_GATEWAY_URL is not configured.");
      return () => { active = false; };
    }

    updateGatewayState(undefined, undefined);
    void connectMediaGateway({
      baseUrl: gatewayUrl,
      delegationClient: view.session.fetchHandler.bind(view.session),
      repo: view.session.did,
      space: displayedPersonalSpace.uri,
    })
      .then((access) => {
        if (active) {
          setMediaGatewayAccess(access);
          setGatewayError(undefined);
        }
      })
      .catch((error: unknown) => {
        const message = errorMessage(error, "Failed to connect to media gateway.");
        console.error("Failed to connect to media gateway:", error);
        if (active) {
          setMediaGatewayAccess(undefined);
          setGatewayError(message);
        }
      });

    return () => {
      active = false;
    };
  }, [displayedPersonalSpace, view]);

  async function createLibrarySpace() {
    if (
      view.status !== "authenticated" ||
      oauthPermissionConfiguration.mode !== "gallery" ||
      displayedPersonalSpace.status !== "missing"
    ) {
      return;
    }

    setPersonalSpace({ status: "creating" });
    try {
      const agent = new Agent(view.session);
      const current = await discoverPersonalLibrarySpace(
        agent.com.atproto.space,
        oauthPermissionConfiguration.personalSpaceType,
        view.session.did,
      );
      if (current.status !== "missing") {
        setPersonalSpace(current);
        return;
      }

      const created = await createPersonalLibrarySpace(
        agent.com.atproto.simplespace,
        oauthPermissionConfiguration.personalSpaceType,
      );
      setPersonalSpace({ status: "ready", uri: created.uri });
    } catch (error: unknown) {
      setPersonalSpace({ status: "create-failed", message: errorMessage(error, "The OAuth request failed.") });
    }
  }

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const loginHint = identifier.trim();
    if (!loginHint) return;

    setSubmitting(true);
    setView({ status: "anonymous" });

    try {
      const client = await getOAuthClient();
      await client.signIn(loginHint, { scope: oauthPermissionConfiguration.scope });
    } catch (error: unknown) {
      setSubmitting(false);
      setView({ status: "error", message: errorMessage(error, "The OAuth request failed.") });
    }
  }

  async function signOut() {
    if (view.status !== "authenticated") return;

    setSubmitting(true);
    try {
      const client = await getOAuthClient();
      await client.revoke(view.session.did);
      // Local caches hold no value once the session is gone; clearing is best-effort.
      clearLibrarySnapshots();
      clearCachedTransferEvents();
      void clearPreviewCache();
      setView({ status: "anonymous" });
    } catch (error: unknown) {
      setView({ status: "error", message: errorMessage(error, "The OAuth request failed.") });
    } finally {
      setSubmitting(false);
    }
  }

  if (view.status === "loading") {
    return (
      <div className="oauth-panel" aria-live="polite">
        <p className="fine-print">Checking for an existing AT Protocol session…</p>
      </div>
    );
  }

  if (view.status === "authenticated") {
    return (
      <div className="oauth-panel authenticated-panel photo-app-shell" aria-live="polite">
        <header className="photo-app-bar">
          <div className="photo-app-brand">
            <span className="photo-app-mark" aria-hidden="true">A</span>
            <div>
              <strong>AT Storage</strong>
              <span>Private Library</span>
            </div>
          </div>
          <div className="photo-account">
            <span className="account-identity">
              <span className="connected-did" title={view.session.did}>{view.session.did}</span>
              <span className="blob-limit">
                (blob limit: {blobLimit.status === "available" ? formatBlobLimit(blobLimit.bytes) : blobLimit.status === "loading" ? "checking…" : "unavailable"})
              </span>
            </span>
            <button type="button" className="secondary-button compact-button" disabled={submitting} onClick={signOut}>
              {submitting ? "Disconnecting…" : "Disconnect"}
            </button>
          </div>
        </header>

        {displayedPersonalSpace.status !== "ready" ? (
          <section className="library-setup">
            <p className="status-line">Private Space setup</p>
            <h2>Your photo Library is almost ready.</h2>
            <p className="capability-status" data-status={displayedPersonalSpace.status}>
              {personalSpaceMessage(displayedPersonalSpace)}
            </p>
            {displayedPersonalSpace.status === "missing" ? (
              <button type="button" onClick={createLibrarySpace}>
                Create personal Library Space
              </button>
            ) : null}
          </section>
        ) : null}
        {displayedPersonalSpace.status === "permission-denied" ? (
          <details className="oauth-diagnostics library-setup">
            <summary>Space authorization diagnostics</summary>
            <dl>
              <div><dt>HTTP status</dt><dd>{displayedPersonalSpace.httpStatus}</dd></div>
              <div><dt>PDS error</dt><dd>{displayedPersonalSpace.error ?? "not provided"}</dd></div>
              <div><dt>WWW-Authenticate</dt><dd>{displayedPersonalSpace.wwwAuthenticate ?? "not provided"}</dd></div>
              <div><dt>Token audience</dt><dd>{sessionDiagnostics?.audience ?? "loading"}</dd></div>
              <div><dt>Granted scope</dt><dd>{sessionDiagnostics?.grantedScope ?? "loading"}</dd></div>
              <div><dt>Requested scope</dt><dd>{sessionDiagnostics?.requestedScope ?? oauthPermissionConfiguration.scope}</dd></div>
            </dl>
          </details>
        ) : null}
        {gatewayError ? (
          <section className="library-setup">
            <p className="status-line">Media Gateway</p>
            <p className="capability-status" data-status="unavailable">{gatewayError}</p>
          </section>
        ) : null}
        {displayedPersonalSpace.status === "ready" &&
        oauthPermissionConfiguration.mode === "gallery" ? (
          <PrivateLibrary
            albumCollection={oauthPermissionConfiguration.albumCollection}
            blobUploadLimit={blobLimit.status === "available" ? blobLimit.bytes : undefined}
            libraryIndexCollection={oauthPermissionConfiguration.libraryIndexCollection}
            libraryMediaCollection={oauthPermissionConfiguration.libraryMediaCollection}
            mediaGatewayAccess={mediaGatewayAccess}
            membershipCollection={oauthPermissionConfiguration.membershipCollection}
            session={view.session}
            spaceUri={displayedPersonalSpace.uri}
            transferEventCollection={oauthPermissionConfiguration.transferEventCollection}
          />
        ) : null}
      </div>
    );
  }

  return (
    <div className="landing-screen">
      <header className="masthead">
        <Link className="wordmark" href="/" aria-label="AT Storage home">
          AT Storage
        </Link>
        <span className="alpha-badge">experimental alpha</span>
      </header>

      <div className="landing-hero">
        <section className="landing-intro" aria-labelledby="intro-title">
          <p className="status-line">ALPHA</p>
          <h1 id="intro-title">
            Your files. Your account.
          </h1>
          <p className="intro-description">
            AT Storage keeps exact media originals in an owner-only permissioned Space, organizes
            them into albums. Other file types will be added soon™
          </p>
          <div className="privacy-notice" role="note">
            <p>
              <strong>⚠️ Note on encryption:</strong> Spaces provide access control rather than confidentiality.
              Data in a Space is readable by any user or application granted access to that Space and is not encrypted.
              We may add encryption ourselves in the future.
            </p>
          </div>
        </section>

        <section className="landing-login" aria-label="AT Protocol sign in">
          <form className="oauth-panel" onSubmit={signIn}>
            <label htmlFor="atproto-identifier">Handle, DID, or alpha PDS URL</label>
            <input
              id="atproto-identifier"
              name="identifier"
              type="text"
              value={identifier}
              autoCapitalize="none"
              autoComplete="username"
              autoCorrect="off"
              placeholder="alice.example or https://pds.example"
              required
              disabled={submitting}
              onChange={(event) => setIdentifier(event.target.value)}
            />
            <button type="submit" disabled={submitting}>
              {submitting ? "Opening your PDS…" : "Connect with AT Protocol"}
            </button>
            {view.status === "error" ? (
              <p className="oauth-error" role="alert">
                {view.message}
              </p>
            ) : null}
            <p className="fine-print">
              {oauthPermissionConfiguration.mode === "gallery"
                ? "The request is limited to AT Storage collections, accepted media blobs, and your personal Space."
                : "Local alpha requests identity access only. Sign-in and consent happen on your PDS."}
            </p>
          </form>
        </section>
      </div>

      <footer className="landing-footer">
        <p>Experimental software. Do not rely on alpha data durability.</p>
        <a href="https://atproto.com" target="_blank" rel="noreferrer">
          AT Protocol documentation
        </a>
      </footer>
    </div>
  );
}
