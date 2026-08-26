import { assertNsid } from "./internal-nsid.js";

export const PERSONAL_LIBRARY_SPACE_KEY = "library";

const MEMBER_LIST_POLICY_TYPE = "com.atproto.simplespace.defs#memberListPolicy";
const OPEN_APP_ACCESS_TYPE = "com.atproto.simplespace.defs#open";

export type SpaceReference = Readonly<{ uri: string }>;

export type PersonalSpaceDiscovery =
  | Readonly<{ status: "missing" }>
  | Readonly<{ status: "ready"; uri: string }>
  | Readonly<{ status: "conflict"; uris: readonly string[] }>;

type ListSpacesResponse = Readonly<{
  data: Readonly<{
    cursor?: string;
    spaces: readonly SpaceReference[];
  }>;
}>;

type CreateSpaceResponse = Readonly<{ data: Readonly<{ uri: string }> }>;

export type PersonalSpaceApi = Readonly<{
  listSpaces: (
    params: Readonly<{ type: string; did: string; limit: number; cursor?: string }>,
  ) => Promise<ListSpacesResponse>;
  createSpace: (input: Readonly<{
    type: string;
    skey: string;
    policy: Readonly<{ $type: typeof MEMBER_LIST_POLICY_TYPE }>;
    appAccess: Readonly<{ $type: typeof OPEN_APP_ACCESS_TYPE }>;
  }>) => Promise<CreateSpaceResponse>;
}>;

const PAGE_SIZE = 100;
const MAX_DISCOVERY_PAGES = 20;

export async function discoverPersonalLibrarySpace(
  api: Pick<PersonalSpaceApi, "listSpaces">,
  spaceType: string,
  ownerDid: string,
): Promise<PersonalSpaceDiscovery> {
  assertNsid(spaceType, "personal Space type NSID");

  const uris: string[] = [];
  let cursor: string | undefined;

  for (let page = 0; page < MAX_DISCOVERY_PAGES; page += 1) {
    const response = await api.listSpaces({
      type: spaceType,
      did: ownerDid,
      limit: PAGE_SIZE,
      ...(cursor ? { cursor } : {}),
    });

    for (const space of response.data.spaces) {
      if (!uris.includes(space.uri)) uris.push(space.uri);
    }

    cursor = response.data.cursor;
    if (!cursor) break;
  }

  if (cursor) {
    throw new Error("Personal Space discovery exceeded its safety page limit.");
  }
  if (uris.length === 0) return { status: "missing" };
  if (uris.length === 1) return { status: "ready", uri: uris[0]! };
  return { status: "conflict", uris };
}

export async function createPersonalLibrarySpace(
  api: Pick<PersonalSpaceApi, "createSpace">,
  spaceType: string,
): Promise<Readonly<{ uri: string }>> {
  assertNsid(spaceType, "personal Space type NSID");

  const response = await api.createSpace({
    type: spaceType,
    skey: PERSONAL_LIBRARY_SPACE_KEY,
    policy: { $type: MEMBER_LIST_POLICY_TYPE },
    appAccess: { $type: OPEN_APP_ACCESS_TYPE },
  });

  return { uri: response.data.uri };
}
