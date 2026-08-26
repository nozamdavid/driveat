export type RawSpaceRecord = Readonly<{ uri: string; cid: string; value: unknown }>;

export type LibraryMedia = Readonly<{
  uri: string;
  cid: string;
  filename: string;
  mime: string;
  originalCid?: string;
  size: number;
  previewCid: string;
  metadata?: Readonly<Record<string, unknown>>;
  width?: number;
  height?: number;
  sha256?: string;
  createdAt: string;
}>;

export type DuplicateMediaGroup = Readonly<{
  duplicate: LibraryMedia;
  original: LibraryMedia;
}>;

export type LibraryAlbum = Readonly<{
  uri: string;
  cid: string;
  title: string;
  description?: string;
  createdAt: string;
}>;

export type LibraryMembership = Readonly<{
  uri: string;
  cid: string;
  albumUri: string;
  mediaUri: string;
  position: number;
  addedAt: string;
}>;

export type MediaDateGroup = Readonly<{
  key: string;
  label: string;
  items: readonly LibraryMedia[];
}>;

const DAY_MS = 24 * 60 * 60 * 1_000;

type UnknownRecord = Record<string, unknown>;

function object(value: unknown): UnknownRecord | undefined {
  return value && typeof value === "object" ? (value as UnknownRecord) : undefined;
}

function string(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function nonNegativeInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : undefined;
}

function blobCid(value: unknown): string | undefined {
  const blob = object(value);
  const ref = object(blob?.ref);
  const link = string(ref?.$link);
  if (link) return link;
  if (blob?.ref && typeof blob.ref === "object") {
    const rendered = String(blob.ref);
    if (rendered && rendered !== "[object Object]") return rendered;
  }
  return undefined;
}

function media(record: RawSpaceRecord): LibraryMedia | undefined {
  const value = object(record.value);
  const filename = string(value?.originalFilename);
  const mime = string(value?.originalMime);
  const size = nonNegativeInteger(value?.originalSize);
  const previewCid = blobCid(value?.preview);
  const originalCid = blobCid(value?.original);
  const metadata = object(value?.extractedMetadata);
  const createdAt = string(value?.createdAt);
  if (!filename || !mime || size === undefined || !previewCid || !createdAt) return undefined;
  const width = nonNegativeInteger(value?.width);
  const height = nonNegativeInteger(value?.height);
  const sha256 = string(value?.sha256);
  return {
    uri: record.uri,
    cid: record.cid,
    filename,
    mime,
    ...(originalCid ? { originalCid } : {}),
    size,
    previewCid,
    ...(metadata ? { metadata } : {}),
    ...(width ? { width } : {}),
    ...(height ? { height } : {}),
    ...(sha256 ? { sha256 } : {}),
    createdAt,
  };
}

function album(record: RawSpaceRecord): LibraryAlbum | undefined {
  const value = object(record.value);
  const title = string(value?.title);
  const createdAt = string(value?.createdAt);
  if (!title || !createdAt) return undefined;
  const description = string(value?.description);
  return {
    uri: record.uri,
    cid: record.cid,
    title,
    ...(description ? { description } : {}),
    createdAt,
  };
}

function membership(record: RawSpaceRecord): LibraryMembership | undefined {
  const value = object(record.value);
  const albumUri = string(value?.album);
  const mediaUri = string(value?.media);
  const position = nonNegativeInteger(value?.position);
  const addedAt = string(value?.addedAt);
  if (!albumUri || !mediaUri || position === undefined || !addedAt) return undefined;
  return { uri: record.uri, cid: record.cid, albumUri, mediaUri, position, addedAt };
}

export function indexLibraryRecords(input: Readonly<{
  media: readonly RawSpaceRecord[];
  albums: readonly RawSpaceRecord[];
  memberships: readonly RawSpaceRecord[];
}>): Readonly<{
  media: readonly LibraryMedia[];
  albums: readonly LibraryAlbum[];
  memberships: readonly LibraryMembership[];
}> {
  return {
    media: input.media.flatMap((record) => media(record) ?? []),
    albums: input.albums.flatMap((record) => album(record) ?? []),
    memberships: input.memberships.flatMap((record) => membership(record) ?? []),
  };
}

export function nextMembershipPosition(
  memberships: readonly Pick<LibraryMembership, "albumUri" | "position">[],
  albumUri: string,
): number {
  return memberships.reduce(
    (next, membership) =>
      membership.albumUri === albumUri ? Math.max(next, membership.position + 1) : next,
    0,
  );
}

export function recordKeyFromAtUri(uri: string): string {
  const rkey = uri.split("/").at(-1);
  if (!rkey) throw new TypeError(`Space record URI has no record key: ${uri}`);
  return rkey;
}

function duplicateName(filename: string): Readonly<{ base: string; index: number }> {
  const match = /^(.*) \((\d+)\)(\.[^.]*)$/u.exec(filename);
  if (!match) return { base: filename.toLocaleLowerCase(), index: 0 };
  return {
    base: `${match[1]}${match[3]}`.toLocaleLowerCase(),
    index: Number(match[2]),
  };
}

function duplicateMetadataKey(media: LibraryMedia): string {
  return [
    duplicateName(media.filename).base,
    media.mime,
    media.size,
    media.width ?? "",
    media.height ?? "",
  ].join("\u0000");
}

export function findDuplicateMedia(mediaItems: readonly LibraryMedia[]): readonly DuplicateMediaGroup[] {
  const groups = new Map<string, LibraryMedia[]>();
  for (const media of mediaItems) {
    const key = duplicateMetadataKey(media);
    groups.set(key, [...(groups.get(key) ?? []), media]);
  }

  return Array.from(groups.values()).flatMap((group) => {
    if (group.length < 2) return [];
    const ordered = [...group].sort((left, right) => {
      const nameOrder = duplicateName(left.filename).index - duplicateName(right.filename).index;
      return nameOrder || left.createdAt.localeCompare(right.createdAt);
    });
    const [original, ...duplicates] = ordered;
    return original ? duplicates.map((duplicate) => ({ duplicate, original })) : [];
  });
}

function startOfLocalDay(date: Date): Date {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  return start;
}

/**
 * Capture time drives photo-app grouping; upload time is the fallback.
 * Returns milliseconds since epoch, or -Infinity when neither value is usable.
 */
function presentationTimestamp(media: LibraryMedia): number {
  const captureTime = media.metadata?.captureTime;
  if (typeof captureTime === "string") {
    const captured = Date.parse(captureTime);
    if (!Number.isNaN(captured)) return captured;
  }
  const added = Date.parse(media.createdAt);
  return Number.isNaN(added) ? Number.NEGATIVE_INFINITY : added;
}

function localDayKey(date: Date): string {
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function dayGroupLabel(key: string, now: Date): string {
  if (key === "unknown") return "Unknown date";
  const [year, month, day] = key.split("-").map(Number);
  const date = new Date(year ?? 0, (month ?? 1) - 1, day ?? 1);
  const daysAgo = Math.round((startOfLocalDay(now).getTime() - date.getTime()) / DAY_MS);
  if (daysAgo <= 0) return "Today";
  if (daysAgo === 1) return "Yesterday";
  if (daysAgo < 7) {
    return new Intl.DateTimeFormat("en", { weekday: "short", month: "short", day: "numeric" }).format(date);
  }
  if (date.getFullYear() === now.getFullYear()) {
    return new Intl.DateTimeFormat("en", { month: "short", day: "numeric" }).format(date);
  }
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric" }).format(date);
}

/**
 * Groups newest-first by local calendar day with photo-app labels:
 * Today, Yesterday, weekday dates within a week, then dates with the year only when needed.
 * Items are placed by extracted capture time, falling back to upload time.
 */
export function groupMediaByDay(
  mediaItems: readonly LibraryMedia[],
  now: Date = new Date(),
): readonly MediaDateGroup[] {
  const stamped = mediaItems
    .map((media) => ({ media, timestamp: presentationTimestamp(media) }))
    .sort((left, right) => right.timestamp - left.timestamp);
  const groups = new Map<string, LibraryMedia[]>();
  for (const { media, timestamp } of stamped) {
    const key = Number.isFinite(timestamp) ? localDayKey(new Date(timestamp)) : "unknown";
    const group = groups.get(key) ?? [];
    group.push(media);
    groups.set(key, group);
  }
  return Array.from(groups, ([key, items]) => ({
    key,
    label: dayGroupLabel(key, now),
    items,
  }));
}
