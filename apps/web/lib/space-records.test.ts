import type { Agent } from "@atproto/api";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  listAllSpaceRecords,
  paceListRecordsRequest,
  resetListRecordsPacing,
} from "./space-records";

describe("paceListRecordsRequest", () => {
  beforeEach(() => {
    resetListRecordsPacing();
    vi.useRealTimers();
  });

  it("paces concurrent requests by the configured delay", async () => {
    const timestamps: number[] = [];
    const minSpacingMs = 50;

    const task1 = paceListRecordsRequest(async () => {
      timestamps.push(Date.now());
      return "task1";
    }, minSpacingMs);

    const task2 = paceListRecordsRequest(async () => {
      timestamps.push(Date.now());
      return "task2";
    }, minSpacingMs);

    const task3 = paceListRecordsRequest(async () => {
      timestamps.push(Date.now());
      return "task3";
    }, minSpacingMs);

    const results = await Promise.all([task1, task2, task3]);

    expect(results).toEqual(["task1", "task2", "task3"]);
    expect(timestamps).toHaveLength(3);
    expect(timestamps[1]! - timestamps[0]!).toBeGreaterThanOrEqual(minSpacingMs - 5);
    expect(timestamps[2]! - timestamps[1]!).toBeGreaterThanOrEqual(minSpacingMs - 5);
  });

  it("executes immediately when delayMs is 0", async () => {
    const start = Date.now();
    await paceListRecordsRequest(async () => "fast", 0);
    expect(Date.now() - start).toBeLessThan(30);
  });
});

describe("listAllSpaceRecords", () => {
  beforeEach(() => {
    resetListRecordsPacing();
  });

  it("fetches multiple pages respecting options", async () => {
    const mockListRecords = vi
      .fn()
      .mockResolvedValueOnce({
        data: {
          records: [
            { collection: "media", rkey: "r1", cid: "c1", value: { title: "photo1" } },
          ],
          cursor: "cursor1",
        },
      })
      .mockResolvedValueOnce({
        data: {
          records: [
            { collection: "media", rkey: "r2", cid: "c2", value: { title: "photo2" } },
          ],
          cursor: undefined,
        },
      });

    const fakeAgent = {
      com: {
        atproto: {
          space: {
            listRecords: mockListRecords,
          },
        },
      },
    } as unknown as Agent;

    const records = await listAllSpaceRecords(
      fakeAgent,
      { space: "space:1", repo: "did:example:alice", collection: "media" },
      { delayMs: 0 },
    );

    expect(mockListRecords).toHaveBeenCalledTimes(2);
    expect(records).toHaveLength(2);
    expect(records[0]?.uri).toBe("space:1/did:example:alice/media/r1");
    expect(records[1]?.uri).toBe("space:1/did:example:alice/media/r2");
  });
});
