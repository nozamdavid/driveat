const kibibyte = 1_024;

export const MEBIBYTE = kibibyte * kibibyte;
export const GIBIBYTE = MEBIBYTE * kibibyte;
export const ROLLING_QUOTA_WINDOW_MS = 24 * 60 * 60 * 1_000;

export const MEDIA_LIMITS = Object.freeze({
  imageOriginalBytes: 25 * MEBIBYTE,
  previewBytes: MEBIBYTE,
  videoDurationSeconds: 60,
  videoOriginalBytes: 50 * MEBIBYTE,
});

export const ROLLING_QUOTA_LIMITS = Object.freeze({
  blobOperations: 400,
  items: 100,
  transferredBytes: GIBIBYTE,
});

export const LIBRARY_LIMITS = Object.freeze({
  storedBytes: 2 * GIBIBYTE,
});

export const OPERATIONAL_LIMITS = Object.freeze({
  albumItems: 1_000,
  concurrentBlobUploads: 2,
  directFallbackPages: 50,
  directFallbackRecords: 5_000,
  selectedFilesPerBatch: 20,
});
