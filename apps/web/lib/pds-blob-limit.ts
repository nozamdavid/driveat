import { MEBIBYTE } from "@atgallery/domain";

export const LIBRARY_RECORD_BLOB_LIMIT = 50 * MEBIBYTE;

export function parsePdsBlobUploadLimit(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0
    ? value
    : undefined;
}

export function effectiveLibraryBlobLimit(pdsLimit: number): number {
  return Math.min(pdsLimit, LIBRARY_RECORD_BLOB_LIMIT);
}

export function formatBlobLimit(bytes: number): string {
  const mebibytes = bytes / MEBIBYTE;
  if (Number.isInteger(mebibytes)) return `${mebibytes} MiB`;
  return `${mebibytes.toFixed(1)} MiB`;
}
