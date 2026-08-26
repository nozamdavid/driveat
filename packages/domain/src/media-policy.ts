import { MEDIA_LIMITS, MEBIBYTE } from "./limits.js";

export const ACCEPTED_IMAGE_MIME_TYPES = [
  "image/avif",
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

export const ACCEPTED_VIDEO_MIME_TYPES = ["video/mp4"] as const;

export type AcceptedImageMime = (typeof ACCEPTED_IMAGE_MIME_TYPES)[number];
export type AcceptedVideoMime = (typeof ACCEPTED_VIDEO_MIME_TYPES)[number];
export type AcceptedMediaMime = AcceptedImageMime | AcceptedVideoMime;
export type MediaKind = "image" | "video";

export type MediaCandidate = Readonly<{
  audioCodec?: string;
  canDecode: boolean;
  declaredMime: string;
  durationSeconds?: number;
  sizeBytes: number;
  sniffedMime: string;
  videoCodec?: string;
}>;

export type MediaPolicyIssueCode =
  | "cannot-decode"
  | "invalid-duration"
  | "invalid-size"
  | "mime-mismatch"
  | "unsupported-audio-codec"
  | "unsupported-mime"
  | "unsupported-video-codec"
  | "video-too-long"
  | "file-too-large";

export type MediaPolicyIssue = Readonly<{
  code: MediaPolicyIssueCode;
  message: string;
}>;

export type MediaPolicyResult =
  | Readonly<{
      accepted: true;
      kind: MediaKind;
      mime: AcceptedMediaMime;
    }>
  | Readonly<{
      accepted: false;
      issues: readonly MediaPolicyIssue[];
    }>;

const acceptedImages = new Set<string>(ACCEPTED_IMAGE_MIME_TYPES);
const acceptedVideos = new Set<string>(ACCEPTED_VIDEO_MIME_TYPES);

export function validateMediaCandidate(candidate: MediaCandidate): MediaPolicyResult {
  const issues: MediaPolicyIssue[] = [];
  const kind = mediaKindFor(candidate.sniffedMime);

  if (!Number.isSafeInteger(candidate.sizeBytes) || candidate.sizeBytes <= 0) {
    issues.push({ code: "invalid-size", message: "File size must be a positive integer." });
  }

  if (candidate.declaredMime !== candidate.sniffedMime) {
    issues.push({
      code: "mime-mismatch",
      message: "The declared media type does not match the file signature.",
    });
  }

  if (kind === undefined) {
    issues.push({
      code: "unsupported-mime",
      message: `Media type ${candidate.sniffedMime || "unknown"} is not supported.`,
    });
  }

  if (!candidate.canDecode) {
    issues.push({ code: "cannot-decode", message: "The browser could not decode this file." });
  }

  if (kind === "image" && candidate.sizeBytes > MEDIA_LIMITS.imageOriginalBytes) {
    issues.push({
      code: "file-too-large",
      message: `Image originals must not exceed ${MEDIA_LIMITS.imageOriginalBytes / MEBIBYTE} MiB.`,
    });
  }

  if (kind === "video") {
    validateVideo(candidate, issues);
  }

  if (issues.length > 0) {
    return { accepted: false, issues };
  }

  // An unsupported sniffed MIME type always pushes an issue above,
  // so reaching this point proves the kind is defined.
  return {
    accepted: true,
    kind: kind as MediaKind,
    mime: candidate.sniffedMime as AcceptedMediaMime,
  };
}

function mediaKindFor(mime: string): MediaKind | undefined {
  if (acceptedImages.has(mime)) {
    return "image";
  }
  if (acceptedVideos.has(mime)) {
    return "video";
  }
  return undefined;
}

function validateVideo(candidate: MediaCandidate, issues: MediaPolicyIssue[]): void {
  if (candidate.sizeBytes > MEDIA_LIMITS.videoOriginalBytes) {
    issues.push({
      code: "file-too-large",
      message: `Video originals must not exceed ${MEDIA_LIMITS.videoOriginalBytes / MEBIBYTE} MiB.`,
    });
  }

  if (
    candidate.durationSeconds === undefined ||
    !Number.isFinite(candidate.durationSeconds) ||
    candidate.durationSeconds <= 0
  ) {
    issues.push({
      code: "invalid-duration",
      message: "Video duration must be a positive finite number.",
    });
  } else if (candidate.durationSeconds > MEDIA_LIMITS.videoDurationSeconds) {
    issues.push({
      code: "video-too-long",
      message: `Videos must not exceed ${MEDIA_LIMITS.videoDurationSeconds} seconds.`,
    });
  }

  if (candidate.videoCodec?.toLowerCase() !== "h264") {
    issues.push({
      code: "unsupported-video-codec",
      message: "MP4 video must use the H.264 video codec.",
    });
  }

  if (candidate.audioCodec !== undefined && candidate.audioCodec.toLowerCase() !== "aac") {
    issues.push({
      code: "unsupported-audio-codec",
      message: "MP4 audio must use AAC when an audio track is present.",
    });
  }
}

