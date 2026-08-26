import { describe, expect, it } from "vitest";

import {
  groupMediaByDay,
  findDuplicateMedia,
  indexLibraryRecords,
  nextMembershipPosition,
  recordKeyFromAtUri,
} from "./private-library";

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
});
