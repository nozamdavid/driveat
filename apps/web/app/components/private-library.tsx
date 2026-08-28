"use client";

import { LIBRARY_LIMITS, ROLLING_QUOTA_LIMITS } from "@atgallery/domain";
import { Agent } from "@atproto/api";
import type { OAuthSession } from "@atproto/oauth-client-browser";
import {
  type FormEvent,
  type MouseEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { eligibleAlbumsForTargets, unmemberedTargetUris } from "../../lib/album-picker";
import { errorMessage } from "../../lib/error-message";
import {
  canUseLibrarySnapshot,
  readLibrarySnapshot,
  writeLibrarySnapshot,
  type LibraryWatermarks,
} from "../../lib/library-snapshot";
import { pruneSelectedUris, toggleSelectedUri } from "../../lib/media-selection";
import { clampMenuPosition, type Point, type Size } from "../../lib/menu-position";
import { fetchGatewayBlob, type MediaGatewayAccess } from "../../lib/media-gateway";
import {
  getCachedOriginal,
  isOriginalCached,
  setCachedOriginal,
} from "../../lib/full-image-cache";
import {
  cachePreviewBlob,
  prunePreviewCache,
  purgeLegacyPreviewDataUrls,
  readCachedPreview,
} from "../../lib/preview-cache";
import { useInView } from "../../lib/use-in-view";
import {
  groupMediaByDay,
  appendMediaToLibrary,
  findDuplicateMedia,
  indexLibraryRecords,
  type DuplicateMediaGroup,
  type LibraryAlbum,
  type LibraryMedia,
  type LibraryMembership,
  type RawSpaceRecord,
  latestRecordKey,
  nextMembershipPosition,
  recordKeyFromAtUri,
  removeMediaFromLibrary,
} from "../../lib/private-library";
import {
  fetchRemoteLibraryIndex,
  publishRemoteLibraryIndex,
} from "../../lib/library-index";
import { listAllSpaceRecords } from "../../lib/space-records";
import { formatBytes, privateLibraryStorageBytes } from "../../lib/storage-total";
import {
  readCachedTransferEvents,
  recentTransferEvents,
  transferQuotaStatus,
  writeCachedTransferEvents,
  type TransferQuotaStatus,
} from "../../lib/transfer-quota";
import {
  PrivateImageUpload,
  type PrivateImageUploadResult,
} from "./private-image-upload";

type Props = Readonly<{
  albumCollection: string;
  blobUploadLimit?: number | undefined;
  libraryIndexCollection?: string | undefined;
  libraryMediaCollection: string;
  mediaGatewayAccess?: MediaGatewayAccess | undefined;
  membershipCollection: string;
  session: OAuthSession;
  spaceUri: string;
  transferEventCollection: string;
}>;

type LibraryState = Readonly<{
  albums: readonly LibraryAlbum[];
  media: readonly LibraryMedia[];
  memberships: readonly LibraryMembership[];
}>;

const EMPTY_LIBRARY: LibraryState = { albums: [], media: [], memberships: [] };

const ALL_MEDIA = "all";

const EMPTY_SELECTION: ReadonlySet<string> = new Set();

const LIBRARY_REQUEST_FAILED = "The private Library request failed.";

// Rough on-screen size of the context menu, used to clamp it inside the
// viewport before the real element can be measured.
const CONTEXT_MENU_SIZE: Size = { width: 184, height: 184 };

function viewportSize(): Size {
  return typeof window === "undefined"
    ? { width: 0, height: 0 }
    : { width: window.innerWidth, height: window.innerHeight };
}

type ContextMenuState = Readonly<{ media: LibraryMedia; position: Point }>;

function useDismissDialogOnEscape(disabled: boolean, onDismiss: () => void): void {
  useEffect(() => {
    if (disabled) return;

    function dismissDialogOnEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onDismiss();
    }

    window.addEventListener("keydown", dismissDialogOnEscape);
    return () => window.removeEventListener("keydown", dismissDialogOnEscape);
  }, [disabled, onDismiss]);
}

function formatRecoveryTime(date: Date): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
    ...(date.toDateString() === new Date().toDateString()
      ? {}
      : { month: "short", day: "numeric" }),
  }).format(date);
}

// The carousel and grid both render the cached WebP preview; originals are
// only ever fetched for explicit downloads.
function PrivatePreviewImage({
  className,
  eager = false,
  media,
  mediaGatewayAccess,
}: Readonly<{
  className?: string | undefined;
  eager?: boolean | undefined;
  media: LibraryMedia;
  mediaGatewayAccess?: MediaGatewayAccess | undefined;
}>) {
  // Cache hits render instantly from IndexedDB; misses fetch once and backfill the cache.
  const [source, setSource] = useState<string>();
  const [failed, setFailed] = useState(false);
  const [targetRef, inView] = useInView({ disabled: eager || !!source });
  const shouldFetch = eager || inView;

  useEffect(() => {
    let active = true;
    let objectUrl: string | undefined;

    const show = (blob: Blob) => {
      if (!active) return;
      objectUrl = URL.createObjectURL(blob);
      setSource(objectUrl);
    };

    void (async () => {
      try {
        const cached = await readCachedPreview(media.previewCid);
        if (cached) {
          show(cached);
          return;
        }
        if (!shouldFetch) {
          return;
        }
        if (!mediaGatewayAccess) {
          throw new Error("Media gateway is not connected.");
        }
        const response = await fetchGatewayBlob(mediaGatewayAccess, media.previewCid, "image/webp");
        if (!response.ok) throw new Error(`Gateway returned HTTP ${response.status}`);
        const blob = await response.blob();
        show(blob);
        void cachePreviewBlob(media.previewCid, blob);
      } catch {
        if (active) setFailed(true);
      }
    })();

    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [media.previewCid, mediaGatewayAccess, shouldFetch]);

  return source ? (
    // The private filename is the best available label until editable alt text lands.
    // eslint-disable-next-line @next/next/no-img-element
    <img className={className} src={source} alt={media.filename} />
  ) : (
    <div
      ref={targetRef}
      className={className ?? "preview-placeholder"}
      aria-label={
        failed
          ? `Preview unavailable for ${media.filename}`
          : `Loading preview for ${media.filename}`
      }
    />
  );
}

function metadataEntries(media: LibraryMedia): readonly [string, string][] {
  const basic: [string, string][] = [
    ["Filename", media.filename],
    ["Type", media.mime],
    ["Size", `${media.size.toLocaleString()} bytes`],
    ["Dimensions", media.width && media.height ? `${media.width} × ${media.height}` : "Not recorded"],
    ["Added", new Date(media.createdAt).toLocaleString()],
  ];
  const extracted = Object.entries(media.metadata ?? {}).flatMap(([key, value]) =>
    typeof value === "string" || typeof value === "number" || typeof value === "boolean"
      ? [[key, String(value)] as [string, string]]
      : [],
  );
  return [...basic, ...(media.sha256 ? [["SHA-256", media.sha256] as [string, string]] : []), ...extracted];
}

function PrivateViewerImage({
  className,
  media,
  mediaGatewayAccess,
}: Readonly<{
  className?: string | undefined;
  media: LibraryMedia;
  mediaGatewayAccess?: MediaGatewayAccess | undefined;
}>) {
  const [source, setSource] = useState<string>();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    let objectUrl: string | undefined;
    let fullObjectUrl: string | undefined;

    const show = (blob: Blob, isFull: boolean) => {
      if (!active) return;
      const url = URL.createObjectURL(blob);
      if (isFull) {
        fullObjectUrl = url;
        setSource(url);
      } else {
        objectUrl = url;
        setSource((prev) => (fullObjectUrl ? prev : url));
      }
    };

    void (async () => {
      try {
        // Step 1: Render cached full-resolution original immediately if in memory
        const cachedFull = getCachedOriginal(media.originalCid);
        if (cachedFull && active) {
          show(cachedFull, true);
          return;
        }

        // Step 2: Render cached preview immediately if available
        const cachedPreview = await readCachedPreview(media.previewCid);
        if (cachedPreview && active) {
          show(cachedPreview, false);
        }

        if (!mediaGatewayAccess) {
          return;
        }

        // Step 3: If preview was not cached, fetch preview
        if (!cachedPreview) {
          const previewResp = await fetchGatewayBlob(
            mediaGatewayAccess,
            media.previewCid,
            "image/webp",
          );
          if (previewResp.ok && active) {
            const previewBlob = await previewResp.blob();
            show(previewBlob, false);
            void cachePreviewBlob(media.previewCid, previewBlob);
          }
        }

        // Step 4: Fetch full-resolution original image and store in memory cache
        if (media.originalCid) {
          const fullResp = await fetchGatewayBlob(
            mediaGatewayAccess,
            media.originalCid,
            media.mime,
          );
          if (fullResp.ok && active) {
            const fullBlob = await fullResp.blob();
            setCachedOriginal(media.originalCid, fullBlob);
            show(fullBlob, true);
          }
        }
      } catch {
        if (active) setFailed(true);
      }
    })();

    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      if (fullObjectUrl) URL.revokeObjectURL(fullObjectUrl);
    };
  }, [media.previewCid, media.originalCid, media.mime, mediaGatewayAccess]);

  return source ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img className={className} src={source} alt={media.filename} />
  ) : (
    <div
      className={className ?? "preview-placeholder"}
      aria-label={
        failed
          ? `Image unavailable for ${media.filename}`
          : `Loading photo for ${media.filename}`
      }
    />
  );
}

function PhotoViewer({
  activeMedia,
  activeMediaIndex,
  mediaGatewayAccess,
  mutating,
  onClose,
  onDelete,
  onDownload,
  onNavigate,
  orderedMedia,
}: Readonly<{
  activeMedia: LibraryMedia;
  activeMediaIndex: number;
  mediaGatewayAccess?: MediaGatewayAccess | undefined;
  mutating: boolean;
  onClose: () => void;
  onDelete: (media: LibraryMedia) => void;
  onDownload: (media: LibraryMedia) => void;
  onNavigate: (uri?: string) => void;
  orderedMedia: readonly LibraryMedia[];
}>) {
  const [viewerMenuOpen, setViewerMenuOpen] = useState(false);
  const [viewerInfoOpen, setViewerInfoOpen] = useState(false);

  useEffect(() => {
    function closeViewerOnKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
      const next = activeMediaIndex + (event.key === "ArrowRight" ? 1 : -1);
      if (next < 0 || next >= orderedMedia.length) return;
      event.preventDefault();
      onNavigate(orderedMedia[next]?.uri);
    }

    window.addEventListener("keydown", closeViewerOnKey);
    return () => window.removeEventListener("keydown", closeViewerOnKey);
  }, [activeMediaIndex, onClose, onNavigate, orderedMedia]);

  // Lazy prefetch adjacent media for instant navigation (prioritizing forward navigation)
  useEffect(() => {
    if (!mediaGatewayAccess) return;
    const nextMedia =
      activeMediaIndex < orderedMedia.length - 1 ? orderedMedia[activeMediaIndex + 1] : undefined;
    const prevMedia = activeMediaIndex > 0 ? orderedMedia[activeMediaIndex - 1] : undefined;
    const candidates = [nextMedia, prevMedia].filter((m): m is LibraryMedia => !!m);

    for (const m of candidates) {
      void (async () => {
        try {
          const cached = await readCachedPreview(m.previewCid);
          if (!cached) {
            const resp = await fetchGatewayBlob(mediaGatewayAccess, m.previewCid, "image/webp");
            if (resp.ok) {
              const blob = await resp.blob();
              void cachePreviewBlob(m.previewCid, blob);
            }
          }
          // Only prefetch original if not already cached in memory
          if (m.originalCid && !isOriginalCached(m.originalCid)) {
            const resp = await fetchGatewayBlob(mediaGatewayAccess, m.originalCid, m.mime);
            if (resp.ok) {
              const blob = await resp.blob();
              setCachedOriginal(m.originalCid, blob);
            }
          }
        } catch {
          // Best-effort prefetch
        }
      })();
    }
  }, [activeMediaIndex, mediaGatewayAccess, orderedMedia]);

  return (
    <div className="photo-viewer" role="dialog" aria-modal="true" aria-label={activeMedia.filename}>
      <header className="photo-viewer-bar">
        <button type="button" className="viewer-icon-button" onClick={onClose} aria-label="Close photo viewer">
          <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18" /></svg>
        </button>
        <span>{activeMediaIndex + 1} of {orderedMedia.length}</span>
        <div className="viewer-actions">
          <button
            type="button"
            className="viewer-icon-button"
            onClick={() => setViewerInfoOpen((open) => !open)}
            aria-label="Photo information"
            aria-expanded={viewerInfoOpen}
          >
            <svg aria-hidden="true" viewBox="0 0 24 24">
              <circle cx="12" cy="12" r="9" />
              <path d="M12 11v6M12 7.5h.01" />
            </svg>
          </button>
          <button
            type="button"
            className="viewer-icon-button"
            onClick={() => setViewerMenuOpen((open) => !open)}
            aria-label="More photo actions"
            aria-expanded={viewerMenuOpen}
          >
            <svg aria-hidden="true" viewBox="0 0 24 24">
              <circle cx="12" cy="5" r="1.25" className="filled-icon" />
              <circle cx="12" cy="12" r="1.25" className="filled-icon" />
              <circle cx="12" cy="19" r="1.25" className="filled-icon" />
            </svg>
          </button>
          {viewerMenuOpen ? (
            <div className="viewer-menu">
              <button type="button" disabled={!activeMedia.originalCid} onClick={() => onDownload(activeMedia)}>Download</button>
              <button type="button" className="viewer-delete" disabled={mutating} onClick={() => onDelete(activeMedia)}>Delete</button>
            </div>
          ) : null}
        </div>
      </header>
      <button
        type="button"
        className="viewer-navigation previous"
        disabled={activeMediaIndex <= 0}
        onClick={() => onNavigate(orderedMedia[activeMediaIndex - 1]?.uri)}
        aria-label="Previous photo"
      >
        <svg aria-hidden="true" viewBox="0 0 24 24"><path d="m15 5-7 7 7 7" /></svg>
      </button>
      <PrivateViewerImage
        className="photo-viewer-image"
        media={activeMedia}
        mediaGatewayAccess={mediaGatewayAccess}
      />
      <button
        type="button"
        className="viewer-navigation next"
        disabled={activeMediaIndex >= orderedMedia.length - 1}
        onClick={() => onNavigate(orderedMedia[activeMediaIndex + 1]?.uri)}
        aria-label="Next photo"
      >
        <svg aria-hidden="true" viewBox="0 0 24 24"><path d="m9 5 7 7-7 7" /></svg>
      </button>
      {viewerInfoOpen ? (
        <aside className="viewer-info" aria-label="Photo information">
          <h3>Info</h3>
          <dl>{metadataEntries(activeMedia).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
        </aside>
      ) : null}
    </div>
  );
}

function ContextCardMenu({
  menu,
  mutating,
  onAddToAlbum,
  onDelete,
  onSelect,
  onView,
  onClose,
}: Readonly<{
  menu: ContextMenuState;
  mutating: boolean;
  onAddToAlbum: () => void;
  onDelete: () => void;
  onSelect: () => void;
  onView: () => void;
  onClose: () => void;
}>) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function closeOnPointerDown(event: PointerEvent) {
      if (event.target instanceof Node && menuRef.current?.contains(event.target)) return;
      onClose();
    }
    function dismissMenuOnEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onClose();
    }
    // Scroll events do not bubble, so capture catches every scrollable ancestor.
    function closeOnScroll() {
      onClose();
    }

    window.addEventListener("pointerdown", closeOnPointerDown);
    window.addEventListener("keydown", dismissMenuOnEscape);
    window.addEventListener("scroll", closeOnScroll, true);
    return () => {
      window.removeEventListener("pointerdown", closeOnPointerDown);
      window.removeEventListener("keydown", dismissMenuOnEscape);
      window.removeEventListener("scroll", closeOnScroll, true);
    };
  }, [onClose]);

  return (
    <div
      ref={menuRef}
      className="media-context-menu"
      role="menu"
      aria-label={`Actions for ${menu.media.filename}`}
      style={{ left: `${menu.position.x}px`, top: `${menu.position.y}px` }}
    >
      <button type="button" role="menuitem" onClick={onView}>
        View photo
      </button>
      <button type="button" role="menuitem" disabled={mutating} onClick={onAddToAlbum}>
        Add to album…
      </button>
      <button type="button" role="menuitem" disabled={mutating} onClick={onSelect}>
        Select
      </button>
      <button
        type="button"
        role="menuitem"
        className="context-menu-delete"
        disabled={mutating}
        onClick={onDelete}
      >
        Delete…
      </button>
    </div>
  );
}

function SelectionBar({
  count,
  mutating,
  onAddToAlbum,
  onCancel,
  onDelete,
}: Readonly<{
  count: number;
  mutating: boolean;
  onAddToAlbum: () => void;
  onCancel: () => void;
  onDelete: () => void;
}>) {
  return (
    <div className="selection-bar" role="toolbar" aria-label="Selected photos">
      <strong>{count} selected</strong>
      <div className="selection-bar-actions">
        <button type="button" className="selection-danger-button" disabled={mutating} onClick={onDelete}>
          Delete…
        </button>
        <button type="button" className="selection-action-button" disabled={mutating} onClick={onAddToAlbum}>
          Add to album…
        </button>
        <button type="button" className="selection-cancel-button" disabled={mutating} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function ConfirmDeleteDialog({
  description,
  heading,
  mutating,
  onCancel,
  onConfirm,
}: Readonly<{
  description: string;
  heading: string;
  mutating: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}>) {
  useDismissDialogOnEscape(mutating, onCancel);

  return (
    <div
      className="confirmation-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !mutating) onCancel();
      }}
    >
      <div
        className="confirmation-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-delete-title"
        aria-describedby="confirm-delete-description"
      >
        <p className="confirmation-eyebrow">Delete photos</p>
        <h3 id="confirm-delete-title">{heading}</h3>
        <p id="confirm-delete-description">{description}</p>
        <div className="confirmation-actions">
          <button type="button" className="secondary-button compact-button" disabled={mutating} onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="compact-button confirm-delete-button" disabled={mutating} onClick={onConfirm}>
            {mutating ? "Deleting…" : "Delete"}
          </button>
        </div>
      </div>
    </div>
  );
}

function AlbumPickerDialog({
  albums,
  mutating,
  targetLabel,
  onCreateAlbum,
  onPickAlbum,
  onCancel,
}: Readonly<{
  albums: readonly LibraryAlbum[];
  mutating: boolean;
  targetLabel: string;
  onCreateAlbum: (title: string) => void;
  onPickAlbum: (album: LibraryAlbum) => void;
  onCancel: () => void;
}>) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const [newTitle, setNewTitle] = useState("");

  useEffect(() => {
    dialogRef.current?.focus();
  }, []);

  useDismissDialogOnEscape(mutating, onCancel);

  function createAndAdd(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const title = newTitle.trim();
    if (!title || mutating) return;
    onCreateAlbum(title);
  }

  return (
    <div
      className="confirmation-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !mutating) onCancel();
      }}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="confirmation-dialog album-picker-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="album-picker-title"
        aria-describedby="album-picker-description"
      >
        <p className="confirmation-eyebrow">Add to album</p>
        <h3 id="album-picker-title">Choose an album</h3>
        <p id="album-picker-description">
          Adds a membership for {targetLabel}; photos stay in their other albums.
        </p>
        {albums.length > 0 ? (
          <ul className="album-picker-list">
            {albums.map((album) => (
              <li key={album.uri}>
                <button
                  type="button"
                  className="album-picker-option"
                  disabled={mutating}
                  onClick={() => onPickAlbum(album)}
                >
                  {album.title}
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="album-picker-empty">Every album already contains these photos.</p>
        )}
        <form className="album-picker-new" onSubmit={createAndAdd}>
          <label htmlFor="album-picker-new-title">New album</label>
          <input
            id="album-picker-new-title"
            value={newTitle}
            maxLength={200}
            placeholder="Album title"
            disabled={mutating}
            onChange={(event) => setNewTitle(event.target.value)}
          />
          <button type="submit" disabled={!newTitle.trim() || mutating}>Create and add</button>
        </form>
        <div className="confirmation-actions">
          <button type="button" className="secondary-button compact-button" disabled={mutating} onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

function commonDuplicateEntries(
  original: LibraryMedia,
  duplicate: LibraryMedia,
): readonly [string, string][] {
  const duplicateEntries = new Map(metadataEntries(duplicate));
  return metadataEntries(original).filter(
    ([label, value]) => label !== "Filename" && label !== "Added" && duplicateEntries.get(label) === value,
  );
}

function DuplicateChoiceDialog({
  count,
  mutating,
  onCancel,
  onDeleteAll,
  onReview,
}: Readonly<{
  count: number;
  mutating: boolean;
  onCancel: () => void;
  onDeleteAll: () => void;
  onReview: () => void;
}>) {
  useDismissDialogOnEscape(mutating, onCancel);

  return (
    <div className="confirmation-backdrop">
      <div className="confirmation-dialog duplicate-choice-dialog" role="dialog" aria-modal="true" aria-labelledby="duplicate-choice-title">
        <p className="confirmation-eyebrow">Remove duplicates</p>
        <h3 id="duplicate-choice-title">How would you like to review {count} duplicate{count === 1 ? "" : "s"}?</h3>
        <p>Delete all detected copies automatically, or compare every pair before deciding.</p>
        <div className="duplicate-choice-actions">
          <button type="button" className="duplicate-review-button" disabled={mutating} onClick={onReview}>
            <strong>Review case by case</strong>
            <span>Compare each pair before deleting anything.</span>
          </button>
          <button type="button" className="duplicate-auto-button" disabled={mutating} onClick={onDeleteAll}>
            <strong>{mutating ? "Deleting…" : "Delete all duplicates"}</strong>
            <span>Keep each original and remove every detected copy.</span>
          </button>
        </div>
        <div className="confirmation-actions">
          <button type="button" className="secondary-button compact-button" disabled={mutating} onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

function DuplicateReviewDialog({
  pair,
  index,
  count,
  mediaGatewayAccess,
  mutating,
  onCancel,
  onDeleteDuplicate,
  onKeepBoth,
}: Readonly<{
  pair: DuplicateMediaGroup;
  index: number;
  count: number;
  mediaGatewayAccess?: MediaGatewayAccess | undefined;
  mutating: boolean;
  onCancel: () => void;
  onDeleteDuplicate: () => void;
  onKeepBoth: () => void;
}>) {
  useDismissDialogOnEscape(mutating, onCancel);
  const commonEntries = commonDuplicateEntries(pair.original, pair.duplicate);

  return (
    <div className="confirmation-backdrop duplicate-review-backdrop">
      <div className="confirmation-dialog duplicate-review-dialog" role="dialog" aria-modal="true" aria-labelledby="duplicate-review-title">
        <div className="duplicate-review-heading">
          <div>
            <p className="confirmation-eyebrow">Duplicate {index + 1} of {count}</p>
            <h3 id="duplicate-review-title">Compare these photos</h3>
          </div>
          <button type="button" className="duplicate-close-button" disabled={mutating} onClick={onCancel} aria-label="Close duplicate review">
            <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18" /></svg>
          </button>
        </div>
        <div className="duplicate-comparison">
          {[{ label: "Original", media: pair.original }, { label: "Duplicate", media: pair.duplicate }].map(({ label, media }) => (
            <section className="duplicate-side" key={media.uri}>
              <span>{label}</span>
              <div className="duplicate-preview">
                <PrivatePreviewImage
                  eager
                  media={media}
                  mediaGatewayAccess={mediaGatewayAccess}
                />
              </div>
              <strong title={media.filename}>{media.filename}</strong>
            </section>
          ))}
        </div>
        <section className="duplicate-common-info" aria-label="Matching information">
          <h4>Matching information</h4>
          <dl>
            {commonEntries.map(([label, value], entryIndex) => (
              <div key={`${label}-${entryIndex}`}><dt>{label}</dt><dd>{value}</dd></div>
            ))}
          </dl>
        </section>
        <div className="duplicate-review-actions">
          <button type="button" className="secondary-button compact-button" disabled={mutating} onClick={onKeepBoth}>Keep both</button>
          <button type="button" className="compact-button confirm-delete-button" disabled={mutating} onClick={onDeleteDuplicate}>
            {mutating ? "Deleting…" : "Delete duplicate"}
          </button>
        </div>
      </div>
    </div>
  );
}

export function PrivateLibrary({
  albumCollection,
  blobUploadLimit,
  libraryIndexCollection,
  libraryMediaCollection,
  mediaGatewayAccess,
  membershipCollection,
  session,
  spaceUri,
  transferEventCollection,
}: Props) {
  // Hydrate from the last successful refresh so a reload renders instantly
  // and revalidates against the Space in the background.
  const [initialSnapshot] = useState(() => readLibrarySnapshot(session.did, spaceUri));
  const [initialTransferEvents] = useState(() =>
    readCachedTransferEvents(session.did, spaceUri),
  );
  const [library, setLibrary] = useState<LibraryState>(
    initialSnapshot
      ? { albums: initialSnapshot.albums, media: initialSnapshot.media, memberships: initialSnapshot.memberships }
      : EMPTY_LIBRARY,
  );
  const libraryRef = useRef(library);
  const initialMediaWatermark =
    latestRecordKey(initialSnapshot?.media ?? []) ??
    initialSnapshot?.watermarks?.media ??
    initialSnapshot?.watermark;
  const initialWatermarks: LibraryWatermarks | undefined = initialSnapshot
    ? {
        media: initialMediaWatermark,
        albums:
          latestRecordKey(initialSnapshot.albums) ??
          initialSnapshot.watermarks?.albums,
        memberships:
          latestRecordKey(initialSnapshot.memberships) ??
          initialSnapshot.watermarks?.memberships,
      }
    : undefined;
  const watermarkRef = useRef<string | undefined>(initialMediaWatermark);
  const watermarksRef = useRef<LibraryWatermarks | undefined>(initialWatermarks);
  const refreshGenerationRef = useRef(0);
  const mediaGatewayAccessRef = useRef(mediaGatewayAccess);
  const [selectedAlbum, setSelectedAlbum] = useState<string>(ALL_MEDIA);
  const [albumTitle, setAlbumTitle] = useState("");
  const [query, setQuery] = useState("");
  const [uploadDrawerOpen, setUploadDrawerOpen] = useState(false);
  const [loading, setLoading] = useState(!initialSnapshot);
  const [mutating, setMutating] = useState(false);
  const [error, setError] = useState<string>();
  const [transferStatus, setTransferStatus] = useState<TransferQuotaStatus | undefined>(() =>
    initialTransferEvents
      ? transferQuotaStatus(initialTransferEvents, new Date())
      : undefined,
  );
  const [activeMediaUri, setActiveMediaUri] = useState<string>();
  const [albumPendingDeleteUri, setAlbumPendingDeleteUri] = useState<string>();
  const [selectedUris, setSelectedUris] = useState<ReadonlySet<string>>(EMPTY_SELECTION);
  const [contextMenu, setContextMenu] = useState<ContextMenuState>();
  const [pickerTargets, setPickerTargets] = useState<readonly string[]>();
  const [pendingDeleteUris, setPendingDeleteUris] = useState<readonly string[]>();
  const [duplicateChoiceOpen, setDuplicateChoiceOpen] = useState(false);
  const [duplicateReviewPairs, setDuplicateReviewPairs] = useState<readonly DuplicateMediaGroup[]>();
  const [duplicateReviewIndex, setDuplicateReviewIndex] = useState(0);

  useEffect(() => {
    libraryRef.current = library;
  }, [library]);

  useEffect(() => {
    mediaGatewayAccessRef.current = mediaGatewayAccess;
  }, [mediaGatewayAccess]);

  const selectionActive = selectedUris.size > 0;

  const closeViewer = useCallback(() => {
    setActiveMediaUri(undefined);
  }, []);

  useEffect(() => {
    if (!albumPendingDeleteUri || mutating) return;

    function dismissAlbumDialogOnEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setAlbumPendingDeleteUri(undefined);
    }

    window.addEventListener("keydown", dismissAlbumDialogOnEscape);
    return () => window.removeEventListener("keydown", dismissAlbumDialogOnEscape);
  }, [albumPendingDeleteUri, mutating]);

  const visibleMedia = useMemo(() => {
    const selected = (() => {
      if (selectedAlbum === ALL_MEDIA) return library.media;
      const mediaByUri = new Map(library.media.map((item) => [item.uri, item]));
      return library.memberships
        .filter((membership) => membership.albumUri === selectedAlbum)
        .sort((left, right) => left.position - right.position)
        .flatMap((membership) => mediaByUri.get(membership.mediaUri) ?? []);
    })();
    const normalizedQuery = query.trim().toLocaleLowerCase();
    return normalizedQuery
      ? selected.filter((item) => item.filename.toLocaleLowerCase().includes(normalizedQuery))
      : selected;
  }, [library, query, selectedAlbum]);

  const mediaGroups = useMemo(
    () =>
      selectedAlbum === ALL_MEDIA
        ? groupMediaByDay(visibleMedia)
        : [{ key: selectedAlbum, label: "", items: visibleMedia }],
    [selectedAlbum, visibleMedia],
  );
  // The flattened group order is the single source of truth for the grid and
  // the carousel, so next/previous always lands on the visually adjacent photo.
  const orderedMedia = useMemo(
    () => mediaGroups.flatMap((group) => group.items),
    [mediaGroups],
  );

  const libraryStorageBytes = useMemo(
    () => privateLibraryStorageBytes(library.media),
    [library.media],
  );

  const refresh = useCallback(async (options: Readonly<{ preferCachedSnapshot?: boolean }> = {}) => {
    if (options.preferCachedSnapshot && canUseLibrarySnapshot(initialSnapshot)) {
      setLoading(false);
      return;
    }
    const refreshGeneration = ++refreshGenerationRef.current;
    setLoading(true);
    setError(undefined);
    try {
      const agent = new Agent(session);
      const now = new Date();

      let currentLibrary = libraryRef.current;
      let watermark = watermarkRef.current;

      // If local cache is empty, attempt to hydrate from remote index blob in 1 request
      if (currentLibrary.media.length === 0 && libraryIndexCollection) {
        console.info("[AT Storage] Fetching remote libraryIndex snapshot from Space...");
        const gatewayAccess = mediaGatewayAccessRef.current;
        const remoteIndex = gatewayAccess ? await fetchRemoteLibraryIndex(agent, {
          space: spaceUri,
          repo: session.did,
          indexCollection: libraryIndexCollection,
        }, gatewayAccess) : undefined;
        if (remoteIndex && remoteIndex.media.length > 0) {
          console.info(`[AT Storage] Successfully hydrated ${remoteIndex.media.length} photos and ${remoteIndex.albums.length} albums from remote index! Watermark:`, remoteIndex.watermark);
          currentLibrary = {
            albums: remoteIndex.albums,
            media: remoteIndex.media,
            memberships: remoteIndex.memberships,
          };
          const remoteWatermarks: LibraryWatermarks = {
            media:
              latestRecordKey(remoteIndex.media) ??
              remoteIndex.watermarks?.media ??
              remoteIndex.watermark,
            albums:
              latestRecordKey(remoteIndex.albums) ??
              remoteIndex.watermarks?.albums,
            memberships:
              latestRecordKey(remoteIndex.memberships) ??
              remoteIndex.watermarks?.memberships,
          };
          watermark = remoteWatermarks.media;
          watermarkRef.current = watermark;
          watermarksRef.current = remoteWatermarks;
          setLibrary(currentLibrary);
          setLoading(false);
        } else {
          console.warn("[AT Storage] Remote libraryIndex was empty or not found:", remoteIndex);
        }
      }

      let updatedLibrary: LibraryState;
      let nextWatermarks: LibraryWatermarks;
      {
        // Stream libraryMedia records with live page rendering
        const accumulatedMedia: RawSpaceRecord[] = [];
        const mediaPromise = listAllSpaceRecords(
          agent,
          { space: spaceUri, repo: session.did, collection: libraryMediaCollection },
          {
            onPage: (pageRecords) => {
              for (const item of pageRecords) {
                if (item.value) {
                  accumulatedMedia.push({
                    uri: `${spaceUri}/${session.did}/${item.collection}/${item.rkey}`,
                    cid: item.cid,
                    value: item.value,
                  });
                }
              }
              const partialMedia = indexLibraryRecords({
                media: accumulatedMedia,
                albums: [],
                memberships: [],
              }).media;
              setLibrary((prev) => ({ ...prev, media: partialMedia }));
              setLoading(false);
              return true;
            },
          },
        );

        const [media, albums, memberships, transferEvents] = await Promise.all([
          mediaPromise,
          listAllSpaceRecords(
            agent,
            { space: spaceUri, repo: session.did, collection: albumCollection },
          ),
          listAllSpaceRecords(
            agent,
            { space: spaceUri, repo: session.did, collection: membershipCollection },
          ),
          recentTransferEvents(agent, spaceUri, session.did, transferEventCollection, now),
        ]);
        updatedLibrary = indexLibraryRecords({ media, albums, memberships });
        nextWatermarks = {
          media: media[0] ? recordKeyFromAtUri(media[0].uri) : undefined,
          albums: albums[0] ? recordKeyFromAtUri(albums[0].uri) : undefined,
          memberships: memberships[0] ? recordKeyFromAtUri(memberships[0].uri) : undefined,
        };
        watermarksRef.current = nextWatermarks;
        watermarkRef.current = nextWatermarks.media;
        setTransferStatus(transferQuotaStatus(transferEvents, now));
        writeCachedTransferEvents(session.did, spaceUri, transferEvents);
      }

      if (refreshGeneration !== refreshGenerationRef.current) return;

      setLibrary(updatedLibrary);
      setSelectedUris((current) =>
        pruneSelectedUris(current, new Set(updatedLibrary.media.map((item) => item.uri))),
      );
      writeLibrarySnapshot(session.did, spaceUri, {
        ...updatedLibrary,
        refreshedAt: new Date().toISOString(),
        ...(nextWatermarks.media ? { watermark: nextWatermarks.media } : {}),
        watermarks: nextWatermarks,
      });
      await prunePreviewCache(new Set(updatedLibrary.media.map((item) => item.previewCid)));

      // Every authoritative refresh repairs the derived index, including after a prior
      // publication failure or records deleted by another client.
      if (libraryIndexCollection && refreshGeneration === refreshGenerationRef.current) {
        await publishRemoteLibraryIndex(agent, {
          space: spaceUri,
          repo: session.did,
          indexCollection: libraryIndexCollection,
        }, {
          formatVersion: 1,
          generatedAt: new Date().toISOString(),
          ...(nextWatermarks.media ? { watermark: nextWatermarks.media } : {}),
          watermarks: nextWatermarks,
          ...updatedLibrary,
        });
      }
    } catch (caught: unknown) {
      setError(errorMessage(caught, LIBRARY_REQUEST_FAILED));
    } finally {
      setLoading(false);
    }
  }, [albumCollection, initialSnapshot, libraryIndexCollection, libraryMediaCollection, membershipCollection, session, spaceUri, transferEventCollection]);

  // The deferred timeout lets first paint/hydration finish before the network fan-out begins.
  useEffect(() => {
    const timeout = window.setTimeout(() => void refresh({ preferCachedSnapshot: true }), 0);
    return () => window.clearTimeout(timeout);
  }, [refresh]);

  useEffect(() => {
    // Free quota held by the superseded localStorage preview cache.
    purgeLegacyPreviewDataUrls();
  }, []);

  const activeMediaIndex = activeMediaUri ? orderedMedia.findIndex((item) => item.uri === activeMediaUri) : -1;
  const activeMedia = activeMediaIndex >= 0 ? orderedMedia[activeMediaIndex] : undefined;
  const activeAlbum = selectedAlbum === ALL_MEDIA
    ? undefined
    : library.albums.find((album) => album.uri === selectedAlbum);
  const albumPendingDelete = albumPendingDeleteUri
    ? library.albums.find((album) => album.uri === albumPendingDeleteUri)
    : undefined;
  const duplicateMedia = useMemo(() => findDuplicateMedia(library.media), [library.media]);
  const duplicateReviewPair = duplicateReviewPairs?.[duplicateReviewIndex];

  const pickerAlbums = useMemo(
    () =>
      pickerTargets
        ? eligibleAlbumsForTargets({
            albums: library.albums,
            memberships: library.memberships,
            targetMediaUris: pickerTargets,
          })
        : [],
    [library.albums, library.memberships, pickerTargets],
  );

  const pendingDeleteItems = useMemo(() => {
    if (!pendingDeleteUris) return [];
    const mediaByUri = new Map(library.media.map((item) => [item.uri, item]));
    return pendingDeleteUris.flatMap((uri) => mediaByUri.get(uri) ?? []);
  }, [library.media, pendingDeleteUris]);

  const firstPendingDelete = pendingDeleteItems[0];
  const deleteHeading =
    pendingDeleteItems.length === 1 && firstPendingDelete
      ? `Delete “${firstPendingDelete.filename}”?`
      : `Delete ${pendingDeleteItems.length} photos?`;
  const deleteDescription =
    pendingDeleteItems.length === 1
      ? "This removes the private Library record."
      : "This removes their private Library records.";
  const pickerTargetLabel = `${pickerTargets?.length ?? 0} ${
    (pickerTargets?.length ?? 0) === 1 ? "photo" : "photos"
  }`;

  async function runMutation(mutation: () => Promise<void>) {
    setMutating(true);
    setError(undefined);
    try {
      await mutation();
    } catch (caught: unknown) {
      setError(errorMessage(caught, LIBRARY_REQUEST_FAILED));
    } finally {
      setMutating(false);
    }
  }

  async function deleteSpaceRecord(agent: Agent, collection: string, uri: string) {
    await agent.com.atproto.space.deleteRecord({
      space: spaceUri,
      repo: session.did,
      collection,
      rkey: recordKeyFromAtUri(uri),
    });
  }

  async function commitLocalLibrary(agent: Agent, nextLibrary: LibraryState) {
    ++refreshGenerationRef.current;
    const nextWatermarks: LibraryWatermarks = {
      media: latestRecordKey(nextLibrary.media),
      albums: latestRecordKey(nextLibrary.albums),
      memberships: latestRecordKey(nextLibrary.memberships),
    };
    libraryRef.current = nextLibrary;
    watermarksRef.current = nextWatermarks;
    watermarkRef.current = nextWatermarks.media;
    setLibrary(nextLibrary);
    writeLibrarySnapshot(session.did, spaceUri, {
      ...nextLibrary,
      refreshedAt: new Date().toISOString(),
      ...(nextWatermarks.media ? { watermark: nextWatermarks.media } : {}),
      watermarks: nextWatermarks,
    });
    await prunePreviewCache(new Set(nextLibrary.media.map((item) => item.previewCid)));
    if (libraryIndexCollection) {
      await publishRemoteLibraryIndex(
        agent,
        { space: spaceUri, repo: session.did, indexCollection: libraryIndexCollection },
        {
          formatVersion: 1,
          generatedAt: new Date().toISOString(),
          ...(nextWatermarks.media ? { watermark: nextWatermarks.media } : {}),
          watermarks: nextWatermarks,
          ...nextLibrary,
        },
      );
    }
  }

  async function acceptUploadedMedia(result: PrivateImageUploadResult) {
    const agent = new Agent(session);
    await cachePreviewBlob(result.media.previewCid, result.preview);
    if (result.media.originalCid) {
      await setCachedOriginal(result.media.originalCid, result.original);
    }
    writeCachedTransferEvents(session.did, spaceUri, result.transferEvents);
    setTransferStatus(transferQuotaStatus(result.transferEvents, new Date()));
    await commitLocalLibrary(agent, appendMediaToLibrary(libraryRef.current, result.media));
  }

  async function createAlbum(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const title = albumTitle.trim();
    if (!title || mutating) return;
    await runMutation(async () => {
      const now = new Date().toISOString();
      const agent = new Agent(session);
      const response = await agent.com.atproto.space.createRecord({
        space: spaceUri,
        repo: session.did,
        collection: albumCollection,
        record: {
          $type: albumCollection,
          formatVersion: 1,
          title,
          sort: "manual",
          createdAt: now,
          updatedAt: now,
        },
      });
      setAlbumTitle("");
      setSelectedAlbum(response.data.uri);
      await refresh();
    });
  }

  function openMedia(uri: string) {
    setSelectedUris(EMPTY_SELECTION);
    setActiveMediaUri(uri);
  }

  function toggleMediaSelection(uri: string) {
    setSelectedUris(toggleSelectedUri(selectedUris, uri));
  }

  function changeAlbum(albumUri: string) {
    setSelectedAlbum(albumUri);
    setSelectedUris(EMPTY_SELECTION);
  }

  function openContextMenu(event: MouseEvent<HTMLElement>, media: LibraryMedia) {
    event.preventDefault();
    event.stopPropagation();
    if (selectionActive || mutating) return;
    setContextMenu({
      media,
      position: clampMenuPosition(
        { x: event.clientX, y: event.clientY },
        CONTEXT_MENU_SIZE,
        viewportSize(),
      ),
    });
  }

  function closeContextMenu() {
    setContextMenu(undefined);
  }

  function selectFromContextMenu() {
    if (!contextMenu) return;
    setSelectedUris(new Set([contextMenu.media.uri]));
    closeContextMenu();
  }

  function deleteFromContextMenu() {
    if (!contextMenu) return;
    setPendingDeleteUris([contextMenu.media.uri]);
    closeContextMenu();
  }

  async function createMemberships(agent: Agent, albumUri: string, mediaUris: readonly string[]) {
    let position = nextMembershipPosition(library.memberships, albumUri);
    for (const mediaUri of mediaUris) {
      await agent.com.atproto.space.createRecord({
        space: spaceUri,
        repo: session.did,
        collection: membershipCollection,
        record: {
          $type: membershipCollection,
          formatVersion: 1,
          album: albumUri,
          media: mediaUri,
          position,
          addedAt: new Date().toISOString(),
        },
      });
      position += 1;
    }
  }

  async function pickExistingAlbum(album: LibraryAlbum) {
    if (!pickerTargets || mutating) return;
    const missing = unmemberedTargetUris({
      albumUri: album.uri,
      memberships: library.memberships,
      targetMediaUris: pickerTargets,
    });
    if (missing.length === 0) return;
    await runMutation(async () => {
      const agent = new Agent(session);
      await createMemberships(agent, album.uri, missing);
      setPickerTargets(undefined);
      setSelectedUris(EMPTY_SELECTION);
      await refresh();
    });
  }

  async function createAlbumAndAddMembers(title: string) {
    if (!pickerTargets || mutating) return;
    const targets = pickerTargets;
    await runMutation(async () => {
      const agent = new Agent(session);
      const now = new Date().toISOString();
      const response = await agent.com.atproto.space.createRecord({
        space: spaceUri,
        repo: session.did,
        collection: albumCollection,
        record: {
          $type: albumCollection,
          formatVersion: 1,
          title,
          sort: "manual",
          createdAt: now,
          updatedAt: now,
        },
      });
      await createMemberships(agent, response.data.uri, targets);
      setPickerTargets(undefined);
      setSelectedUris(EMPTY_SELECTION);
      await refresh();
    });
  }

  async function removeFromAlbum(membership: LibraryMembership) {
    if (mutating) return;
    await runMutation(async () => {
      const agent = new Agent(session);
      await deleteSpaceRecord(agent, membershipCollection, membership.uri);
      await refresh();
    });
  }

  async function deleteAlbum(album: LibraryAlbum) {
    if (mutating) return;

    await runMutation(async () => {
      const agent = new Agent(session);
      for (const membership of library.memberships) {
        if (membership.albumUri !== album.uri) continue;
        await deleteSpaceRecord(agent, membershipCollection, membership.uri);
      }
      await deleteSpaceRecord(agent, albumCollection, album.uri);
      setSelectedAlbum(ALL_MEDIA);
      setAlbumPendingDeleteUri(undefined);
      await refresh();
    });
  }

  function openDuplicateChoice() {
    if (duplicateMedia.length === 0) {
      setError("No duplicate filename variants with matching metadata were found.");
      return;
    }
    setError(undefined);
    setDuplicateChoiceOpen(true);
  }

  async function removeAllDuplicates() {
    if (mutating) return;

    await runMutation(async () => {
      const agent = new Agent(session);
      const duplicateUris = new Set(duplicateMedia.map(({ duplicate }) => duplicate.uri));
      for (const membership of library.memberships) {
        if (!duplicateUris.has(membership.mediaUri)) continue;
        await deleteSpaceRecord(agent, membershipCollection, membership.uri);
      }
      for (const { duplicate } of duplicateMedia) {
        await deleteSpaceRecord(agent, libraryMediaCollection, duplicate.uri);
      }
      setDuplicateChoiceOpen(false);
      await refresh();
    });
  }

  function startDuplicateReview() {
    setDuplicateReviewPairs(duplicateMedia);
    setDuplicateReviewIndex(0);
    setDuplicateChoiceOpen(false);
  }

  function advanceDuplicateReview() {
    if (!duplicateReviewPairs) return;
    if (duplicateReviewIndex < duplicateReviewPairs.length - 1) {
      setDuplicateReviewIndex((index) => index + 1);
      return;
    }
    setDuplicateReviewPairs(undefined);
    setDuplicateReviewIndex(0);
    void refresh();
  }

  async function deleteReviewedDuplicate(pair: DuplicateMediaGroup) {
    if (mutating) return;
    await runMutation(async () => {
      const agent = new Agent(session);
      for (const membership of library.memberships) {
        if (membership.mediaUri !== pair.duplicate.uri) continue;
        await deleteSpaceRecord(agent, membershipCollection, membership.uri);
      }
      await deleteSpaceRecord(agent, libraryMediaCollection, pair.duplicate.uri);
      advanceDuplicateReview();
    });
  }

  async function confirmPendingDelete() {
    if (!pendingDeleteUris || mutating) return;
    const targetUris = pendingDeleteUris;
    await runMutation(async () => {
      const agent = new Agent(session);
      const targetSet = new Set(targetUris);
      for (const membership of library.memberships) {
        if (!targetSet.has(membership.mediaUri)) continue;
        await deleteSpaceRecord(agent, membershipCollection, membership.uri);
      }
      for (const uri of targetUris) {
        await deleteSpaceRecord(agent, libraryMediaCollection, uri);
      }
      await commitLocalLibrary(
        agent,
        removeMediaFromLibrary(libraryRef.current, targetSet),
      );
      if (activeMediaUri && targetSet.has(activeMediaUri)) setActiveMediaUri(undefined);
      setSelectedUris(EMPTY_SELECTION);
      setPendingDeleteUris(undefined);
    });
  }

  async function downloadMedia(media: LibraryMedia) {
    if (!media.originalCid) return;
    try {
      if (!mediaGatewayAccess) {
        throw new Error("Media gateway is not connected.");
      }
      const response = await fetchGatewayBlob(mediaGatewayAccess, media.originalCid, media.mime);
      if (!response.ok) throw new Error(`Download request returned HTTP ${response.status}.`);
      const url = URL.createObjectURL(await response.blob());
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = media.filename;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (caught: unknown) {
      setError(errorMessage(caught, LIBRARY_REQUEST_FAILED));
    }
  }

  return (
    <section className="library-workspace" aria-labelledby="library-title">
      <div className="library-heading">
        <div>
          <p className="status-line">
            Private Space · {library.media.length} items
            {mediaGatewayAccess ? " · Media Gateway connected" : ""}
          </p>
          <h2 id="library-title">Photos</h2>
        </div>
        <div className="library-controls">
          <label className="photo-search">
            <span className="sr-only">Search by filename</span>
            <input
              type="search"
              placeholder="Search your photos"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <details
            className="upload-drawer"
            open={uploadDrawerOpen}
            onToggle={(event) => setUploadDrawerOpen(event.currentTarget.open)}
          >
            <summary>Upload</summary>
            <PrivateImageUpload
              blobUploadLimit={blobUploadLimit}
              libraryStorageBytes={libraryStorageBytes}
              libraryMediaCollection={libraryMediaCollection}
              session={session}
              spaceUri={spaceUri}
              transferEventCollection={transferEventCollection}
              onUploaded={async (result) => {
                setUploadDrawerOpen(false);
                await acceptUploadedMedia(result);
              }}
            />
          </details>
          <button
            type="button"
            className="secondary-button compact-button"
            disabled={mutating}
            onClick={openDuplicateChoice}
          >
            Remove duplicates{duplicateMedia.length ? ` (${duplicateMedia.length})` : ""}
          </button>
          <button type="button" className="secondary-button compact-button" onClick={() => void refresh()}>
            Refresh
          </button>
        </div>
      </div>

      <section className="transfer-quota" aria-label="Upload and Library limits">
        {transferStatus ? (
          <>
          <div className="transfer-quota-copy">
            <strong>{formatBytes(transferStatus.quota.remaining.transferredBytes)} remaining</strong>
            <span>
              {transferStatus.quota.remaining.items} uploads · {transferStatus.quota.remaining.blobOperations} blob operations
            </span>
          </div>
          <progress
            value={transferStatus.quota.usage.transferredBytes}
            max={ROLLING_QUOTA_LIMITS.transferredBytes}
            aria-label={`${formatBytes(transferStatus.quota.usage.transferredBytes)} transferred in the last 24 hours`}
          />
          <p>
            Rolling 24 hours
            {transferStatus.nextRecoveryAt
              ? ` · next capacity returns ${formatRecoveryTime(transferStatus.nextRecoveryAt)}`
              : " · full allowance available"}
          </p>
          </>
        ) : (
          <div className="transfer-quota-copy">
            <strong>Rolling 24-hour transfer allowance</strong>
            <span>Refresh to calculate current transfer usage and recovery time.</span>
          </div>
        )}
        <p className="library-capacity-copy">
          Separate permanent Library limit: {formatBytes(libraryStorageBytes)} of {formatBytes(LIBRARY_LIMITS.storedBytes)} used. Deleting media returns Library capacity, but the rolling 24-hour transfer usage remains until it expires.
        </p>
      </section>

      <div className="library-layout">
        <aside className="album-sidebar" aria-label="Albums">
          <button
            type="button"
            className={selectedAlbum === ALL_MEDIA ? "album-nav active" : "album-nav"}
            onClick={() => changeAlbum(ALL_MEDIA)}
          >
            All media <span>{library.media.length}</span>
          </button>
          {library.albums.map((album) => (
            <button
              type="button"
              className={selectedAlbum === album.uri ? "album-nav active" : "album-nav"}
              key={album.uri}
              onClick={() => changeAlbum(album.uri)}
            >
              {album.title}
              <span>
                {library.memberships.filter((membership) => membership.albumUri === album.uri).length}
              </span>
            </button>
          ))}
          <form className="new-album" onSubmit={createAlbum}>
            <label htmlFor="album-title">New album</label>
            <input
              id="album-title"
              value={albumTitle}
              maxLength={200}
              placeholder="Album title"
              disabled={mutating}
              onChange={(event) => setAlbumTitle(event.target.value)}
            />
            <button type="submit" disabled={!albumTitle.trim() || mutating}>Create album</button>
          </form>
          <section className="sidebar-storage" aria-label="Library storage">
            <h4>Library storage</h4>
            <strong>{formatBytes(libraryStorageBytes)} / {formatBytes(LIBRARY_LIMITS.storedBytes)}</strong>
            <span>{library.media.length} items</span>
          </section>
          <div className="sidebar-notices">
            <div className="sidebar-notice sidebar-notice-danger" role="alert">
              <strong>⚠️ Temporary experiment:</strong> This Library operates on the Spaces-alpha PDS.
              All data there will eventually be deleted. Do not rely on this experiment for important or sole backups.
            </div>
            <div className="sidebar-notice" role="note">
              <strong>⚠️ Note on encryption:</strong> Spaces provide access control rather than confidentiality.
              Data in a Space is readable by any user or application granted access to that Space and is not encrypted.
              We may add encryption ourselves in the future.
            </div>
          </div>
        </aside>

        <div className="media-browser">
          <div className="media-browser-heading">
            <h3>
              {selectedAlbum === ALL_MEDIA
                ? "All media"
                : (activeAlbum?.title ?? "Album")}
            </h3>
            <div className="album-heading-actions">
              <span>{visibleMedia.length} items</span>
              {activeAlbum ? (
                <button
                  type="button"
                  className="secondary-button compact-button delete-album-button"
                  disabled={mutating}
                  onClick={() => setAlbumPendingDeleteUri(activeAlbum.uri)}
                >
                  Delete album
                </button>
              ) : null}
            </div>
          </div>
          {error ? <p className="oauth-error" role="alert">{error}</p> : null}
          {loading ? <p className="fine-print">Loading private Library…</p> : null}
          {!loading && visibleMedia.length === 0 ? (
            <p className="empty-library">No media here yet.</p>
          ) : null}
          <div className="photo-groups">
            {mediaGroups.map((group) => (
              <section className="photo-month" key={group.key}>
                {group.label ? <h4>{group.label}</h4> : null}
                <div className="media-grid">
            {group.items.map((item) => {
              const selectedMembership = library.memberships.find(
                (membership) =>
                  membership.albumUri === selectedAlbum && membership.mediaUri === item.uri,
              );
              const isSelected = selectedUris.has(item.uri);
              return (
                <article className={isSelected ? "media-card selected" : "media-card"} key={item.uri}>
                  <div
                    className="media-preview"
                    onContextMenu={(event) => openContextMenu(event, item)}
                  >
                    <button
                      type="button"
                      className="media-open-button"
                      aria-pressed={selectionActive ? isSelected : undefined}
                      onClick={(event) =>
                        selectionActive ? toggleMediaSelection(item.uri) : openContextMenu(event, item)
                      }
                    >
                    {mediaGatewayAccess ? (
                      <PrivatePreviewImage
                        media={item}
                        mediaGatewayAccess={mediaGatewayAccess}
                      />
                    ) : null}
                    </button>
                    {isSelected ? (
                      <span className="selection-badge" aria-hidden="true">
                        <svg viewBox="0 0 24 24"><path d="m5 13 4 4L19 7" /></svg>
                      </span>
                    ) : null}
                  </div>
                  <div className="media-card-body">
                    <h4 title={item.filename}>{item.filename}</h4>
                    <p>{item.width && item.height ? `${item.width} × ${item.height} · ` : ""}{Math.ceil(item.size / 1024)} KiB</p>
                    {selectedAlbum !== ALL_MEDIA && selectedMembership ? (
                      <button
                        type="button"
                        className="text-button"
                        disabled={mutating}
                        onClick={() => void removeFromAlbum(selectedMembership)}
                      >
                        Remove from album
                      </button>
                    ) : null}
                  </div>
                </article>
              );
            })}
                </div>
              </section>
            ))}
          </div>
        </div>
      </div>
      {activeMedia ? (
        <PhotoViewer
          activeMedia={activeMedia}
          activeMediaIndex={activeMediaIndex}
          mediaGatewayAccess={mediaGatewayAccess}
          mutating={mutating}
          orderedMedia={orderedMedia}
          onClose={closeViewer}
          onDelete={(media) => setPendingDeleteUris([media.uri])}
          onDownload={(media) => void downloadMedia(media)}
          onNavigate={setActiveMediaUri}
        />
      ) : null}
      {contextMenu ? (
        <ContextCardMenu
          menu={contextMenu}
          mutating={mutating}
          onAddToAlbum={() => {
            setPickerTargets([contextMenu.media.uri]);
            closeContextMenu();
          }}
          onDelete={deleteFromContextMenu}
          onClose={closeContextMenu}
          onSelect={selectFromContextMenu}
          onView={() => {
            openMedia(contextMenu.media.uri);
            closeContextMenu();
          }}
        />
      ) : null}
      {selectionActive ? (
        <SelectionBar
          count={selectedUris.size}
          mutating={mutating}
          onAddToAlbum={() => setPickerTargets([...selectedUris])}
          onCancel={() => setSelectedUris(EMPTY_SELECTION)}
          onDelete={() => setPendingDeleteUris([...selectedUris])}
        />
      ) : null}
      {pendingDeleteItems.length > 0 ? (
        <ConfirmDeleteDialog
          description={deleteDescription}
          heading={deleteHeading}
          mutating={mutating}
          onCancel={() => setPendingDeleteUris(undefined)}
          onConfirm={() => void confirmPendingDelete()}
        />
      ) : null}
      {pickerTargets ? (
        <AlbumPickerDialog
          albums={pickerAlbums}
          mutating={mutating}
          targetLabel={pickerTargetLabel}
          onCreateAlbum={(title) => void createAlbumAndAddMembers(title)}
          onPickAlbum={(album) => void pickExistingAlbum(album)}
          onCancel={() => setPickerTargets(undefined)}
        />
      ) : null}
      {duplicateChoiceOpen ? (
        <DuplicateChoiceDialog
          count={duplicateMedia.length}
          mutating={mutating}
          onCancel={() => setDuplicateChoiceOpen(false)}
          onDeleteAll={() => void removeAllDuplicates()}
          onReview={startDuplicateReview}
        />
      ) : null}
      {duplicateReviewPair && duplicateReviewPairs ? (
        <DuplicateReviewDialog
          pair={duplicateReviewPair}
          index={duplicateReviewIndex}
          count={duplicateReviewPairs.length}
          mediaGatewayAccess={mediaGatewayAccess}
          mutating={mutating}
          onCancel={() => {
            setDuplicateReviewPairs(undefined);
            setDuplicateReviewIndex(0);
            void refresh();
          }}
          onDeleteDuplicate={() => void deleteReviewedDuplicate(duplicateReviewPair)}
          onKeepBoth={advanceDuplicateReview}
        />
      ) : null}
      {albumPendingDelete ? (
        <div
          className="confirmation-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !mutating) setAlbumPendingDeleteUri(undefined);
          }}
        >
          <div
            className="confirmation-dialog"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="delete-album-title"
            aria-describedby="delete-album-description"
          >
            <p className="confirmation-eyebrow">Delete album</p>
            <h3 id="delete-album-title">Delete “{albumPendingDelete.title}”?</h3>
            <p id="delete-album-description">
              The album will be removed, but its photos will remain available in All media.
            </p>
            <div className="confirmation-actions">
              <button
                type="button"
                className="secondary-button compact-button"
                disabled={mutating}
                onClick={() => setAlbumPendingDeleteUri(undefined)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="compact-button confirm-delete-button"
                disabled={mutating}
                onClick={() => void deleteAlbum(albumPendingDelete)}
              >
                {mutating ? "Deleting…" : "Delete album"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
