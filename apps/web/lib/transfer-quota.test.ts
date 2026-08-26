import { describe, expect, it } from "vitest";

import { transferQuotaStatus } from "./transfer-quota";

describe("transferQuotaStatus", () => {
  it("reports rolling usage and the first time capacity returns", () => {
    const now = new Date("2026-08-21T12:00:00.000Z");
    const status = transferQuotaStatus(
      [
        {
          blobOperations: 2,
          completedAt: new Date("2026-08-20T13:00:00.000Z"),
          items: 1,
          operation: "private-ingest",
          transferredBytes: 10,
        },
        {
          blobOperations: 2,
          completedAt: new Date("2026-08-21T10:00:00.000Z"),
          items: 1,
          operation: "private-ingest",
          transferredBytes: 20,
        },
      ],
      now,
    );

    expect(status.quota.usage).toEqual({ blobOperations: 4, items: 2, transferredBytes: 30 });
    expect(status.nextRecoveryAt?.toISOString()).toBe("2026-08-21T13:00:00.000Z");
  });

  it("has no recovery time when the window is unused", () => {
    const status = transferQuotaStatus([], new Date("2026-08-21T12:00:00.000Z"));
    expect(status.quota.usage.transferredBytes).toBe(0);
    expect(status.nextRecoveryAt).toBeUndefined();
  });
});
