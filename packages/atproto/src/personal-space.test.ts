import { describe, expect, it, vi } from "vitest";

import {
  createPersonalLibrarySpace,
  discoverPersonalLibrarySpace,
  PERSONAL_LIBRARY_SPACE_KEY,
  type PersonalSpaceApi,
} from "./personal-space.js";

const spaceType = "com.example.atgallery.alpha.personalLibrary";
const ownerDid = "did:plc:alice";

describe("discoverPersonalLibrarySpace", () => {
  it("reports a missing personal Space", async () => {
    const listSpaces = vi.fn(async () => ({ data: { spaces: [] } }));

    await expect(discoverPersonalLibrarySpace({ listSpaces }, spaceType, ownerDid)).resolves.toEqual({
      status: "missing",
    });
    expect(listSpaces).toHaveBeenCalledWith({ type: spaceType, did: ownerDid, limit: 100 });
  });

  it("follows cursors and returns the one matching Space", async () => {
    const listSpaces = vi
      .fn<PersonalSpaceApi["listSpaces"]>()
      .mockResolvedValueOnce({ data: { spaces: [], cursor: "next" } })
      .mockResolvedValueOnce({ data: { spaces: [{ uri: "at://did:example:alice/library" }] } });

    await expect(discoverPersonalLibrarySpace({ listSpaces }, spaceType, ownerDid)).resolves.toEqual({
      status: "ready",
      uri: "at://did:example:alice/library",
    });
  });

  it("refuses to silently choose between duplicate personal Spaces", async () => {
    const listSpaces = vi.fn(async () => ({
      data: {
        spaces: [
          { uri: "at://did:example:alice/library-one" },
          { uri: "at://did:example:alice/library-two" },
        ],
      },
    }));

    await expect(discoverPersonalLibrarySpace({ listSpaces }, spaceType, ownerDid)).resolves.toEqual({
      status: "conflict",
      uris: [
        "at://did:example:alice/library-one",
        "at://did:example:alice/library-two",
      ],
    });
  });
});

describe("createPersonalLibrarySpace", () => {
  it("creates the stable owner-only personal Library Space", async () => {
    const createSpace = vi.fn(async () => ({
      data: { uri: "at://did:example:alice/library" },
    }));

    await expect(createPersonalLibrarySpace({ createSpace }, spaceType)).resolves.toEqual({
      uri: "at://did:example:alice/library",
    });
    expect(createSpace).toHaveBeenCalledWith({
      type: spaceType,
      skey: PERSONAL_LIBRARY_SPACE_KEY,
      policy: { $type: "com.atproto.simplespace.defs#memberListPolicy" },
      appAccess: { $type: "com.atproto.simplespace.defs#open" },
    });
  });

  it("rejects an invalid Space type before making a request", async () => {
    const createSpace = vi.fn();
    await expect(createPersonalLibrarySpace({ createSpace }, "not an nsid")).rejects.toThrow(
      "Invalid personal Space type NSID",
    );
    expect(createSpace).not.toHaveBeenCalled();
  });
});
