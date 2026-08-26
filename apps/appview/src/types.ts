export interface Env {
  MEDIA_REGISTRY: DurableObjectNamespace;
  SPACE_BROKER: DurableObjectNamespace;
  ATGALLERY_ADMIN_TOKEN: string;
  ATGALLERY_SESSION_SECRET: string;
  MAX_BLOB_BYTES?: string;
  SESSION_ISSUER?: string;
  ALLOWED_ORIGINS?: string;
}

export interface MediaMapping {
  mediaId: string;
  space: string;
  repo: string;
  cid: string;
  expectedMime?: string;
}

export interface SessionClaims {
  sub: string;
  spaces: string[];
  exp: number;
  iss: string;
}

export interface CredentialState {
  space: string;
  credential: string;
  expiresAt: number;
  privateJwk: JsonWebKey;
  publicJwk: JsonWebKey;
}
