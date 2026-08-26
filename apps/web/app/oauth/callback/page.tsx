"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { errorMessage } from "../../../lib/error-message";
import { initializeOAuth } from "../../../lib/oauth-client";

export default function OAuthCallbackPage() {
  const router = useRouter();
  const [error, setError] = useState<string>();

  useEffect(() => {
    let active = true;

    void initializeOAuth()
      .then((result) => {
        if (!active) return;
        if (!result?.session) {
          throw new Error("No OAuth session was returned by the PDS.");
        }
        router.replace("/");
      })
      .catch((cause: unknown) => {
        if (active) setError(errorMessage(cause, "The OAuth callback failed."));
      });

    return () => {
      active = false;
    };
  }, [router]);

  return (
    <main className="callback-page">
      <p className="status-line">AT Protocol OAuth</p>
      <h1>{error ? "Sign-in could not be completed." : "Completing sign-in…"}</h1>
      {error ? (
        <>
          <p className="oauth-error" role="alert">
            {error}
          </p>
          <Link href="/">Return to AT Storage</Link>
        </>
      ) : (
        <p aria-live="polite">Verifying the response from your PDS.</p>
      )}
    </main>
  );
}
