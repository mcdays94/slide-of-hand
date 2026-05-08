/**
 * `useImageUpload()` — multipart upload to `/api/admin/images/<slug>`.
 *
 * Slice 7 / issue #63. The hook owns the in-flight upload state
 * (`uploading`, `progress`, `error`) and exposes a single async
 * `upload(file, slug)` call that returns the new image's `src` + `alt`
 * placeholder. The slot editor calls this on drop / file-pick and
 * folds the result back into the slot value.
 *
 * Client-side validation BEFORE the network round-trip:
 *
 *   - MIME allowlist mirrors `worker/images.ts`'s `MIME_TO_EXT` keys
 *     (`image/png`, `image/jpeg`, `image/webp`, `image/gif`, `image/svg+xml`).
 *   - Max size is 10 MiB — same threshold the Worker enforces.
 *
 * Mirroring the server-side checks here is a UX optimisation, NOT a
 * security boundary: the Worker still rejects anything that slips past
 * us. The point is to fail fast on an obvious user mistake (e.g.
 * dragging a `.heic` photo) before bothering with the upload.
 *
 * Progress reporting: `fetch()` doesn't expose upload progress, so we
 * flip `progress` to 100 only after the response resolves. v0.1
 * acceptance criterion is "indicator visible during POST" — the
 * indeterminate `uploading` boolean carries that, with `progress` left
 * as a future hook for an XHR/streaming swap.
 *
 * Auth: uses `adminWriteHeaders()` from `@/lib/admin-fetch` so the
 * localhost dev workflow works (Cloudflare Access enforces in prod).
 * Note we override `content-type` — multipart bodies need the browser
 * to set it (with the boundary), so we strip the JSON default.
 */

import { useCallback, useState } from "react";
import { adminWriteHeaders } from "@/lib/admin-fetch";

/**
 * Allowlisted MIME types — kept in sync with `worker/images.ts`'s
 * `MIME_TO_EXT`. If you add a kind here, add it there too.
 */
export const ALLOWED_IMAGE_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/svg+xml",
] as const;

/** 10 MiB — same threshold as the Worker. */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

export interface UploadResult {
  /** Public URL (e.g. `/images/decks/<slug>/<hash>.<ext>`). */
  src: string;
  /** Always `""` from the server — the editor adds alt text afterwards. */
  alt: string;
}

export interface UseImageUpload {
  upload: (file: File, slug: string) => Promise<UploadResult>;
  uploading: boolean;
  /** 0-100. Indeterminate-ish in v0.1: 0 → 100 around the fetch. */
  progress: number;
  error: string | null;
  /** Drop a stale error (e.g. when the user retries). */
  clearError: () => void;
}

export function isAllowedImageMime(mimeType: string): boolean {
  return (ALLOWED_IMAGE_MIME_TYPES as readonly string[]).includes(mimeType);
}

/**
 * Build the multipart headers. We deliberately do NOT pass
 * `content-type: application/json` here — the browser auto-generates
 * `multipart/form-data; boundary=...` from the FormData body. Setting
 * a wrong content-type would invalidate the boundary and the Worker
 * would 400.
 */
function uploadHeaders(): Record<string, string> {
  const headers = adminWriteHeaders();
  delete headers["content-type"];
  return headers;
}

export function useImageUpload(): UseImageUpload {
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const clearError = useCallback(() => setError(null), []);

  const upload = useCallback(
    async (file: File, slug: string): Promise<UploadResult> => {
      // Client-side validation BEFORE we open a connection.
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
      setUploading(true);
      setProgress(0);

      try {
        const form = new FormData();
        form.append("file", file);

        const res = await fetch(
          `/api/admin/images/${encodeURIComponent(slug)}`,
          {
            method: "POST",
            headers: uploadHeaders(),
            body: form,
          },
        );

        if (!res.ok) {
          let serverMsg = `Upload failed (HTTP ${res.status})`;
          try {
            const body = (await res.json()) as { error?: string };
            if (body && typeof body.error === "string") {
              serverMsg = body.error;
            }
          } catch {
            /* fall through to default message */
          }
          setError(serverMsg);
          throw new Error(serverMsg);
        }

        const record = (await res.json()) as { src?: string };
        if (!record || typeof record.src !== "string") {
          const msg = "Upload succeeded but server returned no src";
          setError(msg);
          throw new Error(msg);
        }
        setProgress(100);
        return { src: record.src, alt: "" };
      } catch (err) {
        if (!(err instanceof Error)) {
          const msg = "Upload failed";
          setError(msg);
          throw new Error(msg);
        }
        // Preserve the message we already set above; only overwrite if
        // the error is from outside our own validation/response handling.
        setError((prev) => prev ?? err.message);
        throw err;
      } finally {
        setUploading(false);
      }
    },
    [],
  );

  return { upload, uploading, progress, error, clearError };
}
