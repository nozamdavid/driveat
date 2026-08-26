import { describe, expect, it } from "vitest";

import { eligibleAlbumsForTargets, unmemberedTargetUris } from "./album-picker";

const albums = [
  { cid: "c1", createdAt: "2026-08-01T00:00:00.000Z", title: "Summer", uri: "album:summer" },
  { cid: "c2", createdAt: "2026-08-02T00:00:00.000Z", title: "Winter", uri: "album:winter" },
];

describe("eligibleAlbumsForTargets", () => {
  it("excludes only albums that already contain every targeted item", () => {
    const memberships = [
      { albumUri: "album:summer", mediaUri: "media:a" },
      { albumUri: "album:summer", mediaUri: "media:b" },
      { albumUri: "album:winter", mediaUri: "media:a" },
    ];

    expect(
      eligibleAlbumsForTargets({
        albums,
        memberships,
        targetMediaUris: ["media:a", "media:b"],
      }).map((album) => album.uri),
    ).toEqual(["album:winter"]);
  });

  it("keeps albums without any membership records", () => {
    expect(
      eligibleAlbumsForTargets({ albums, memberships: [], targetMediaUris: ["media:a"] }),
    ).toEqual(albums);
  });

  it("offers nothing when there are no targets", () => {
    expect(eligibleAlbumsForTargets({ albums, memberships: [], targetMediaUris: [] })).toEqual([]);
  });
});

describe("unmemberedTargetUris", () => {
  it("returns only targets missing from the album, in target order", () => {
    const memberships = [{ albumUri: "album:summer", mediaUri: "media:a" }];

    expect(
      unmemberedTargetUris({
        albumUri: "album:summer",
        memberships,
        targetMediaUris: ["media:b", "media:a", "media:c"],
      }),
    ).toEqual(["media:b", "media:c"]);
  });

  it("returns every deduplicated target for an album with no memberships", () => {
    expect(
      unmemberedTargetUris({
        albumUri: "album:new",
        memberships: [],
        targetMediaUris: ["media:a", "media:a", "media:b"],
      }),
    ).toEqual(["media:a", "media:b"]);
  });
});
