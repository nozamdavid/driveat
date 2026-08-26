import { ROLLING_QUOTA_LIMITS, ROLLING_QUOTA_WINDOW_MS } from "./limits.js";

export type TransferOperation = "private-ingest" | "public-publication";

export type TransferEvent = Readonly<{
  blobOperations: number;
  completedAt: Date;
  items: number;
  operation: TransferOperation;
  transferredBytes: number;
}>;

export type QuotaAmount = Readonly<{
  blobOperations: number;
  items: number;
  transferredBytes: number;
}>;

export type RollingQuota = Readonly<{
  allowed: boolean;
  remaining: QuotaAmount;
  usage: QuotaAmount;
}>;

const zeroAmount = (): QuotaAmount => ({ blobOperations: 0, items: 0, transferredBytes: 0 });

export function calculateRollingQuota(
  events: readonly TransferEvent[],
  now: Date,
  proposed: QuotaAmount = zeroAmount(),
): RollingQuota {
  assertValidDate(now, "now");
  assertAmount(proposed, "proposed transfer");

  const cutoff = now.getTime() - ROLLING_QUOTA_WINDOW_MS;
  const usage = events.reduce<QuotaAmount>((total, event) => {
    assertTransferEvent(event);
    const completedAt = event.completedAt.getTime();
    if (completedAt < cutoff || completedAt > now.getTime()) {
      return total;
    }
    return {
      blobOperations: total.blobOperations + event.blobOperations,
      items: total.items + event.items,
      transferredBytes: total.transferredBytes + event.transferredBytes,
    };
  }, zeroAmount());

  const remaining = {
    blobOperations: Math.max(0, ROLLING_QUOTA_LIMITS.blobOperations - usage.blobOperations),
    items: Math.max(0, ROLLING_QUOTA_LIMITS.items - usage.items),
    transferredBytes: Math.max(
      0,
      ROLLING_QUOTA_LIMITS.transferredBytes - usage.transferredBytes,
    ),
  };

  return {
    allowed:
      proposed.blobOperations <= remaining.blobOperations &&
      proposed.items <= remaining.items &&
      proposed.transferredBytes <= remaining.transferredBytes,
    remaining,
    usage,
  };
}

function assertTransferEvent(event: TransferEvent): void {
  assertValidDate(event.completedAt, "transfer event completedAt");
  assertAmount(
    {
      blobOperations: event.blobOperations,
      items: event.items,
      transferredBytes: event.transferredBytes,
    },
    "transfer event",
  );
}

function assertAmount(amount: QuotaAmount, label: string): void {
  for (const [name, value] of Object.entries(amount)) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new TypeError(`${label} ${name} must be a non-negative safe integer.`);
    }
  }
}

function assertValidDate(date: Date, label: string): void {
  if (!Number.isFinite(date.getTime())) {
    throw new TypeError(`${label} must be a valid date.`);
  }
}
