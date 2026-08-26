import { MEBIBYTE, calculateLogicalStorageUsage } from "@atgallery/domain";

import type { LibraryMedia } from "./private-library";

/**
 * The private Library stores each media item's exact original bytes;
 * previews carry no stored-size field, so only originals contribute entries.
 */
export function privateLibraryStorageBytes(
  mediaItems: readonly Pick<LibraryMedia, "size">[],
): number {
  return calculateLogicalStorageUsage(
    mediaItems.map((item) => ({ bytes: item.size, kind: "private-original" })),
  ).privateBytes;
}

export function formatBytes(bytes: number): string {
  const mebibytes = bytes / MEBIBYTE;
  return mebibytes >= 1024
    ? `${(mebibytes / 1024).toFixed(2)} GiB`
    : `${Math.floor(mebibytes)} MiB`;
}
