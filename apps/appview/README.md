# ATGallery media gateway

This Cloudflare Worker is the experimental authenticated proxy for permissioned Space images. It
exchanges a browser-obtained, single-use delegation token for an application-held Space credential,
then uses that credential and a Worker-owned P-256 DPoP key to fetch a mapped blob from its author's
PDS. Browser OAuth tokens and OAuth DPoP keys are never sent to the Worker.

This first test build intentionally has no shared image cache. Every request is authorized before
the opaque media mapping is read, the upstream is derived from DID documents, and a successful blob
is MIME-, size-, and CID-checked before being returned with `private, no-store`.

Visible preview cache misses are requested through `POST /v1/media/batch` in groups of at most five.
The response is a compact length-prefixed binary bundle with per-image success or error metadata.
Original downloads remain individual requests. IndexedDB hits never call either media endpoint.

## Connect the web app

Set the public Worker origin in `apps/web/.env.local`, without a trailing path:

```sh
NEXT_PUBLIC_ATGALLERY_MEDIA_GATEWAY_URL=https://atgallery-media-gateway.<account>.workers.dev
```

For local Worker development use `http://127.0.0.1:8787`. Restart Next.js after changing a
`NEXT_PUBLIC_` value. The Worker `ALLOWED_ORIGINS` variable must contain the web origin; the checked-in
configuration permits `http://127.0.0.1:3000` and `http://localhost:3000`.

Disconnect and reconnect the AT Protocol account once. The app now requests Space `read`, obtains a
fresh delegation token, exchanges it for a gateway session, registers opaque mappings as photos are
loaded, and fetches previews and originals through the Worker. The UI reports `Private media gateway
connected.` when the exchange succeeds.

## Run locally

```sh
cp apps/appview/.dev.vars.example apps/appview/.dev.vars
pnpm --filter @atgallery/appview dev
```

Use long random values in `.dev.vars`. Wrangler listens on `http://localhost:8787` by default.

The web integration above is the normal test path. For low-level debugging, set shell variables for
the Space, author DID, blob CID, and the single-use delegation token obtained
from `com.atproto.space.getDelegationToken` with a user OAuth grant containing Space `read`:

```sh
GATEWAY=http://localhost:8787
ADMIN='the same ATGALLERY_ADMIN_TOKEN from .dev.vars'
SPACE='at://did:.../space/.../...'
REPO='did:...'
CID='bafy...'
DELEGATION='single-use-token'
```

Create a temporary viewer session. This admin-only endpoint is a test harness; production must issue
the same session shape from ATGallery's OAuth backend.

```sh
curl -sS -X POST "$GATEWAY/v1/test/sessions" \
  -H "Authorization: Bearer $ADMIN" -H 'Content-Type: application/json' \
  --data "{\"subject\":\"$REPO\",\"spaces\":[\"$SPACE\"]}"
```

Copy the returned `token` into `SESSION`, register an opaque media mapping, and bootstrap the Worker
credential. The delegation token is consumed only by the credential exchange.

```sh
SESSION='returned-token'
MEDIA_ID='test_photo_01'

curl -sS -X PUT "$GATEWAY/v1/admin/media/$MEDIA_ID" \
  -H "Authorization: Bearer $ADMIN" -H 'Content-Type: application/json' \
  --data "{\"space\":\"$SPACE\",\"repo\":\"$REPO\",\"cid\":\"$CID\",\"expectedMime\":\"image/jpeg\"}"

curl -sS -X POST "$GATEWAY/v1/spaces/credential" \
  -H "Authorization: Bearer $SESSION" -H 'Content-Type: application/json' \
  --data "{\"space\":\"$SPACE\",\"delegationToken\":\"$DELEGATION\"}"

curl -sS "$GATEWAY/media/$MEDIA_ID" -H "Authorization: Bearer $SESSION" --output photo.jpg
```

Both credential exchange and blob fetch retry one DPoP nonce challenge with a newly signed proof.
For an app-gated Space, include `clientAttestation` in the credential bootstrap body.

## Deploy

Create the two secrets and deploy; never place either value in `wrangler.jsonc`.

```sh
pnpm --filter @atgallery/appview exec wrangler secret put ATGALLERY_ADMIN_TOKEN
pnpm --filter @atgallery/appview exec wrangler secret put ATGALLERY_SESSION_SECRET
pnpm --filter @atgallery/appview deploy
```

The Worker is alpha-protocol-specific. The admin mapping and test-session endpoints remain only as a
low-level interoperability harness. A later AppView index should replace browser-submitted mappings
before enabling shared, multi-member Spaces.
