"use client";

import { calculateRollingQuota, type TransferEvent } from "@atgallery/domain";
import { Agent } from "@atproto/api";
import type { OAuthSession } from "@atproto/oauth-client-browser";
import { type FormEvent, useState } from "react";

import { errorMessage } from "../../lib/error-message";
import {
  preparePrivateImage,
  PRIVATE_IMAGE_MIME_TYPES,
} from "../../lib/private-image";
import { readCachedTransferEvents, recentTransferEvents } from "../../lib/transfer-quota";
import { effectiveLibraryBlobLimit, formatBlobLimit } from "../../lib/pds-blob-limit";
import { libraryUploadFits } from "../../lib/storage-total";
import {
  indexLibraryRecords,
  type LibraryMedia,
} from "../../lib/private-library";

export type PrivateImageUploadResult = Readonly<{
  media: LibraryMedia;
  original: File;
  preview: Blob;
  transferEvents: readonly TransferEvent[];
}>;

type UploadStage = "idle" | "preparing" | "checking-quota" | "uploading" | "writing";

type Props = Readonly<{
  blobUploadLimit?: number | undefined;
  libraryStorageBytes: number;
  libraryMediaCollection: string;
  onUploaded?: (result: PrivateImageUploadResult) => Promise<void> | void;
  session: OAuthSession;
  spaceUri: string;
  transferEventCollection: string;
}>;

function messageForStage(stage: UploadStage): string | undefined {
  switch (stage) {
    case "preparing":
      return "Validating the file, hashing it, and generating a metadata-stripped preview…";
    case "checking-quota":
      return "Checking the rolling 24-hour transfer guardrail…";
    case "uploading":
      return "Uploading the private original and preview to your PDS…";
    case "writing":
      return "Creating the private media and transfer records in your Space…";
    case "idle":
      return undefined;
  }
}

export function PrivateImageUpload({
  blobUploadLimit,
  libraryStorageBytes,
  libraryMediaCollection,
  onUploaded,
  session,
  spaceUri,
  transferEventCollection,
}: Props) {
  const [file, setFile] = useState<File>();
  const [stage, setStage] = useState<UploadStage>("idle");
  const [error, setError] = useState<string>();
  const busy = stage !== "idle";

  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file || busy) return;
    const form = event.currentTarget;

    setError(undefined);
    setStage("preparing");

    try {
      if (!blobUploadLimit) throw new Error("The PDS did not advertise a usable blob upload limit.");
      const effectiveLimit = effectiveLibraryBlobLimit(blobUploadLimit);
      if (!libraryUploadFits(libraryStorageBytes, [file.size])) {
        throw new Error("This upload would exceed the permanent 2 GiB Library storage limit.");
      }
      const prepared = await preparePrivateImage(file, effectiveLimit);
      if (!libraryUploadFits(libraryStorageBytes, [file.size, prepared.preview.size])) {
        throw new Error("This upload would exceed the permanent 2 GiB Library storage limit.");
      }
      const agent = new Agent(session);
      const now = new Date();

      setStage("checking-quota");
      const events = readCachedTransferEvents(session.did, spaceUri, now) ??
        await recentTransferEvents(
          agent,
          spaceUri,
          session.did,
          transferEventCollection,
          now,
        );
      const quota = calculateRollingQuota(events, now, {
        blobOperations: 2,
        items: 1,
        transferredBytes: file.size + prepared.preview.size,
      });
      if (!quota.allowed) {
        throw new Error(
          "This upload would exceed the advisory rolling 24-hour item, byte, or blob-operation limit.",
        );
      }

      setStage("uploading");
      const [originalResponse, previewResponse] = await Promise.all([
        agent.uploadBlob(file, { encoding: prepared.mime }),
        agent.uploadBlob(prepared.preview, { encoding: "image/webp" }),
      ]);
      const original = originalResponse.data.blob;
      const preview = previewResponse.data.blob;
      const createdAt = now.toISOString();
      const mediaRecord = {
        $type: libraryMediaCollection,
        formatVersion: 1,
        mediaKind: "image",
        original,
        originalFilename: file.name,
        originalMime: prepared.mime,
        originalSize: file.size,
        preview,
        sha256: prepared.sha256,
        width: prepared.width,
        height: prepared.height,
        createdAt,
      };
      const transferEvent: TransferEvent = {
        operation: "private-ingest",
        transferredBytes: original.size + preview.size,
        blobOperations: 2,
        items: 1,
        completedAt: now,
      };

      setStage("writing");
      const writeResponse = await agent.com.atproto.space.applyWrites({
        space: spaceUri,
        repo: session.did,
        writes: [
          {
            $type: "com.atproto.space.applyWrites#create",
            collection: libraryMediaCollection,
            value: mediaRecord,
          },
          {
            $type: "com.atproto.space.applyWrites#create",
            collection: transferEventCollection,
            value: {
              $type: transferEventCollection,
              formatVersion: 1,
              operation: "ingest",
              logicalBytes: original.size + preview.size,
              blobOperations: 2,
              itemCount: 1,
              createdAt,
            },
          },
        ],
      });

      const result = writeResponse.data.results?.[0];
      if (!result || !("uri" in result) || !("cid" in result)) {
        throw new Error("The PDS created the records but did not return the media record reference.");
      }
      const uploadedMedia = indexLibraryRecords({
        media: [{ uri: result.uri, cid: result.cid, value: mediaRecord }],
        albums: [],
        memberships: [],
      }).media[0];
      if (!uploadedMedia) {
        throw new Error("The uploaded media record could not be added to the local Library.");
      }

      setFile(undefined);
      form.reset();
      await onUploaded?.({
        media: uploadedMedia,
        original: file,
        preview: prepared.preview,
        transferEvents: [...events, transferEvent],
      });
    } catch (caught: unknown) {
      setError(errorMessage(caught, "The private image upload failed."));
    } finally {
      setStage("idle");
    }
  }

  return (
    <section className="private-upload" aria-labelledby="private-upload-title">
      <h2 id="private-upload-title">Private image test</h2>
      <p>
        The original and generated preview are referenced only by a record in your owner-only
        Space. Your PDS operator can read them; other PDS users cannot.
      </p>
      <form onSubmit={upload}>
        <label htmlFor="private-image">
          JPEG, PNG, WebP, GIF, or AVIF · maximum {blobUploadLimit ? formatBlobLimit(effectiveLibraryBlobLimit(blobUploadLimit)) : "checking PDS…"}
        </label>
        <input
          id="private-image"
          type="file"
          accept={PRIVATE_IMAGE_MIME_TYPES.join(",")}
          disabled={busy || !blobUploadLimit}
          onChange={(event) => setFile(event.target.files?.[0])}
        />
        <button type="submit" disabled={!file || busy}>
          {busy ? "Posting privately…" : "Post private image"}
        </button>
      </form>
      {messageForStage(stage) ? <p className="upload-progress">{messageForStage(stage)}</p> : null}
      {error ? <p className="oauth-error" role="alert">{error}</p> : null}
    </section>
  );
}
