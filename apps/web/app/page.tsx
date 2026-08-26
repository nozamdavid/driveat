import {
  MEDIA_LIMITS,
  MEBIBYTE,
  OPERATIONAL_LIMITS,
  ROLLING_QUOTA_LIMITS,
} from "@atgallery/domain";
import Link from "next/link";

import { OAuthPanel } from "./components/oauth-panel";

function mebibytes(bytes: number): string {
  return `${bytes / MEBIBYTE} MiB`;
}

export default function HomePage() {
  return (
    <main>
      <header className="masthead">
        <Link className="wordmark" href="/" aria-label="ATGallery home">
          ATGallery
        </Link>
        <span className="alpha-badge">experimental alpha</span>
      </header>

      <section className="intro" aria-labelledby="intro-title">
        <div>
          <p className="status-line">Spaces alpha implementation</p>
          <h1 id="intro-title">Your originals. Your account. Explicitly public when you decide.</h1>
        </div>
        <div className="intro-copy">
          <p>
            ATGallery keeps exact media originals in an owner-only permissioned Space, organizes
            them into albums, and publishes deliberate snapshots to your public AT Protocol repo.
          </p>
        </div>
      </section>

      <section className="account-workspace" aria-label="AT Protocol account and private Library">
        <OAuthPanel />
      </section>

      <section className="policy" aria-labelledby="policy-title">
        <div className="section-heading">
          <h2 id="policy-title">The rules already enforced in code</h2>
          <p>Operator limits may be stricter. The PDS response is always authoritative.</p>
        </div>

        <dl className="policy-grid">
          <div>
            <dt>Image original</dt>
            <dd>{mebibytes(MEDIA_LIMITS.imageOriginalBytes)}</dd>
          </div>
          <div>
            <dt>Video original</dt>
            <dd>{mebibytes(MEDIA_LIMITS.videoOriginalBytes)}</dd>
          </div>
          <div>
            <dt>Video duration</dt>
            <dd>{MEDIA_LIMITS.videoDurationSeconds} seconds</dd>
          </div>
          <div>
            <dt>Daily items</dt>
            <dd>{ROLLING_QUOTA_LIMITS.items}</dd>
          </div>
          <div>
            <dt>Daily blob operations</dt>
            <dd>{ROLLING_QUOTA_LIMITS.blobOperations}</dd>
          </div>
          <div>
            <dt>Album size</dt>
            <dd>{OPERATIONAL_LIMITS.albumItems.toLocaleString()} items</dd>
          </div>
        </dl>
      </section>

      <section className="build-status" aria-labelledby="build-status-title">
        <h2 id="build-status-title">Implementation status</h2>
        <ul>
          <li data-state="complete">Product contract and domain language recorded</li>
          <li data-state="complete">Media, quota, storage, and capability policies scaffolded</li>
          <li data-state="complete">Local OAuth, narrow permission composition, and session restoration</li>
          <li data-state="complete">Personal Space discovery and explicit owner-only creation</li>
          <li data-state="complete">Private image ingest with quota check and Space/blob diagnostics</li>
          <li data-state="complete">Published alpha Lexicons and hosted-PDS integration</li>
          <li data-state="complete">Private Library gallery with Albums and Membership organization</li>
          <li data-state="next">Next: album publishing and lifecycle controls</li>
        </ul>
      </section>

      <footer>
        <p>Experimental software. Do not rely on alpha data durability.</p>
        <a href="https://atproto.com" rel="noreferrer">
          AT Protocol documentation
        </a>
      </footer>
    </main>
  );
}
