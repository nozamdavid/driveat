import {
  calculateRollingQuota,
  ROLLING_QUOTA_WINDOW_MS,
  type RollingQuota,
  type TransferEvent,
} from "@atgallery/domain";
import { Agent } from "@atproto/api";

import { nonNegativeInteger } from "./private-library";
import { listAllSpaceRecords } from "./space-records";

const MAX_TRANSFER_EVENT_PAGES = 10;
const TRANSFER_EVENTS_CACHE_KEY = "atgallery.transfer-events.v1";

export type TransferEventsStorage = Pick<
  Storage,
  "getItem" | "key" | "length" | "removeItem" | "setItem"
>;

const DOMAIN_OPERATION: Readonly<Record<string, TransferEvent["operation"]>> = {
  ingest: "private-ingest",
  publish: "public-publication",
};

function transferEventsCacheKey(did: string, space: string): string {
  return `${TRANSFER_EVENTS_CACHE_KEY}.${did}.${space}`;
}

function defaultStore(): TransferEventsStorage | undefined {
  return (globalThis as { localStorage?: TransferEventsStorage }).localStorage;
}

export function readCachedTransferEvents(
  did: string,
  space: string,
  now = new Date(),
  store?: TransferEventsStorage,
): readonly TransferEvent[] | undefined {
  try {
    const raw = (store ?? defaultStore())?.getItem(transferEventsCacheKey(did, space));
    if (!raw) return undefined;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return undefined;
    const cutoff = now.getTime() - ROLLING_QUOTA_WINDOW_MS;
    const events: TransferEvent[] = [];
    for (const item of parsed) {
      if (!item || typeof item !== "object") continue;
      const value = item as Record<string, unknown>;
      const completedAt = typeof value.completedAt === "string" ? new Date(value.completedAt) : undefined;
      const blobOperations = nonNegativeInteger(value.blobOperations);
      const items = nonNegativeInteger(value.items);
      const transferredBytes = nonNegativeInteger(value.transferredBytes);
      const operation = value.operation;
      if (
        !completedAt ||
        !Number.isFinite(completedAt.getTime()) ||
        completedAt.getTime() < cutoff ||
        completedAt.getTime() > now.getTime() ||
        blobOperations === undefined ||
        items === undefined ||
        transferredBytes === undefined ||
        (operation !== "private-ingest" && operation !== "public-publication")
      ) continue;
      events.push({ blobOperations, completedAt, items, operation, transferredBytes });
    }
    return events;
  } catch {
    return undefined;
  }
}

export function writeCachedTransferEvents(
  did: string,
  space: string,
  events: readonly TransferEvent[],
  store?: TransferEventsStorage,
): void {
  try {
    (store ?? defaultStore())?.setItem(
      transferEventsCacheKey(did, space),
      JSON.stringify(events.map((event) => ({ ...event, completedAt: event.completedAt.toISOString() }))),
    );
  } catch {
    // Cache persistence is advisory; an explicit refresh can rebuild it.
  }
}

export function clearCachedTransferEvents(store?: TransferEventsStorage): void {
  try {
    const resolved = store ?? defaultStore();
    if (!resolved) return;
    for (let index = resolved.length - 1; index >= 0; index -= 1) {
      const key = resolved.key(index);
      if (key?.startsWith(`${TRANSFER_EVENTS_CACHE_KEY}.`)) resolved.removeItem(key);
    }
  } catch {
    // Clearing is best-effort during sign-out.
  }
}

export async function recentTransferEvents(
  agent: Agent,
  space: string,
  repo: string,
  collection: string,
  now: Date,
): Promise<readonly TransferEvent[]> {
  const cutoff = now.getTime() - ROLLING_QUOTA_WINDOW_MS;
  const events: TransferEvent[] = [];

  try {
    const records = await listAllSpaceRecords(
      agent,
      { collection, repo, space },
      {
        maxPages: MAX_TRANSFER_EVENT_PAGES,
        onPage: (page) => !page.some((entry) => {
          const value = entry.value as Record<string, unknown> | undefined;
          const createdAt = typeof value?.createdAt === "string" ? Date.parse(value.createdAt) : NaN;
          return Number.isFinite(createdAt) && createdAt < cutoff;
        }),
      },
    );

    for (const entry of records) {
      const value = entry.value as Record<string, unknown> | undefined;
      if (!value) continue;
      const completedAt = typeof value.createdAt === "string" ? new Date(value.createdAt) : undefined;
      if (!completedAt || !Number.isFinite(completedAt.getTime())) continue;
      if (completedAt.getTime() > now.getTime()) continue;
      if (completedAt.getTime() < cutoff) break;

      const blobOperations = nonNegativeInteger(value.blobOperations);
      const items = nonNegativeInteger(value.itemCount);
      const transferredBytes = nonNegativeInteger(value.logicalBytes);
      const wireOperation = value.operation;
      const operation =
        typeof wireOperation === "string" ? DOMAIN_OPERATION[wireOperation] : undefined;
      if (
        blobOperations === undefined ||
        items === undefined ||
        transferredBytes === undefined ||
        operation === undefined
      ) {
        continue;
      }
      events.push({ blobOperations, completedAt, items, operation, transferredBytes });
    }
  } catch {
    // Quota scan is advisory
  }

  return events;
}

export type TransferQuotaStatus = Readonly<{
  nextRecoveryAt?: Date;
  quota: RollingQuota;
}>;

export function transferQuotaStatus(
  events: readonly TransferEvent[],
  now: Date,
): TransferQuotaStatus {
  const oldest = events.reduce<Date | undefined>(
    (current, event) =>
      !current || event.completedAt.getTime() < current.getTime() ? event.completedAt : current,
    undefined,
  );
  return {
    quota: calculateRollingQuota(events, now),
    ...(oldest
      ? { nextRecoveryAt: new Date(oldest.getTime() + ROLLING_QUOTA_WINDOW_MS) }
      : {}),
  };
}
