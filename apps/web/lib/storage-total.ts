import { LIBRARY_LIMITS, MEBIBYTE, calculateLogicalStorageUsage } from "@atgallery/domain";

import type { LibraryMedia } from "./private-library";

/**
 * The private Library stores each media item's exact original bytes;
 * previews carry no stored-size field, so only originals contribute entries.
 */
export function privateLibraryStorageBytes(
  mediaItems: readonly Pick<LibraryMedia, "previewSize" | "size">[],
): number {
  return calculateLogicalStorageUsage(
    mediaItems.flatMap((item) => [
      { bytes: item.size, kind: "private-original" as const },
      ...(item.previewSize === undefined
        ? []
        : [{ bytes: item.previewSize, kind: "private-preview" as const }]),
    ]),
  ).privateBytes;
}

export function formatBytes(bytes: number): string {
  const mebibytes = bytes / MEBIBYTE;
  return mebibytes >= 1024
    ? `${(mebibytes / 1024).toFixed(2)} GiB`
    : `${Math.floor(mebibytes)} MiB`;
}

export function libraryUploadFits(
  storedBytes: number,
  blobBytes: readonly number[],
): boolean {
  if (!Number.isSafeInteger(storedBytes) || storedBytes < 0) return false;
  const proposedBytes = blobBytes.reduce((total, bytes) => total + bytes, 0);
  return Number.isSafeInteger(proposedBytes) &&
    blobBytes.every((bytes) => Number.isSafeInteger(bytes) && bytes >= 0) &&
    storedBytes + proposedBytes <= LIBRARY_LIMITS.storedBytes;
}
