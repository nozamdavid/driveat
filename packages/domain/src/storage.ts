export type LogicalStorageEntry = Readonly<{
  bytes: number;
  kind: "private-original" | "private-preview" | "public-rendition" | "public-preview";
}>;

export type LogicalStorageUsage = Readonly<{
  privateBytes: number;
  publicBytes: number;
  totalBytes: number;
}>;

const KIND_VISIBILITY: Readonly<Record<LogicalStorageEntry["kind"], "private" | "public">> =
  Object.freeze({
    "private-original": "private",
    "private-preview": "private",
    "public-preview": "public",
    "public-rendition": "public",
  });

export function calculateLogicalStorageUsage(
  entries: readonly LogicalStorageEntry[],
): LogicalStorageUsage {
  let privateBytes = 0;
  let publicBytes = 0;

  for (const entry of entries) {
    if (!Number.isSafeInteger(entry.bytes) || entry.bytes < 0) {
      throw new TypeError("Logical storage bytes must be a non-negative safe integer.");
    }

    if (KIND_VISIBILITY[entry.kind] === "private") {
      privateBytes += entry.bytes;
    } else {
      publicBytes += entry.bytes;
    }
  }

  return { privateBytes, publicBytes, totalBytes: privateBytes + publicBytes };
}

