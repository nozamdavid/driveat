# ATStorage

ATStorage is an experimental AT Protocol media Library and public gallery publisher. Exact originals live in an owner-only permissioned Space; explicit public album snapshots live in the user's public account repo.

The agreed scope and constraints are recorded in [the product contract](./docs/PRODUCT_CONTRACT.md). Project terminology is defined in [the domain glossary](./CONTEXT.md).
Lexicon namespace selection and publication are specified in [the authority runbook](./docs/AUTHORITY.md).

## Workspace

- `apps/web`: Next.js web application
- `apps/android`: native Kotlin/Jetpack Compose Android photo-backup application
- `apps/appview`: experimental Cloudflare Worker AppView/media gateway for permissioned Space images
- `packages/domain`: product rules independent of UI and protocol clients
- `packages/atproto`: AT Protocol compatibility and transport boundaries
- `packages/lexicons`: experimental schema identifiers and generated types
- `packages/testkit`: shared compatibility fixtures

## Commands

```sh
pnpm install
pnpm test
pnpm typecheck
pnpm build
pnpm dev
```

The hosted alpha remains blocked on selecting a Lexicon authority/domain plus hosting and OAuth URLs. The designated experimental PDS is `https://spaces-alpha.host.bsky.network`; accounts on it currently require an invite.

## Local OAuth

The web app implements OAuth through AT Protocol's localhost client. Without an NSID authority it requests identity access only. When `NEXT_PUBLIC_ATGALLERY_NSID_AUTHORITY` is configured, it requests narrow access to ATStorage's explicit public collections, accepted media blob types up to 50 MiB, and the user's personal ATStorage Space. It never requests `transition:generic` or wildcard repo/collection access.

1. Copy `apps/web/.env.example` to `apps/web/.env.local`. The designated alpha PDS is already configured.
2. Run `pnpm dev`.
3. Open `http://127.0.0.1:3000` exactly; do not substitute `localhost`.
4. Enter a handle, DID, or PDS URL and approve the displayed request on the PDS.

No client secret, app registration, or deployed metadata document is needed for this loopback flow. The PDS must support AT Protocol's optional localhost client exception. Browser credentials are stored by the official OAuth client in IndexedDB and are revoked when the user disconnects.

When `NEXT_PUBLIC_ATGALLERY_MEDIA_GATEWAY_URL` is configured, the browser uses OAuth only to obtain a
single-use delegation token. The Worker exchanges it for its own short-lived, DPoP-bound Space
credential. Previews and explicit downloads then use opaque Worker media routes rather than PDS blob
URLs. Existing sessions must disconnect and reconnect once to approve the required Space `read`
permission.

To exercise gallery permissions, set `NEXT_PUBLIC_ATGALLERY_NSID_AUTHORITY` to a controlled reverse-domain authority, restart the development server, disconnect any existing identity-only session, and reconnect. The generated Space type and collection Lexicons must be published under that authority before an authorization server can resolve and approve the request. After login, the UI performs a read-only `com.atproto.space.listSpaces` probe and discovers the user's personal Library Space. If none exists, the user may explicitly create a stable `library` Space. Creation uses an owner-only member-list policy and never runs automatically.

The project pins the matching `0.0.0-spaces-alpha-20260818163953` AT Protocol SDK. Space discovery and user-triggered setup are implemented, but the UI keeps them gated until the chosen authority's experimental Lexicons are published. Private gallery record and blob writes remain disabled until that gate is satisfied.

Once a configured personal Space is ready, the authenticated view accepts one private image at a time. It validates the file signature and 25 MiB limit, generates a metadata-stripped WebP preview, checks transfer-event records for the rolling quota, uploads both blobs, and atomically creates the private media and transfer records. The resulting debug panel shows record/blob CIDs, authenticated `getBlob` URLs, and an authenticated [PDSls](https://pdsls.dev/) Space-record link. These are debugging references, not public media URLs.

## Designated alpha PDS

Verified on 2026-08-21:

- Host: `https://spaces-alpha.host.bsky.network`
- Server DID: `did:web:spaces-alpha.host.bsky.network`
- Account domain: `.spaces-alpha.bsky.network`
- Accounts: invite required
- Reported generic blob upload ceiling: 300 MiB
- Required `com.atproto.space.listSpaces` endpoint: present and authentication-protected

ATGallery still enforces its lower 25 MiB image and 50 MiB video limits. The operator's response remains authoritative.

## Android backup alpha

`apps/android` is a native Kotlin and Jetpack Compose application. It signs in with native
AT Protocol OAuth, requests photo-library access, discovers the same personal Library Space as the
web app, and uploads camera photos through Android WorkManager. It currently accepts JPEG, PNG, and
WebP still images, reconciles already-backed-up and incompatible media on load, and supports manual
and scheduled background backups.

The native OAuth client ID is
`https://atgallery.noz.am/android-oauth-client-metadata.json`. That file is included in the web
app's public assets and **must be deployed at that exact HTTPS URL before native login works**. Its
custom redirect is `am.noz.atgallery:/oauth/callback`.

```sh
cd apps/android
JAVA_HOME=/path/to/jdk17 ANDROID_HOME=/path/to/android-sdk ./gradlew assembleDebug
```

The app expects the user's personal Library Space to have already been created by the web app. A
future iOS client will be implemented natively and is not currently part of this repository.

## Disclaimer

LLMs have been used to develop this experimental project