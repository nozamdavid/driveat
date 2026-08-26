# Materialized Lexicons

These JSON files are the publishable alpha schemas for `am.noz.atgallery.alpha`.
Their source of truth is `packages/lexicons/src/schemas.ts`; do not edit the JSON by hand.

Regenerate them from the repository root with:

```sh
pnpm lexicons:materialize
```

The durable publisher is `@noz.am` (`did:plc:lmkzmvv6sdxntwtyxpg7fqqq`), and its DNS TXT authority record is publicly verified. Publication remains gated on writing the schema records and completing the verification runbook in `docs/AUTHORITY.md`.

Preview the publication without authenticating or writing:

```sh
pnpm lexicons:publish
```

Publish interactively with an app password for `@noz.am`:

```sh
pnpm lexicons:publish -- --write
```

The password prompt does not echo or persist the credential. If the PDS requires email two-factor authentication, the script requests the emailed sign-in code and retries automatically. Existing records with different content are rejected; after reviewing the change, pass both `--write --update` to replace them.
