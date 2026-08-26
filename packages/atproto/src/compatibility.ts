export const REQUIRED_WRITE_CAPABILITIES = [
  "narrow-oauth",
  "permissioned-space-read",
  "permissioned-space-write",
  "permissioned-space-blobs",
  "public-custom-record-write",
  "browser-cors",
  "public-blob-read",
  "repo-sync",
  "size-rejection",
  "rate-limit-signals",
] as const;

export const REQUIRED_READ_CAPABILITIES = ["browser-cors", "public-blob-read", "repo-sync"] as const;

export type PdsCapability = (typeof REQUIRED_WRITE_CAPABILITIES)[number];
export type CapabilityCheck = Readonly<Record<PdsCapability, boolean>>;

export type CompatibilityMode = "read-write" | "read-only" | "unsupported";

export type CompatibilityReport = Readonly<{
  missingReadCapabilities: readonly PdsCapability[];
  missingWriteCapabilities: readonly PdsCapability[];
  mode: CompatibilityMode;
}>;

export function evaluatePdsCompatibility(checks: CapabilityCheck): CompatibilityReport {
  const missingWriteCapabilities = REQUIRED_WRITE_CAPABILITIES.filter(
    (capability) => !checks[capability],
  );
  const missingReadCapabilities = REQUIRED_READ_CAPABILITIES.filter(
    (capability) => !checks[capability],
  );

  return {
    missingReadCapabilities,
    missingWriteCapabilities,
    mode:
      missingWriteCapabilities.length === 0
        ? "read-write"
        : missingReadCapabilities.length === 0
          ? "read-only"
          : "unsupported",
  };
}

