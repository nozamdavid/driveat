import { MEDIA_LIMITS, MEBIBYTE } from "@atgallery/domain";

export const PRIVATE_IMAGE_MIME_TYPES = [
  "image/avif",
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

export type PrivateImageMime = (typeof PRIVATE_IMAGE_MIME_TYPES)[number];

export type PreparedPrivateImage = Readonly<{
  height: number;
  mime: PrivateImageMime;
  preview: Blob;
  sha256: string;
  width: number;
}>;

const acceptedMimes = new Set<string>(PRIVATE_IMAGE_MIME_TYPES);

const PREVIEW_MAX_LONG_EDGE = 1600;
const PREVIEW_INITIAL_QUALITY = 0.86;
const PREVIEW_QUALITY_STEP = 0.08;
const PREVIEW_MIN_QUALITY = 0.45;
const PREVIEW_SCALE_SHRINK = 0.78;
const PREVIEW_MAX_ATTEMPTS = 6;

export function sniffImageMime(bytes: Uint8Array): PrivateImageMime | undefined {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "image/png";
  }

  const ascii = new TextDecoder("ascii").decode(bytes);
  if (ascii.startsWith("GIF87a") || ascii.startsWith("GIF89a")) return "image/gif";
  if (ascii.startsWith("RIFF") && ascii.slice(8, 12) === "WEBP") return "image/webp";
  if (ascii.slice(4, 8) === "ftyp" && /avif|avis/.test(ascii.slice(8, 32))) {
    return "image/avif";
  }
  return undefined;
}

export async function validatePrivateImageFile(file: File): Promise<PrivateImageMime> {
  if (file.size <= 0) throw new Error("Choose a non-empty image file.");
  if (file.size > MEDIA_LIMITS.imageOriginalBytes) {
    throw new Error(
      `Private image originals must not exceed ${MEDIA_LIMITS.imageOriginalBytes / MEBIBYTE} MiB.`,
    );
  }
  if (!acceptedMimes.has(file.type)) {
    throw new Error("Choose a JPEG, PNG, WebP, GIF, or AVIF image.");
  }

  const sniffed = sniffImageMime(new Uint8Array(await file.slice(0, 32).arrayBuffer()));
  if (!sniffed) throw new Error("The selected file does not have a supported image signature.");
  if (sniffed !== file.type) {
    throw new Error(`The file signature is ${sniffed}, but the browser declared ${file.type}.`);
  }
  return sniffed;
}

function canvasBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error("This browser could not encode a WebP preview."));
      },
      "image/webp",
      quality,
    );
  });
}

async function decodeImage(file: File): Promise<HTMLImageElement> {
  const objectUrl = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.decoding = "async";
    image.src = objectUrl;
    await image.decode();
    return image;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export async function preparePrivateImage(file: File): Promise<PreparedPrivateImage> {
  const mime = await validatePrivateImageFile(file);
  const image = await decodeImage(file);
  const width = image.naturalWidth;
  const height = image.naturalHeight;
  if (width <= 0 || height <= 0) throw new Error("The image has invalid dimensions.");

  const longEdge = Math.max(width, height);
  let scale = Math.min(1, PREVIEW_MAX_LONG_EDGE / longEdge);
  let preview: Blob | undefined;

  // Retry drops quality, then scales down, until the WebP fits the preview byte budget.
  for (let attempt = 0; attempt < PREVIEW_MAX_ATTEMPTS; attempt += 1) {
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("This browser cannot generate an image preview.");
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    preview = await canvasBlob(
      canvas,
      Math.max(PREVIEW_MIN_QUALITY, PREVIEW_INITIAL_QUALITY - attempt * PREVIEW_QUALITY_STEP),
    );
    if (preview.type === "image/webp" && preview.size <= MEDIA_LIMITS.previewBytes) break;
    scale *= PREVIEW_SCALE_SHRINK;
  }

  if (!preview || preview.type !== "image/webp" || preview.size > MEDIA_LIMITS.previewBytes) {
    throw new Error(
      `The generated WebP preview could not be kept below ${MEDIA_LIMITS.previewBytes / MEBIBYTE} MiB.`,
    );
  }

  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  const sha256 = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  return { height, mime, preview, sha256, width };
}

export function pdslsSpaceRecordUrl(recordUri: string): string {
  const parts = recordUri.replace(/^at:\/\//, "").split("/");
  // Index 4 is the repo DID segment; the PDSls route omits it.
  const [authority, marker, spaceType, skey, , collection, rkey] = parts;
  if (!authority || marker !== "space" || !spaceType || !skey || !collection || !rkey) {
    throw new TypeError("Expected a complete permissioned Space record URI.");
  }
  const route = [authority, spaceType, skey, collection, rkey]
    .map(encodeURIComponent)
    .join("/");
  return `https://pdsls.dev/spaces/${route}`;
}

export function authenticatedSpaceBlobUrl(
  pdsUrl: string,
  space: string,
  repo: string,
  cid: string,
): string {
  const url = new URL("/xrpc/com.atproto.space.getBlob", pdsUrl);
  url.searchParams.set("space", space);
  url.searchParams.set("repo", repo);
  url.searchParams.set("cid", cid);
  return url.toString();
}
