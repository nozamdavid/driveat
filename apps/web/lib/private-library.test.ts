import { describe, expect, it } from "vitest";

import {
  appendAlbumsAndMembershipsToLibrary,
  appendMediaToLibrary,
  groupMediaByDay,
  findDuplicateMedia,
  indexLibraryRecords,
  removeMediaFromLibrary,
  latestRecordKey,
  nextMembershipPosition,
  recordKeyFromAtUri,
} from "./private-library";

describe("appendMediaToLibrary", () => {
  it("adds an uploaded media item locally without replacing albums or memberships", () => {
    const uploaded = {
      uri: "at://space/did/media/new",
      cid: "new-cid",
      filename: "new.jpg",
      mime: "image/jpeg",
      size: 10,
      previewCid: "preview-new",
      createdAt: "2026-08-27T12:00:00Z",
    };
    const albums = [{ uri: "at://space/did/albums/a", cid: "a", title: "A", createdAt: "2026-08-01T00:00:00Z" }];
    const result = appendMediaToLibrary({ albums, media: [], memberships: [] }, uploaded);

    expect(result.media).toEqual([uploaded]);
    expect(result.albums).toBe(albums);
    expect(result.memberships).toEqual([]);
  });
});

describe("indexLibraryRecords", () => {
  it("keeps valid media, albums, and memberships while ignoring malformed records", () => {
    const result = indexLibraryRecords({
      media: [
        {
          uri: "at://did:plc:alice/space/type/library/did:plc:alice/media/one",
          cid: "media-cid",
          value: {
            originalFilename: "one.jpg",
            originalMime: "image/jpeg",
            originalSize: 42,
            original: { ref: { $link: "original-cid" } },
            preview: { ref: { $link: "preview-cid" } },
            width: 10,
            height: 20,
            extractedMetadata: { captureTime: "2026-08-20T12:00:00.000Z" },
            createdAt: "2026-08-21T00:00:00.000Z",
          },
        },
        { uri: "bad", cid: "bad", value: {} },
      ],
      albums: [
        {
          uri: "at://did:plc:alice/space/type/library/did:plc:alice/albums/one",
          cid: "album-cid",
          value: { title: "Summer", sort: "manual", createdAt: "2026-08-21T00:00:00.000Z" },
        },
      ],
      memberships: [
        {
          uri: "at://did:plc:alice/space/type/library/did:plc:alice/memberships/one",
          cid: "membership-cid",
          value: {
            album: "at://did:plc:alice/space/type/library/did:plc:alice/albums/one",
            media: "at://did:plc:alice/space/type/library/did:plc:alice/media/one",
            position: 0,
            addedAt: "2026-08-21T00:00:00.000Z",
          },
        },
      ],
    });

    expect(result.media).toHaveLength(1);
    expect(result.media[0]?.previewCid).toBe("preview-cid");
    expect(result.media[0]?.originalCid).toBe("original-cid");
    expect(result.media[0]?.metadata).toEqual({ captureTime: "2026-08-20T12:00:00.000Z" });
    expect(result.albums[0]?.title).toBe("Summer");
    expect(result.memberships[0]?.position).toBe(0);
  });
});

describe("removeMediaFromLibrary", () => {
  it("removes media and its album memberships without touching other records", () => {
    const media = [
      { uri: "at://media/keep", cid: "keep", filename: "keep.jpg", mime: "image/jpeg", size: 1, previewCid: "preview-keep", createdAt: "2026-01-01T00:00:00Z" },
      { uri: "at://media/delete", cid: "delete", filename: "delete.jpg", mime: "image/jpeg", size: 1, previewCid: "preview-delete", createdAt: "2026-01-01T00:00:00Z" },
    ];
    const memberships = [
      { uri: "at://membership/keep", cid: "mk", albumUri: "at://album/a", mediaUri: "at://media/keep", position: 0, addedAt: "2026-01-01T00:00:00Z" },
      { uri: "at://membership/delete", cid: "md", albumUri: "at://album/a", mediaUri: "at://media/delete", position: 1, addedAt: "2026-01-01T00:00:00Z" },
    ];
    const result = removeMediaFromLibrary(
      { albums: [], media, memberships },
      new Set(["at://media/delete"]),
    );
    expect(result.media.map((item) => item.uri)).toEqual(["at://media/keep"]);
    expect(result.memberships.map((item) => item.uri)).toEqual(["at://membership/keep"]);
  });
});

describe("groupMediaByDay", () => {
  const now = new Date(2026, 7, 23, 18, 30, 0);
  const base = {
    cid: "cid",
    filename: "photo.jpg",
    mime: "image/jpeg",
    previewCid: "preview",
    size: 10,
  };

  it("groups newest first with photo-app day labels", () => {
    const groups = groupMediaByDay(
      [
        { ...base, uri: "last-year", createdAt: new Date(2025, 2, 3, 12, 0, 0).toISOString() },
        { ...base, uri: "older-this-year", createdAt: new Date(2026, 7, 3, 9, 0, 0).toISOString() },
        { ...base, uri: "this-week", createdAt: new Date(2026, 7, 19, 8, 0, 0).toISOString() },
        { ...base, uri: "yesterday", createdAt: new Date(2026, 7, 22, 21, 0, 0).toISOString() },
        { ...base, uri: "today-morning", createdAt: new Date(2026, 7, 23, 7, 0, 0).toISOString() },
        { ...base, uri: "today-evening", createdAt: new Date(2026, 7, 23, 20, 0, 0).toISOString() },
      ],
      now,
    );

    expect(groups.map(({ key, label }) => ({ key, label }))).toEqual([
      { key: "2026-08-23", label: "Today" },
      { key: "2026-08-22", label: "Yesterday" },
      { key: "2026-08-19", label: "Wed, Aug 19" },
      { key: "2026-08-03", label: "Aug 3" },
      { key: "2025-03-03", label: "Mar 3, 2025" },
    ]);
    expect(groups[0]?.items.map((item) => item.uri)).toEqual(["today-evening", "today-morning"]);
  });

  it("prefers extracted capture time and falls back to upload time", () => {
    const base = {
      cid: "cid",
      filename: "photo.jpg",
      mime: "image/jpeg",
      previewCid: "preview",
      size: 10,
    };
    const groups = groupMediaByDay(
      [
        {
          ...base,
          uri: "uploaded-today-captured-earlier",
          createdAt: new Date(2026, 7, 23, 10, 0, 0).toISOString(),
          metadata: { captureTime: new Date(2026, 7, 19, 12, 0, 0).toISOString() },
        },
        {
          ...base,
          uri: "invalid-capture-time",
          createdAt: new Date(2026, 7, 22, 10, 0, 0).toISOString(),
          metadata: { captureTime: "not-a-timestamp" },
        },
        {
          ...base,
          uri: "no-metadata",
          createdAt: new Date(2026, 7, 23, 9, 0, 0).toISOString(),
        },
      ],
      now,
    );

    expect(groups.map(({ label }) => label)).toEqual(["Today", "Yesterday", "Wed, Aug 19"]);
    expect(groups[0]?.items.map((item) => item.uri)).toEqual(["no-metadata"]);
    expect(groups[1]?.items.map((item) => item.uri)).toEqual(["invalid-capture-time"]);
    expect(groups[2]?.items.map((item) => item.uri)).toEqual(["uploaded-today-captured-earlier"]);
  });

  it("labels invalid timestamps as unknown without dropping them", () => {
    const groups = groupMediaByDay(
      [{ ...base, uri: "broken", createdAt: "not-a-timestamp" }],
      now,
    );

    expect(groups).toHaveLength(1);
    expect(groups[0]?.label).toBe("Unknown date");
    expect(groups[0]?.items.map((item) => item.uri)).toEqual(["broken"]);
  });
});

describe("findDuplicateMedia", () => {
  it("keeps the original filename and selects matching numbered copies", () => {
    const shared = {
      cid: "cid",
      createdAt: "2026-08-22T00:00:00.000Z",
      filename: "",
      mime: "image/jpeg",
      previewCid: "preview",
      size: 42,
      uri: "",
      width: 10,
      height: 20,
    };
    const duplicates = findDuplicateMedia([
      { ...shared, filename: "holiday.jpg", sha256: "a".repeat(64), uri: "original" },
      { ...shared, filename: "holiday (1).jpg", uri: "copy" },
      { ...shared, filename: "holiday (2).jpg", uri: "copy-two" },
      { ...shared, filename: "same-name.jpg", uri: "same-name-original" },
      { ...shared, filename: "same-name.jpg", uri: "same-name-copy", createdAt: "2026-08-23T00:00:00.000Z" },
      { ...shared, filename: "holiday (3).jpg", size: 43, uri: "different" },
    ]);

    expect(duplicates.map(({ original, duplicate }) => [original.uri, duplicate.uri])).toEqual([
      ["original", "copy"],
      ["original", "copy-two"],
      ["same-name-original", "same-name-copy"],
    ]);
  });
});

describe("membership helpers", () => {
  it("appends mutation responses without rebuilding the Library from record listings", () => {
    const album = { uri: "album:new", cid: "album-cid", title: "Trips", createdAt: "2026-08-28T10:00:00Z" };
    const membership = { uri: "membership:new", cid: "membership-cid", albumUri: album.uri, mediaUri: "media:one", position: 0, addedAt: "2026-08-28T10:01:00Z" };
    const result = appendAlbumsAndMembershipsToLibrary(
      {
        albums: [],
        media: [{ uri: "media:one", cid: "media-cid", filename: "one.jpg", mime: "image/jpeg", size: 1, previewCid: "preview-cid", createdAt: "2026-08-28T09:00:00Z" }],
        memberships: [],
      },
      { albums: [album], memberships: [membership] },
    );

    expect(result.albums).toEqual([album]);
    expect(result.memberships).toEqual([membership]);
    expect(result.media).toHaveLength(1);
  });

  it("allocates the next manual position within one album", () => {
    expect(
      nextMembershipPosition(
        [
          { albumUri: "album:a", position: 2 },
          { albumUri: "album:b", position: 9 },
          { albumUri: "album:a", position: 5 },
        ],
        "album:a",
      ),
    ).toBe(6);
  });

  it("extracts the final record key from a Space AT URI", () => {
    expect(recordKeyFromAtUri("at://did:plc:alice/space/type/library/did:plc:alice/x/3abc")).toBe(
      "3abc",
    );
  });

  it("finds the newest (highest TID) record key across items", () => {
    expect(
      latestRecordKey([
        { uri: "at://space/repo/col/3lb1" },
        { uri: "at://space/repo/col/3lb5" },
        { uri: "at://space/repo/col/3lb3" },
      ]),
    ).toBe("3lb5");

    expect(latestRecordKey([])).toBeUndefined();
  });
});
