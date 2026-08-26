import { describe, expect, it } from "vitest";

import { MEDIA_LIMITS, validateMediaCandidate } from "../src/index.js";

describe("validateMediaCandidate", () => {
  it("accepts an image exactly at the image byte limit", () => {
    expect(
      validateMediaCandidate({
        canDecode: true,
        declaredMime: "image/jpeg",
        sizeBytes: MEDIA_LIMITS.imageOriginalBytes,
        sniffedMime: "image/jpeg",
      }),
    ).toEqual({ accepted: true, kind: "image", mime: "image/jpeg" });
  });

  it("rejects SVG even when the browser can decode it", () => {
    const result = validateMediaCandidate({
      canDecode: true,
      declaredMime: "image/svg+xml",
      sizeBytes: 1_024,
      sniffedMime: "image/svg+xml",
    });

    expect(result.accepted).toBe(false);
    if (!result.accepted) {
      expect(result.issues.map((issue) => issue.code)).toContain("unsupported-mime");
    }
  });

  it("rejects declared and sniffed MIME mismatches", () => {
    const result = validateMediaCandidate({
      canDecode: true,
      declaredMime: "image/png",
      sizeBytes: 1_024,
      sniffedMime: "image/jpeg",
    });

    expect(result.accepted).toBe(false);
    if (!result.accepted) {
      expect(result.issues.map((issue) => issue.code)).toContain("mime-mismatch");
    }
  });

  it("accepts a silent H.264 MP4 at both limits", () => {
    expect(
      validateMediaCandidate({
        canDecode: true,
        declaredMime: "video/mp4",
        durationSeconds: MEDIA_LIMITS.videoDurationSeconds,
        sizeBytes: MEDIA_LIMITS.videoOriginalBytes,
        sniffedMime: "video/mp4",
        videoCodec: "h264",
      }),
    ).toEqual({ accepted: true, kind: "video", mime: "video/mp4" });
  });

  it("rejects an overlong MP4 with incompatible codecs", () => {
    const result = validateMediaCandidate({
      audioCodec: "opus",
      canDecode: true,
      declaredMime: "video/mp4",
      durationSeconds: 61,
      sizeBytes: 1_024,
      sniffedMime: "video/mp4",
      videoCodec: "vp9",
    });

    expect(result.accepted).toBe(false);
    if (!result.accepted) {
      expect(result.issues.map((issue) => issue.code)).toEqual(
        expect.arrayContaining([
          "unsupported-audio-codec",
          "unsupported-video-codec",
          "video-too-long",
        ]),
      );
    }
  });
});

