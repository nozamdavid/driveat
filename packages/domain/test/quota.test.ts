import { fixedClock } from "@atgallery/testkit";
import { describe, expect, it } from "vitest";

import {
  GIBIBYTE,
  ROLLING_QUOTA_WINDOW_MS,
  calculateRollingQuota,
  type TransferEvent,
} from "../src/index.js";

const now = fixedClock("2026-08-21T12:00:00.000Z")();

function event(overrides: Partial<TransferEvent> = {}): TransferEvent {
  return {
    blobOperations: 2,
    completedAt: new Date(now.getTime() - 60_000),
    items: 1,
    operation: "private-ingest",
    transferredBytes: 10,
    ...overrides,
  };
}

describe("calculateRollingQuota", () => {
  it("includes an event exactly on the rolling cutoff", () => {
    const result = calculateRollingQuota([
      event({ completedAt: new Date(now.getTime() - ROLLING_QUOTA_WINDOW_MS) }),
    ], now);

    expect(result.usage.items).toBe(1);
  });

  it("excludes old and future events", () => {
    const result = calculateRollingQuota(
      [
        event({ completedAt: new Date(now.getTime() - ROLLING_QUOTA_WINDOW_MS - 1) }),
        event({ completedAt: new Date(now.getTime() + 1) }),
      ],
      now,
    );

    expect(result.usage).toEqual({ blobOperations: 0, items: 0, transferredBytes: 0 });
  });

  it("allows a proposal exactly at every remaining limit", () => {
    const result = calculateRollingQuota([], now, {
      blobOperations: 400,
      items: 100,
      transferredBytes: GIBIBYTE,
    });

    expect(result.allowed).toBe(true);
  });

  it("rejects a proposal that exceeds any one limit", () => {
    const result = calculateRollingQuota([], now, {
      blobOperations: 401,
      items: 1,
      transferredBytes: 1,
    });

    expect(result.allowed).toBe(false);
  });

  it("rejects invalid negative event amounts", () => {
    expect(() => calculateRollingQuota([event({ items: -1 })], now)).toThrow(TypeError);
  });
});

