/**
 * `<ImageLibrary>` — picker for previously-uploaded deck images.
 *
 * Slice 7 / issue #63. Fetches `GET /api/admin/images/<slug>` (Slice 2)
 * and renders the returned `ImageRecord[]` as a thumbnail grid. Clicking
 * a tile bubbles the chosen `src` up to the caller via `onPick(src)`.
 *
 * Layout: an inline panel (NOT a full-screen modal) so the deck preview
 * stays visible behind it. The slot editor toggles its visibility via
 * the `open` prop and renders nothing when closed. A close button (×)
 * + Esc dismiss are provided.
 *
 * Design notes:
 *
 *   - The fetch happens on mount of the panel, not on every keystroke
 *     in the slot editor. We refetch when the panel reopens (cheap +
 *     ensures freshness if the user just uploaded something).
 *
 *   - `adminWriteHeaders` injects the dev access header on localhost so
 *     the read works in `wrangler dev`. In production Cloudflare Access
 *     gates the endpoint and the browser does not forge the header.
 */

import { useCallback, useEffect, useState } from "react";
import { adminWriteHeaders } from "@/lib/admin-fetch";

/**
 * Mirror of `worker/images.ts`'s `ImageRecord`. Defined locally so this
 * frontend module doesn't reach across the SPA/Worker seam (the
 * Worker's types are bundle-only and we want the editor types to be
 * pure browser code).
 */
export interface ImageLibraryRecord {
  src: string;
  contentHash: string;
  size: number;
  mimeType: string;
  originalFilename: string;
  uploadedAt: string;
}

export interface ImageLibraryProps {
  slug: string;
  open: boolean;
  /** Called with the selected image's public `src`. Caller should also close the panel. */
  onPick: (src: string) => void;
  /** Close button + Esc handler call this. */
  onClose: () => void;
}

export function ImageLibrary({ slug, open, onPick, onClose }: ImageLibraryProps) {
  const [records, setRecords] = useState<ImageLibraryRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchLibrary = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/admin/images/${encodeURIComponent(slug)}`,
        { headers: adminWriteHeaders() },
      );
      if (!res.ok) {
        setError(`Failed to load images (HTTP ${res.status})`);
        setRecords([]);
        return;
      }
      const body = (await res.json()) as { images?: ImageLibraryRecord[] };
      setRecords(Array.isArray(body.images) ? body.images : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load images");
      setRecords([]);
    } finally {
      setLoading(false);
    }
  }, [slug]);

  // Fetch on (re)open. Closing the panel doesn't clear records — they
  // stay in state for instant render the next time it opens.
  useEffect(() => {
    if (!open) return;
    void fetchLibrary();
  }, [open, fetchLibrary]);

  // Esc to close.
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-label="Image library"
      data-testid="image-library"
      className="rounded border border-cf-border bg-cf-bg-100 p-3"
    >
      <div className="flex items-center justify-between pb-2">
        <p className="text-xs font-medium uppercase tracking-[0.15em] text-cf-text-muted">
          Image library · {slug}
        </p>
        <button
          type="button"
          data-interactive
          data-testid="image-library-close"
          onClick={onClose}
          aria-label="Close library"
          className="cf-btn-ghost px-2 py-0.5 text-sm"
        >
          ×
        </button>
      </div>
      {loading ? (
        <p
          data-testid="image-library-loading"
          className="py-6 text-center text-xs text-cf-text-muted"
        >
          Loading library…
        </p>
      ) : error ? (
        <p
          role="alert"
          data-testid="image-library-error"
          className="py-6 text-center text-xs text-cf-orange"
        >
          {error}
        </p>
      ) : records.length === 0 ? (
        <p
          data-testid="image-library-empty"
          className="py-6 text-center text-xs text-cf-text-muted"
        >
          No images uploaded yet for this deck.
        </p>
      ) : (
        <ul
          data-testid="image-library-grid"
          className="grid grid-cols-3 gap-2 sm:grid-cols-4"
        >
          {records.map((record) => (
            <li key={record.contentHash}>
              <button
                type="button"
                data-interactive
                data-testid={`image-library-pick-${record.contentHash}`}
                onClick={() => onPick(record.src)}
                title={`${record.originalFilename} · ${formatBytes(record.size)}`}
                className="group flex w-full flex-col gap-1 overflow-hidden rounded border border-cf-border bg-cf-bg-200 p-1 text-left transition-colors hover:border-dashed hover:border-cf-orange focus-visible:border-dashed focus-visible:border-cf-orange focus-visible:outline-none"
              >
                <img
                  src={record.src}
                  alt=""
                  loading="lazy"
                  className="aspect-square w-full rounded object-cover"
                />
                <span className="block truncate text-[10px] text-cf-text-muted">
                  {record.originalFilename}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
