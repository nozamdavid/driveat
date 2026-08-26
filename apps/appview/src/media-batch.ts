export type MediaBatchItem = Readonly<{
  mediaId: string;
  status: number;
  mime?: string;
  error?: string;
  bytes?: Uint8Array;
}>;

type ManifestItem = Readonly<{
  mediaId: string;
  status: number;
  mime?: string;
  error?: string;
  offset?: number;
  length?: number;
}>;

export function encodeMediaBatch(items: readonly MediaBatchItem[]): Uint8Array {
  let offset = 0;
  const manifestItems: ManifestItem[] = items.map((item) => {
    if (item.bytes === undefined) {
      return { mediaId: item.mediaId, status: item.status, ...(item.error ? { error: item.error } : {}) };
    }
    const entry = {
      mediaId: item.mediaId,
      status: item.status,
      ...(item.mime ? { mime: item.mime } : {}),
      offset,
      length: item.bytes.length,
    };
    offset += item.bytes.length;
    return entry;
  });
  const manifest = new TextEncoder().encode(JSON.stringify({ version: 1, items: manifestItems }));
  const output = new Uint8Array(4 + manifest.length + offset);
  new DataView(output.buffer).setUint32(0, manifest.length, false);
  output.set(manifest, 4);
  let bodyOffset = 4 + manifest.length;
  for (const item of items) {
    if (item.bytes === undefined) continue;
    output.set(item.bytes, bodyOffset);
    bodyOffset += item.bytes.length;
  }
  return output;
}
