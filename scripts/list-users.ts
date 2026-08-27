/**
 * Lists all ATProto accounts that have published records in a specific collection
 * using the official com.atproto.sync.listReposByCollection XRPC endpoint.
 *
 * Usage:
 *   pnpm users
 *   pnpm users am.noz.atgallery.account
 */

const collection = process.argv[2] || "am.noz.atgallery.account";
const relay = process.env.ATPROTO_RELAY || "https://bsky.network";

interface RepoItem {
  did: string;
  status?: string;
}

interface ListReposResponse {
  cursor?: string;
  repos: RepoItem[];
}

interface AccountStats {
  blobCount?: number;
  client?: string;
  totalBytes?: number;
  updatedAt?: string;
}

interface UserInfo {
  did: string;
  handle?: string;
  pdsUrl?: string;
  stats?: AccountStats;
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / Math.pow(1024, exponent);
  return `${value.toFixed(exponent === 0 ? 0 : 2)} ${units[exponent]}`;
}

async function resolveUser(did: string, targetCollection: string): Promise<UserInfo> {
  let handle: string | undefined;
  let pdsUrl: string | undefined;

  try {
    const res = await fetch(
      `https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile?actor=${encodeURIComponent(did)}`,
    );
    if (res.ok) {
      const data = (await res.json()) as { handle?: string };
      handle = data.handle;
    }
  } catch {
    // Ignore profile lookup errors
  }

  // Resolve PDS from PLC directory
  try {
    if (did.startsWith("did:plc:")) {
      const plcRes = await fetch(`https://plc.directory/${encodeURIComponent(did)}`);
      if (plcRes.ok) {
        const doc = (await plcRes.json()) as {
          alsoKnownAs?: string[];
          service?: Array<{ id: string; serviceEndpoint: string }>;
        };
        pdsUrl = doc.service?.find((s) => s.id === "#atproto_pds")?.serviceEndpoint;
        if (!handle && doc.alsoKnownAs?.[0]) {
          handle = doc.alsoKnownAs[0].replace(/^at:\/\//, "");
        }
      }
    }
  } catch {
    // Ignore PLC resolution errors
  }

  // Fallback PDS endpoints to try
  const candidatePdsUrls = [
    pdsUrl,
    "https://spaces-alpha.host.bsky.network",
    "https://bsky.social",
  ].filter((url): url is string => typeof url === "string" && url.length > 0);

  let stats: AccountStats | undefined;
  if (targetCollection.endsWith(".account") || targetCollection === "am.noz.atgallery.account") {
    for (const endpoint of candidatePdsUrls) {
      try {
        const cleanEndpoint = endpoint.replace(/\/$/, "");
        const recRes = await fetch(
          `${cleanEndpoint}/xrpc/com.atproto.repo.getRecord?repo=${encodeURIComponent(did)}&collection=${encodeURIComponent(targetCollection)}&rkey=self`,
        );
        if (recRes.ok) {
          const recData = (await recRes.json()) as { value?: AccountStats };
          if (recData.value) {
            stats = recData.value;
            pdsUrl = cleanEndpoint;
            break;
          }
        }
      } catch {
        // Try next candidate endpoint
      }
    }
  }

  return { did, handle, pdsUrl, stats };
}

async function main() {
  console.log(`Querying ${relay} for collection: ${collection}...\n`);

  let cursor: string | undefined;
  const repos: RepoItem[] = [];

  do {
    const url = new URL(`${relay}/xrpc/com.atproto.sync.listReposByCollection`);
    url.searchParams.set("collection", collection);
    url.searchParams.set("limit", "500");
    if (cursor) url.searchParams.set("cursor", cursor);

    const res = await fetch(url.toString());
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Failed to list repos (${res.status}): ${text}`);
    }

    const data = (await res.json()) as ListReposResponse;
    repos.push(...(data.repos || []));
    cursor = data.cursor;
  } while (cursor);

  if (repos.length === 0) {
    console.log(`No users found with collection "${collection}".`);
    return;
  }

  console.log(`Found ${repos.length} user(s):\n`);

  let totalBlobs = 0;
  let totalBytes = 0;
  let accountsWithStats = 0;

  for (let i = 0; i < repos.length; i++) {
    const item = repos[i];
    const user = await resolveUser(item.did, collection);
    const handleLabel = user.handle ? ` (@${user.handle})` : "";

    let statsLabel = "";
    if (user.stats) {
      const blobCount = user.stats.blobCount ?? 0;
      const bytes = user.stats.totalBytes ?? 0;
      totalBlobs += blobCount;
      totalBytes += bytes;
      accountsWithStats++;
      statsLabel = ` — ${blobCount.toLocaleString()} blobs · ${formatBytes(bytes)}`;
    }

    console.log(`${i + 1}. ${user.did}${handleLabel}${statsLabel}`);
  }

  console.log(`\n──────────────────────────────────────────`);
  console.log(`Total accounts: ${repos.length}`);
  if (accountsWithStats > 0) {
    console.log(`Total uploaded blobs: ${totalBlobs.toLocaleString()}`);
    console.log(`Total library storage: ${formatBytes(totalBytes)} (${totalBytes.toLocaleString()} bytes)`);
  }
}

main().catch((err) => {
  console.error("Error:", err.message || err);
  process.exit(1);
});
