# Deploying Slide of Hand

Production lives at **<https://slide-of-hand.lusostreams.com>**, served by the `slide-of-hand` Worker on the `lusostreams.com` Cloudflare zone. This runbook covers:

- One-time setup (Custom Domain + Cloudflare Access)
- Routine redeploys
- Verification
- Rollback

It assumes you are Miguel, deploying from a checkout of `mcdays94/slide-of-hand` with `wrangler login` already done.

---

## Thumbnails (build artifact, not committed)

Per-deck slide thumbnails live at `public/thumbnails/<slug>/<NN>.png` and are
gitignored. Regenerate before every deploy:

```bash
npm run thumbnails
```

The script (`scripts/build-thumbnails.mjs`) boots a transient `vite dev` on
port 5218, walks every public deck, snaps each slide at 1920×1080, and writes
320×180 PNGs. Takes ~10s per deck. Requires `playwright` + `sharp` devDeps
(installed via `npm install`) and a one-time `npx playwright install chromium`.

Production gracefully falls back to text tiles if the thumbnails are absent —
the build will not fail without them — but the Overview grid (`O`) and the
public DeckCard look much better with real screenshots, so it's part of the
routine redeploy flow above.

---

## TL;DR (routine redeploy)

```bash
git checkout main && git pull
npm ci
npm test
npm run thumbnails   # snap fresh /admin + Overview thumbnails (~10s per deck)
npm run deploy       # = npm run build && wrangler deploy
```

That's it. Wrangler reads `wrangler.jsonc` and:

- Builds the SPA into `dist/`
- Deploys the Worker
- Reconciles the Custom Domain route (`slide-of-hand.lusostreams.com`)
- Uploads Static Assets bundle

Open <https://slide-of-hand.lusostreams.com> and confirm the new build is live.

---

## One-time setup

These steps are only needed on the very first production deploy (or if the Worker / Access app gets deleted). After that, `npm run deploy` handles everything code-side.

### 1. Confirm prerequisites

- `lusostreams.com` is an active Cloudflare zone in account `1bcef46cbe9172d2569dcf7039048842`.
- `wrangler whoami` returns the account that owns the zone.
- The hostname `slide-of-hand.lusostreams.com` does **not** already have a CNAME or A record. (If it does, delete it via **DNS → Records** before continuing — Custom Domains refuse to attach to a hostname with an existing CNAME.)

### 2. First deploy — let Wrangler create the Custom Domain

`wrangler.jsonc` declares the route:

```jsonc
"routes": [
  {
    "pattern": "slide-of-hand.lusostreams.com",
    "custom_domain": true
  }
]
```

Run:

```bash
npm run deploy
```

On the first deploy, Wrangler will:

- Create the Worker (if it doesn't exist) at `slide-of-hand.workers.dev`
- Attach `slide-of-hand.lusostreams.com` as a Custom Domain
- Auto-create the proxied DNS record on the zone
- Issue an Advanced Certificate via Cloudflare's certificate authority

Verify in the dashboard at **Workers & Pages → slide-of-hand → Settings → Domains & Routes**: you should see `slide-of-hand.lusostreams.com` listed under **Custom Domains** with status **Active**.

> **Fallback path (dashboard-driven).** If for any reason the Wrangler-driven attachment fails (e.g. the hostname is not in a zone Wrangler can manage from this account), attach the Custom Domain manually via **Workers & Pages → slide-of-hand → Settings → Domains & Routes → Add → Custom Domain** and re-run `npm run deploy`. The `routes` entry in `wrangler.jsonc` is idempotent — it will reconcile against the dashboard state without creating duplicates.

### 3. Configure Cloudflare Access for `/admin/*`

Cloudflare Access has no Wrangler-side config. This step is dashboard-only.

1. Go to **Zero Trust → Access → Applications → Add an application → Self-hosted**.
2. Application configuration:
   - **Application name:** `Slide of Hand Admin`
   - **Session duration:** `24 hours`
   - **Application domain:** `slide-of-hand.lusostreams.com`
   - **Path:** `/admin/*` (also covers `/admin` itself; Access matches the path prefix)
3. Identity providers:
   - Enable the **One-time PIN** (email) provider, or whatever IdP you prefer (GitHub, Google, etc.)
4. Policies → **Add a policy**:
   - **Policy name:** `Allow Miguel`
   - **Action:** `Allow`
   - **Configure rules → Include → Emails:** `amtccdias@gmail.com`
   - Leave everything else default
5. Save.

After save, hitting any path matching `slide-of-hand.lusostreams.com/admin/*` will trigger the Access challenge. The public deck index (`/`) and the deck viewer (`/decks/<slug>`) remain unauthenticated.

### 4. Verify production end-to-end

```bash
# Public landing page — should return 200 and render the deck index
curl -I https://slide-of-hand.lusostreams.com/

# Hello deck — should return 200 unauthenticated
curl -I https://slide-of-hand.lusostreams.com/decks/hello

# Admin — should return Access challenge (302 to a *.cloudflareaccess.com URL,
# or a 401 / Access HTML page depending on Access policy)
curl -I https://slide-of-hand.lusostreams.com/admin
```

Then in a browser:

1. Visit <https://slide-of-hand.lusostreams.com/> — public deck index loads.
2. Click into the **hello** deck, walk through with `→`, exercise `O` overview.
3. Visit <https://slide-of-hand.lusostreams.com/admin> — Access prompt appears, authenticate with the email allow-listed in the policy.
4. Once through, the admin viewer loads with the same deck list (public decks only — privates are not bundled in the production build).

If any of those fail, see **Troubleshooting** below.

---

## Routine redeploy

For any change after the one-time setup:

```bash
git checkout main
git pull
npm ci             # only if package-lock.json changed
npm test           # vitest run
npm run typecheck  # tsc --noEmit
npm run deploy     # build + wrangler deploy
```

`npm run deploy` is idempotent. The Custom Domain and DNS record are reconciled (not recreated) on every deploy. Cloudflare Access policy is unaffected — Access lives outside the Worker and does not need redeploying.

---

## Rollback

Wrangler keeps every uploaded version. To roll back:

```bash
# List recent versions (most recent first)
npx wrangler versions list

# View a specific version
npx wrangler versions view <VERSION_ID>

# Roll back to the previous version
npx wrangler rollback

# Or roll back to a specific version
npx wrangler rollback <VERSION_ID>
```

A rollback is instant — it just flips which version is active. No rebuild needed.

If the issue is in the Static Assets bundle (rather than the Worker code), a rollback alone is enough — the Assets binding is part of the version metadata.

---

## Troubleshooting

### `npm run deploy` fails with `"Cannot create custom domain — hostname already exists"`

Something on `slide-of-hand.lusostreams.com` is already bound. Likely causes:

1. A pre-existing CNAME or A record at `slide-of-hand` on the zone — go to **DNS → Records** and delete it.
2. The Custom Domain is attached to a different Worker — go to **Workers & Pages**, find it, detach, then redeploy.

### Public site loads, but `/admin` does not show the Access challenge

- Confirm the Access application is configured for **path** `/admin/*` (not `/admin` exact).
- Confirm the application's domain is exactly `slide-of-hand.lusostreams.com` (not `www.slide-of-hand.lusostreams.com` or similar).
- Cloudflare Access changes can take ~30 seconds to propagate. Wait, then try in a fresh incognito window (Access caches the JWT in a cookie).

### Admin returns 200 with no content / empty deck list

The admin viewer reads the same deck registry as the public viewer. In production, only `src/decks/public/*` is bundled — `src/decks/private/*` is gitignored and excluded from the build. If you expected a private deck to appear, that is by design — privates run only via local `npm run dev`.

### Build is fine locally but production renders an old version

Cloudflare's edge cache may be holding a previous build. Visit the page with `?_ts=<random>` appended, or use **Caching → Purge Everything** in the zone dashboard. (For routine redeploys this is rarely needed — Wrangler's deploy invalidates the asset bundle.)

### Custom Domain stuck in "Initializing"

Cloudflare is provisioning the certificate. This usually takes 30–90 seconds. If it's still pending after 5 minutes, check **SSL/TLS → Edge Certificates** for any certificate authority validation errors on the zone.

---

## Theme overrides (KV)

Per-deck theme overrides — the four core brand tokens (`cf-bg-100`, `cf-text`, `cf-orange`, `cf-border`) — are persisted in a Cloudflare KV namespace. The binding lives in `wrangler.jsonc`:

```jsonc
"kv_namespaces": [
  {
    "binding": "THEMES",
    "id": "<production-namespace-id>",
    "preview_id": "<preview-namespace-id>"
  }
]
```

The IDs are committed to the repo. They survive every deploy — the bindings are stable, KV data persists across Worker versions and rollbacks. To recreate them from scratch (e.g. for a fork):

```bash
npx wrangler kv namespace create THEMES
npx wrangler kv namespace create THEMES --preview
# Paste the resulting IDs into wrangler.jsonc.
```

### How overrides flow in production

1. **Author** opens `https://slide-of-hand.lusostreams.com/admin/decks/<slug>`, presses `T`, drags a colour picker (live preview, no save), clicks **Save**.
2. **Worker** receives `POST /api/admin/themes/<slug>` (Access-gated — only the author's email can hit this), validates the body shape, writes `theme:<slug>` to KV.
3. **Public visitors** at `https://slide-of-hand.lusostreams.com/decks/<slug>` fetch `GET /api/themes/<slug>` on viewer mount; the override applies as `:root` CSS custom properties. The read endpoint returns `cache-control: public, max-age=60`, so save-to-visible latency is bounded by 60 seconds at the edge plus KV's eventual-consistency window (~30–60 s globally).

### Inspecting / managing entries

```bash
# List all theme keys
npx wrangler kv key list --binding=THEMES

# Read a specific deck's override
npx wrangler kv key get --binding=THEMES theme:hello

# Wipe a deck's override (same effect as the sidebar's Reset button)
npx wrangler kv key delete --binding=THEMES theme:hello
```

For the local preview namespace (used by `wrangler dev`), pass `--preview`:

```bash
npx wrangler kv key list --binding=THEMES --preview
```

### Local end-to-end testing

`vite dev` does not understand KV bindings. Use Wrangler:

```bash
npx wrangler dev --port=5212
```

Wrangler serves the bundled SPA + `/api/*` endpoints with the **preview** KV namespace bound, so writes during local testing don't touch production data. Cloudflare Access does not enforce in dev — all `/admin/*` paths are reachable without a JWT.

### v2 follow-ups (not in this release)

- Typography + spacing tokens
- Contrast checker (WCAG AA)
- Server-side `<style>` injection via HTMLRewriter (eliminates the brief FOUC on first paint)
- Share-preview links (read-only public URL with a draft override applied)

---

## Slide manifests (KV)

Per-deck slide manifests — reorder, hide/show, rename, and replace
speaker notes — are persisted in a separate KV namespace. The binding
lives in `wrangler.jsonc` alongside `THEMES`:

```jsonc
"kv_namespaces": [
  { "binding": "THEMES",    "id": "...", "preview_id": "..." },
  { "binding": "MANIFESTS", "id": "...", "preview_id": "..." }
]
```

The IDs are committed to the repo. They survive every deploy — bindings
are stable, KV data persists across Worker versions and rollbacks. To
recreate them from scratch (e.g. for a fork):

```bash
npx wrangler kv namespace create MANIFESTS
npx wrangler kv namespace create MANIFESTS --preview
# Paste the resulting IDs into wrangler.jsonc.
```

### Manifest shape

One key per deck: `manifest:<slug>` → JSON

```json
{
  "version": 1,
  "order": ["title", "what-is-this", "phase-demo", "section", "thanks"],
  "overrides": {
    "title":         { "title": "New title", "hidden": false },
    "what-is-this":  { "notes": "**Updated** notes\n\n* point 1" }
  },
  "updatedAt": "2026-05-06T10:00:00.000Z"
}
```

`order` lists every slide ID in display order. `overrides` is sparse —
only slides with at least one override appear. Each override may carry
optional `hidden` (boolean), `title` (≤ 200 chars), and `notes`
(markdown, ≤ 10000 chars). Notes render in the presenter window via
`react-markdown`.

### How manifests flow in production

1. **Author** opens `https://slide-of-hand.lusostreams.com/admin/decks/<slug>`,
   presses `M`, drags a slide to reorder / toggles hidden / renames /
   edits notes (live preview, no save), clicks **Save**.
2. **Worker** receives `POST /api/admin/manifests/<slug>` (Access-gated),
   validates the body shape (kebab-case IDs, no duplicates, length
   limits), writes `manifest:<slug>` to KV.
3. **Public visitors** at `https://slide-of-hand.lusostreams.com/decks/<slug>`
   fetch `GET /api/manifests/<slug>` on viewer mount; `<Deck>` runs
   `mergeSlides(sourceSlides, manifest)` and the reordered / overridden
   list takes effect. Same `cache-control: public, max-age=60` as the
   theme API.

### Fail-soft drift handling

The merge step (`src/lib/manifest-merge.tsx`) is intentionally tolerant
of drift between a saved manifest and the current source slide list:

- **Slide deleted from source after manifest was written** — the
  manifest's reference to that ID is silently skipped (with a
  `console.warn` for debugging).
- **Slide added to source after manifest was written** — the new slide
  is appended at the end of the merged list, so it stays visible without
  forcing the author to re-save.

Saving from the sidebar always writes a complete `order` reflecting the
current source list, which heals drift.

### Inspecting / managing entries

```bash
npx wrangler kv key list --binding=MANIFESTS
npx wrangler kv key get  --binding=MANIFESTS manifest:hello
npx wrangler kv key delete --binding=MANIFESTS manifest:hello
```

For the local preview namespace (used by `wrangler dev`), pass
`--preview`:

```bash
npx wrangler kv key list --binding=MANIFESTS --preview
```

### Out of scope (v1)

The sidebar deliberately omits **duplicate** and **delete**, because
those imply source-edit (creating new slide files, removing them) which
fights the KV-override pattern. The author opens the IDE for those
operations — the `vscode://` deep-link button on the admin landing page
makes that one click.

---

## Reference

- **Production URL:** <https://slide-of-hand.lusostreams.com>
- **`*.workers.dev` URL** (always live as a fallback): <https://slide-of-hand.<workers-subdomain>.workers.dev>
- **Account:** `1bcef46cbe9172d2569dcf7039048842`
- **Worker name:** `slide-of-hand`
- **Zone:** `lusostreams.com`
- **Access app:** `Slide of Hand Admin` (Self-hosted, applied to `slide-of-hand.lusostreams.com/admin/*`)

Cloudflare docs:

- [Custom Domains for Workers](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/)
- [Cloudflare Access — Self-hosted applications](https://developers.cloudflare.com/cloudflare-one/applications/configure-apps/self-hosted-public-app/)
- [Wrangler `routes` config](https://developers.cloudflare.com/workers/wrangler/configuration/#types-of-routes)
- [Wrangler `versions` and rollback](https://developers.cloudflare.com/workers/wrangler/commands/#versions)
