/**
 * `useProfileAssets()` — list / upload / delete the current user's
 * recurring profile assets (issue #266).
 *
 * Profile assets are per-user images (speaker photo, logos, brand
 * marks) the author uploads once and references on every new-deck
 * creation. The owner identity is the Cloudflare Access email; the
 * Worker hashes it to an opaque `ownerHash` before constructing R2
 * keys and public URLs, so the raw email is never visible in any
 * deck or response body.
 *
 * Endpoints owned (see `worker/images.ts`):
 *
 *   GET    /api/admin/profile-assets                  — list
 *   POST   /api/admin/profile-assets                  — multipart upload
 *   DELETE /api/admin/profile-assets/<contentHash>    — remove
 *
 * Auth + write-headers: same `adminWriteHeaders()` shim as the deck
 * image hook. Localhost dev injects the access header; production
 * gates at Cloudflare Access. The Worker additionally rejects
 * service-token callers (no interactive email → no owner identity).
 *
 * Validation: mirrors `useImageUpload` — fast-fail on MIME + 10 MiB
 * before opening the connection. The Worker re-validates as the
 * source of truth.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { adminWriteHeaders } from "@/lib/admin-fetch";
import {
  ALLOWED_IMAGE_MIME_TYPES,
  MAX_UPLOAD_BYTES,
  isAllowedImageMime,
} from "@/framework/editor/useImageUpload";

/** Re-export for symmetry with the deck-asset hook. */
export { ALLOWED_IMAGE_MIME_TYPES, MAX_UPLOAD_BYTES };

/**
 * Mirror of `worker/images.ts`'s `ImageRecord`. Defined locally so
 * this module does not have to depend on the Worker package.
 */
export interface ProfileAssetRecord {
  src: string;
  contentHash: string;
  size: number;
  mimeType: string;
  originalFilename: string;
  uploadedAt: string;
}

export interface UseProfileAssets {
  /** Current asset list. `null` while the first list call is in flight. */
  assets: ProfileAssetRecord[] | null;
  /** True while ANY operation (list / upload / delete) is in flight. */
  loading: boolean;
  /** Last error from any operation. */
  error: string | null;
  /** Force-refresh the list. */
  refresh: () => Promise<void>;
  /** Upload a new asset. Returns the newly-stored record on success. */
  upload: (file: File) => Promise<ProfileAssetRecord>;
  /** Delete an asset by its `contentHash`. */
  remove: (contentHash: string) => Promise<void>;
  /** Drop the current error (e.g. after the user dismisses). */
  clearError: () => void;
}

/**
 * Multipart upload headers — same pattern as `useImageUpload`: drop
 * the JSON `content-type` so the browser sets `multipart/form-data;
 * boundary=...` from the FormData body itself.
 */
function uploadHeaders(): Record<string, string> {
  const headers = adminWriteHeaders();
  delete headers["content-type"];
  return headers;
}

export function useProfileAssets(): UseProfileAssets {
  const [assets, setAssets] = useState<ProfileAssetRecord[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Guard against state updates after unmount. The hook may be
  // mounted in a Suspense'd panel that unmounts mid-fetch when the
  // user navigates away.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const clearError = useCallback(() => setError(null), []);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/profile-assets", {
        headers: adminWriteHeaders(),
      });
      if (!res.ok) {
        // 403 (service token / not authenticated) is treated as "no
        // assets" — there's no PII to expose for service-token
        // callers, and the UI just shows the empty state. Other
        // errors surface as an `error` string so the user knows
        // something is up.
        if (res.status === 403) {
          if (mounted.current) setAssets([]);
          return;
        }
        let msg = `List failed (HTTP ${res.status})`;
        try {
          const body = (await res.json()) as { error?: string };
          if (body?.error) msg = body.error;
        } catch {
          /* ignore */
        }
        if (mounted.current) setError(msg);
        return;
      }
      const body = (await res.json()) as { images?: ProfileAssetRecord[] };
      if (mounted.current) {
        setAssets(Array.isArray(body.images) ? body.images : []);
      }
    } catch (err) {
      if (mounted.current) {
        setError(err instanceof Error ? err.message : "List failed");
      }
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, []);

  // Fetch the list on mount. Same effect runs once per hook instance
  // because `refresh` is stable.
  useEffect(() => {
    void refresh();
  }, [refresh]);

  const upload = useCallback(
    async (file: File): Promise<ProfileAssetRecord> => {
      if (!isAllowedImageMime(file.type)) {
        const msg = `Unsupported file type: ${file.type || "(unknown)"}. Allowed: PNG, JPEG, WebP, GIF, SVG.`;
        setError(msg);
        throw new Error(msg);
      }
      if (file.size > MAX_UPLOAD_BYTES) {
        const msg = `File too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Max 10 MB.`;
        setError(msg);
        throw new Error(msg);
      }
      setError(null);
      setLoading(true);
      try {
        const form = new FormData();
        form.append("file", file);
        const res = await fetch("/api/admin/profile-assets", {
          method: "POST",
          headers: uploadHeaders(),
          body: form,
        });
        if (!res.ok) {
          let msg = `Upload failed (HTTP ${res.status})`;
          try {
            const body = (await res.json()) as { error?: string };
            if (body?.error) msg = body.error;
          } catch {
            /* ignore */
          }
          setError(msg);
          throw new Error(msg);
        }
        const record = (await res.json()) as ProfileAssetRecord;
        if (!record || typeof record.src !== "string") {
          const msg = "Upload succeeded but server returned no src";
          setError(msg);
          throw new Error(msg);
        }
        if (mounted.current) {
          // Merge dedup-by-hash so re-uploads of the same bytes don't
          // grow the visible list. Same contract as the Worker's
          // dedup behaviour.
          setAssets((prev) => {
            const existing = prev ?? [];
            const filtered = existing.filter(
              (r) => r.contentHash !== record.contentHash,
            );
            return [...filtered, record];
          });
        }
        return record;
      } finally {
        if (mounted.current) setLoading(false);
      }
    },
    [],
  );

  const remove = useCallback(async (contentHash: string): Promise<void> => {
    setError(null);
    setLoading(true);
    try {
      const res = await fetch(
        `/api/admin/profile-assets/${encodeURIComponent(contentHash)}`,
        { method: "DELETE", headers: adminWriteHeaders() },
      );
      if (!res.ok && res.status !== 204) {
        let msg = `Delete failed (HTTP ${res.status})`;
        try {
          const body = (await res.json()) as { error?: string };
          if (body?.error) msg = body.error;
        } catch {
          /* ignore */
        }
        setError(msg);
        throw new Error(msg);
      }
      if (mounted.current) {
        setAssets(
          (prev) => prev?.filter((r) => r.contentHash !== contentHash) ?? [],
        );
      }
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, []);

  return {
    assets,
    loading,
    error,
    refresh,
    upload,
    remove,
    clearError,
  };
}
