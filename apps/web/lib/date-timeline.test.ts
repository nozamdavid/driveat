import { describe, expect, it } from "vitest";

import {
  clampTimelineIndex,
  sparseTimelineIndexes,
  timelineIndexAtPosition,
  timelineMonthLabel,
  timelinePosition,
  timelineUsesMonthLabels,
  timelineYearLabel,
} from "./date-timeline";

describe("date timeline", () => {
  it("places the first and last groups at the ends of the rail", () => {
    expect(timelinePosition(0, 5)).toBe(0);
    expect(timelinePosition(2, 5)).toBe(50);
    expect(timelinePosition(4, 5)).toBe(100);
  });

  it("maps pointer positions to the nearest date group", () => {
    expect(timelineIndexAtPosition(0, 5)).toBe(0);
    expect(timelineIndexAtPosition(0.5, 5)).toBe(2);
    expect(timelineIndexAtPosition(1, 5)).toBe(4);
  });

  it("clamps a stale active index after date groups are deleted", () => {
    expect(clampTimelineIndex(8, 3)).toBe(2);
    expect(clampTimelineIndex(8, 0)).toBe(0);
  });

  it("labels only the first date group in each year", () => {
    expect(timelineYearLabel("2026-08-28")).toBe("2026");
    expect(timelineYearLabel("2026-06-10", "2026-08-28")).toBeUndefined();
    expect(timelineYearLabel("2025-12-31", "2026-06-10")).toBe("2025");
    expect(timelineYearLabel("unknown", "2025-12-31")).toBe("Unknown");
  });

  it("uses month landmarks when all dated groups belong to one year", () => {
    expect(timelineUsesMonthLabels(["2026-08-28", "2026-01-02", "unknown"])).toBe(true);
    expect(timelineUsesMonthLabels(["2026-08-28", "2025-12-31"])).toBe(false);
    expect(timelineMonthLabel("2026-08-28")).toBe("Aug");
    expect(timelineMonthLabel("2026-08-01", "2026-08-28")).toBeUndefined();
    expect(timelineMonthLabel("2026-07-31", "2026-08-01")).toBe("Jul");
  });

  it("caps ordinary dots while preserving period landmarks and endpoints", () => {
    const indexes = sparseTimelineIndexes(100, [0, 20, 40, 60, 80], 12);
    expect(indexes.length).toBeLessThanOrEqual(12);
    expect(indexes).toEqual(expect.arrayContaining([0, 20, 40, 60, 80, 99]));
  });
});
