/**
 * `<ProfileAssetShelf>` — author-scoped recurring asset library
 * (speaker photo, logos, brand marks) uploaded once and made
 * available to every new-deck AI generation.
 *
 * Issue #266. Companion to `<DraftAssetShelf>` (#235): the draft
 * shelf is scoped to ONE draft slug and goes away with that draft;
 * the profile shelf is scoped to the author and persists across
 * drafts. URLs land in `/images/profile/<ownerHash>/<hash>.<ext>`
 * — the ownerHash is opaque so the email never appears in any
 * embedded deck output.
 *
 * UX:
 *   - Header + short explainer.
 *   - File-input affordance for uploads (PNG/JPEG/WebP/GIF/SVG, ≤10 MB).
 *   - List of existing assets with a Copy URL button per row.
 *   - Delete affordance per row.
 *
 * Failure paths surface inline via the hook's `error` state — no
 * `alert()`, no toast (the route doesn't host a toast layer yet).
 *
 * Auth: `useProfileAssets()` uses `adminWriteHeaders()` under the
 * hood; production gates at Cloudflare Access. Service-token
 * callers see the empty state — the hook treats the Worker's 403
 * as "no assets available" so the panel renders cleanly without
 * any login UI shoved into the route.
 */

import { useCallback, useState } from "react";
import { Upload, Copy, Check, Trash2 } from "lucide-react";
import {
  ALLOWED_IMAGE_MIME_TYPES,
  useProfileAssets,
} from "@/hooks/useProfileAssets";

export function ProfileAssetShelf() {
  const { assets, error, upload, remove, loading } = useProfileAssets();
  const [copied, setCopied] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const onFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      // Reset the input so picking the same file twice re-triggers
      // the upload — important if a previous attempt errored.
      e.target.value = "";
      if (!file) return;
      try {
        setUploading(true);
        await upload(file);
      } catch {
        // `useProfileAssets` surfaces the error via its `error`
        // state; nothing extra to do here.
      } finally {
        setUploading(false);
      }
    },
    [upload],
  );

  const onCopy = useCallback(async (url: string) => {
    try {
      if (
        typeof navigator !== "undefined" &&
        navigator.clipboard &&
        typeof navigator.clipboard.writeText === "function"
      ) {
        await navigator.clipboard.writeText(url);
      }
      setCopied(url);
      setTimeout(() => setCopied((cur) => (cur === url ? null : cur)), 1200);
    } catch {
      // Non-fatal — the URL is visible in the row, user can hand-copy.
    }
  }, []);

  return (
    <div
      data-testid="profile-asset-shelf"
      className="flex flex-col gap-3 rounded-md border border-cf-border bg-cf-bg-200 p-4"
    >
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="font-mono text-[11px] uppercase tracking-[0.25em] text-cf-text">
          Profile assets
        </h2>
        <code className="font-mono text-[10px] text-cf-text-muted">
          recurring
        </code>
      </div>
      <p className="text-xs leading-relaxed text-cf-text-muted">
        Upload your recurring assets once — speaker photo, logos, brand
        marks. They'll be passed to the AI on every new deck so it can
        embed them when relevant. Stored under a hashed owner identifier;
        your email is never in the URLs the deck embeds.
      </p>

      <label
        className="inline-flex w-fit cursor-pointer items-center gap-1.5 rounded border border-dashed border-cf-border bg-cf-bg-100 px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.2em] text-cf-text-muted transition-colors hover:border-cf-orange hover:text-cf-text"
        data-testid="profile-asset-shelf-upload-label"
      >
        <Upload size={11} aria-hidden="true" />
        {uploading ? "Uploading…" : "Upload profile asset"}
        <input
          data-testid="profile-asset-shelf-file-input"
          type="file"
          accept={ALLOWED_IMAGE_MIME_TYPES.join(",")}
          onChange={onFileChange}
          disabled={uploading}
          className="hidden"
        />
      </label>

      {error && (
        <p
          role="alert"
          data-testid="profile-asset-shelf-error"
          className="rounded border border-cf-orange/40 bg-cf-orange-light px-2 py-1 text-xs text-cf-orange"
        >
          {error}
        </p>
      )}

      <div className="flex flex-col gap-1.5">
        <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-cf-text-subtle">
          Library
        </p>
        {assets === null && loading ? (
          <p
            data-testid="profile-asset-shelf-loading"
            className="text-xs text-cf-text-muted"
          >
            Loading…
          </p>
        ) : !assets || assets.length === 0 ? (
          <p
            data-testid="profile-asset-shelf-empty"
            className="text-xs text-cf-text-muted"
          >
            No profile assets uploaded yet.
          </p>
        ) : (
          <ul className="flex flex-col gap-1">
            {assets.map((rec) => (
              <li
                key={rec.contentHash}
                data-testid={`profile-asset-shelf-item-${rec.contentHash}`}
                className="flex items-center gap-2 rounded border border-cf-border bg-cf-bg-100 px-2 py-1.5"
              >
                <img
                  src={rec.src}
                  alt=""
                  loading="lazy"
                  className="h-6 w-6 shrink-0 rounded object-cover"
                />
                <div className="flex min-w-0 flex-1 flex-col">
                  <code className="truncate font-mono text-[11px] text-cf-text">
                    {rec.src}
                  </code>
                  <span className="truncate text-[10px] text-cf-text-muted">
                    {rec.originalFilename}
                  </span>
                </div>
                <button
                  type="button"
                  data-interactive
                  data-testid={`profile-asset-shelf-copy-${rec.contentHash}`}
                  onClick={() => onCopy(rec.src)}
                  aria-label={`Copy URL ${rec.src}`}
                  className="inline-flex items-center gap-1 rounded border border-cf-border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.2em] text-cf-text-muted transition-colors hover:border-cf-orange hover:text-cf-text"
                >
                  {copied === rec.src ? (
                    <>
                      <Check size={10} aria-hidden="true" /> Copied
                    </>
                  ) : (
                    <>
                      <Copy size={10} aria-hidden="true" /> Copy
                    </>
                  )}
                </button>
                <button
                  type="button"
                  data-interactive
                  data-testid={`profile-asset-shelf-delete-${rec.contentHash}`}
                  onClick={() => {
                    void remove(rec.contentHash);
                  }}
                  aria-label={`Delete ${rec.originalFilename}`}
                  className="inline-flex items-center gap-1 rounded border border-cf-border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.2em] text-cf-text-muted transition-colors hover:border-cf-orange hover:text-cf-orange"
                >
                  <Trash2 size={10} aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
