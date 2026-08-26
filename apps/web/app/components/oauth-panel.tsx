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
import { type FormEvent, useEffect, useState } from "react";

import { errorMessage } from "../../lib/error-message";
import { clearLibrarySnapshots } from "../../lib/library-snapshot";
import {
  getOAuthClient,
  initializeOAuth,
  oauthPermissionConfiguration,
} from "../../lib/oauth-client";
import { ATGALLERY_ALPHA_PDS } from "../../lib/oauth-config";
import { clearPreviewCache } from "../../lib/preview-cache";
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

function personalSpaceMessage(space: PersonalSpaceView): string {
  switch (space.status) {
    case "ready":
      return `Personal Library Space ready: ${space.uri}`;
    case "missing":
      return "No personal Library Space exists yet. Create it to start storing private gallery records.";
    case "conflict":
      return `Found ${space.uris.length} personal Library Spaces. ATGallery will not choose one automatically.`;
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
    process.env.NEXT_PUBLIC_ATPROTO_ALPHA_PDS ?? ATGALLERY_ALPHA_PDS,
  );
  const [view, setView] = useState<ViewState>({ status: "loading" });
  const [submitting, setSubmitting] = useState(false);
  const [personalSpace, setPersonalSpace] = useState<PersonalSpaceView>();
  const [sessionDiagnostics, setSessionDiagnostics] = useState<SessionDiagnostics>();

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

  const displayedPersonalSpace: PersonalSpaceView =
    oauthPermissionConfiguration.mode === "identity-only"
      ? { status: "not-configured" }
      : (personalSpace ?? { status: "checking" });

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
              <strong>ATGallery</strong>
              <span>Private Library</span>
            </div>
          </div>
          <div className="photo-account">
            <span className="connected-did" title={view.session.did}>{view.session.did}</span>
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
        {displayedPersonalSpace.status === "ready" &&
        oauthPermissionConfiguration.mode === "gallery" ? (
          <PrivateLibrary
            albumCollection={oauthPermissionConfiguration.albumCollection}
            libraryMediaCollection={oauthPermissionConfiguration.libraryMediaCollection}
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
          ? "The request is limited to ATGallery collections, accepted media blobs, and your personal Space."
          : "Local alpha requests identity access only. Sign-in and consent happen on your PDS."}
      </p>
    </form>
  );
}
