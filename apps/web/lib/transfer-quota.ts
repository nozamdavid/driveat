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

const DOMAIN_OPERATION: Readonly<Record<string, TransferEvent["operation"]>> = {
  ingest: "private-ingest",
  publish: "public-publication",
};

export async function recentTransferEvents(
  agent: Agent,
  space: string,
  repo: string,
  collection: string,
  now: Date,
): Promise<readonly TransferEvent[]> {
  const cutoff = now.getTime() - ROLLING_QUOTA_WINDOW_MS;
  const events: TransferEvent[] = [];

  await listAllSpaceRecords(
    agent,
    { collection, repo, space },
    {
      maxPages: MAX_TRANSFER_EVENT_PAGES,
      pageLimitMessage: "Transfer history exceeded the upload safety scan limit.",
      onPage: (page) => {
        let reachedCutoff = false;
        for (const entry of page) {
          const value = entry.value;
          if (!value) continue;
          const completedAt = typeof value.createdAt === "string" ? new Date(value.createdAt) : undefined;
          if (!completedAt || !Number.isFinite(completedAt.getTime())) continue;
          if (completedAt.getTime() > now.getTime()) continue;
          if (completedAt.getTime() < cutoff) {
            reachedCutoff = true;
            continue;
          }

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
        return !reachedCutoff;
      },
    },
  );

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
