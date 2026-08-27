import { describe, expect, it, vi } from "vitest";

import { recentTransferEvents, transferQuotaStatus } from "./transfer-quota";

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

describe("recentTransferEvents", () => {
  it("paginates until it reaches an event outside the rolling window", async () => {
    const recentValue = {
      blobOperations: 2,
      itemCount: 1,
      logicalBytes: 10,
      operation: "ingest",
      createdAt: "2026-08-27T11:00:00.000Z",
    };
    const listRecords = vi.fn()
      .mockResolvedValueOnce({
        data: {
          records: Array.from({ length: 100 }, (_, index) => ({ rkey: `new-${index}`, cid: `cid-${index}`, collection: "events", value: recentValue })),
          cursor: "page-2",
        },
      })
      .mockResolvedValueOnce({
        data: {
          records: [
            { rkey: "new-100", cid: "cid-100", collection: "events", value: recentValue },
            { rkey: "old", cid: "cid-old", collection: "events", value: { ...recentValue, createdAt: "2026-08-25T11:00:00.000Z" } },
          ],
          cursor: "unused-page",
        },
      });
    const agent = { com: { atproto: { space: { listRecords } } } } as any;

    const events = await recentTransferEvents(
      agent,
      "space:1",
      "did:alice",
      "events",
      new Date("2026-08-27T12:00:00.000Z"),
    );

    expect(events).toHaveLength(101);
    expect(listRecords).toHaveBeenCalledTimes(2);
    expect(listRecords.mock.calls[1]?.[0]).toEqual(expect.objectContaining({ cursor: "page-2", reverse: true }));
  });
});
