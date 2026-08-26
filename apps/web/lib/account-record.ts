export type AccountRecord = Readonly<{
  $type: string;
  client?: string;
  createdAt: string;
  formatVersion: 1;
}>;

export type RepoClient = Readonly<{
  getRecord: (params: {
    collection: string;
    repo: string;
    rkey: string;
  }) => Promise<{ data?: { value?: unknown } } | unknown>;
  putRecord: (params: {
    collection: string;
    record: Record<string, unknown>;
    repo: string;
    rkey: string;
  }) => Promise<unknown>;
}>;

/**
 * Ensures the public "self" account declaration record exists in the user's public repository.
 * This public declaration allows tracking the active user base across AT Protocol apps.
 */
export async function ensureAccountRecord(
  client: RepoClient,
  accountCollection: string,
  did: string,
  appName = "atgallery-web",
): Promise<boolean> {
  try {
    const existing = await client.getRecord({
      repo: did,
      collection: accountCollection,
      rkey: "self",
    });
    if (existing && typeof existing === "object") {
      return false;
    }
  } catch {
    // Record does not exist, proceed to create it
  }

  try {
    await client.putRecord({
      repo: did,
      collection: accountCollection,
      rkey: "self",
      record: {
        $type: accountCollection,
        formatVersion: 1,
        client: appName,
        createdAt: new Date().toISOString(),
      },
    });
    return true;
  } catch (error) {
    console.warn("Failed to create public account declaration record:", error);
    return false;
  }
}
