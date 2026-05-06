# Deploying ReAction

Production lives at **<https://reaction.lusostreams.com>**, served by the `reaction` Worker on the `lusostreams.com` Cloudflare zone. This runbook covers:

- One-time setup (Custom Domain + Cloudflare Access)
- Routine redeploys
- Verification
- Rollback

It assumes you are Miguel, deploying from a checkout of `mcdays94/ReAction` with `wrangler login` already done.

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
- Reconciles the Custom Domain route (`reaction.lusostreams.com`)
- Uploads Static Assets bundle

Open <https://reaction.lusostreams.com> and confirm the new build is live.

---

## One-time setup

These steps are only needed on the very first production deploy (or if the Worker / Access app gets deleted). After that, `npm run deploy` handles everything code-side.

### 1. Confirm prerequisites

- `lusostreams.com` is an active Cloudflare zone in account `1bcef46cbe9172d2569dcf7039048842`.
- `wrangler whoami` returns the account that owns the zone.
- The hostname `reaction.lusostreams.com` does **not** already have a CNAME or A record. (If it does, delete it via **DNS → Records** before continuing — Custom Domains refuse to attach to a hostname with an existing CNAME.)

### 2. First deploy — let Wrangler create the Custom Domain

`wrangler.jsonc` declares the route:

```jsonc
"routes": [
  {
    "pattern": "reaction.lusostreams.com",
    "custom_domain": true
  }
]
```

Run:

```bash
npm run deploy
```

On the first deploy, Wrangler will:

- Create the Worker (if it doesn't exist) at `reaction.workers.dev`
- Attach `reaction.lusostreams.com` as a Custom Domain
- Auto-create the proxied DNS record on the zone
- Issue an Advanced Certificate via Cloudflare's certificate authority

Verify in the dashboard at **Workers & Pages → reaction → Settings → Domains & Routes**: you should see `reaction.lusostreams.com` listed under **Custom Domains** with status **Active**.

> **Fallback path (dashboard-driven).** If for any reason the Wrangler-driven attachment fails (e.g. the hostname is not in a zone Wrangler can manage from this account), attach the Custom Domain manually via **Workers & Pages → reaction → Settings → Domains & Routes → Add → Custom Domain** and re-run `npm run deploy`. The `routes` entry in `wrangler.jsonc` is idempotent — it will reconcile against the dashboard state without creating duplicates.

### 3. Configure Cloudflare Access for `/admin/*`

Cloudflare Access has no Wrangler-side config. This step is dashboard-only.

1. Go to **Zero Trust → Access → Applications → Add an application → Self-hosted**.
2. Application configuration:
   - **Application name:** `ReAction Admin`
   - **Session duration:** `24 hours`
   - **Application domain:** `reaction.lusostreams.com`
   - **Path:** `/admin/*` (also covers `/admin` itself; Access matches the path prefix)
3. Identity providers:
   - Enable the **One-time PIN** (email) provider, or whatever IdP you prefer (GitHub, Google, etc.)
4. Policies → **Add a policy**:
   - **Policy name:** `Allow Miguel`
   - **Action:** `Allow`
   - **Configure rules → Include → Emails:** `amtccdias@gmail.com`
   - Leave everything else default
5. Save.

After save, hitting any path matching `reaction.lusostreams.com/admin/*` will trigger the Access challenge. The public deck index (`/`) and the deck viewer (`/decks/<slug>`) remain unauthenticated.

### 4. Verify production end-to-end

```bash
# Public landing page — should return 200 and render the deck index
curl -I https://reaction.lusostreams.com/

# Hello deck — should return 200 unauthenticated
curl -I https://reaction.lusostreams.com/decks/hello

# Admin — should return Access challenge (302 to a *.cloudflareaccess.com URL,
# or a 401 / Access HTML page depending on Access policy)
curl -I https://reaction.lusostreams.com/admin
```

Then in a browser:

1. Visit <https://reaction.lusostreams.com/> — public deck index loads.
2. Click into the **hello** deck, walk through with `→`, exercise `O` overview.
3. Visit <https://reaction.lusostreams.com/admin> — Access prompt appears, authenticate with the email allow-listed in the policy.
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

Something on `reaction.lusostreams.com` is already bound. Likely causes:

1. A pre-existing CNAME or A record at `reaction` on the zone — go to **DNS → Records** and delete it.
2. The Custom Domain is attached to a different Worker — go to **Workers & Pages**, find it, detach, then redeploy.

### Public site loads, but `/admin` does not show the Access challenge

- Confirm the Access application is configured for **path** `/admin/*` (not `/admin` exact).
- Confirm the application's domain is exactly `reaction.lusostreams.com` (not `www.reaction.lusostreams.com` or similar).
- Cloudflare Access changes can take ~30 seconds to propagate. Wait, then try in a fresh incognito window (Access caches the JWT in a cookie).

### Admin returns 200 with no content / empty deck list

The admin viewer reads the same deck registry as the public viewer. In production, only `src/decks/public/*` is bundled — `src/decks/private/*` is gitignored and excluded from the build. If you expected a private deck to appear, that is by design — privates run only via local `npm run dev`.

### Build is fine locally but production renders an old version

Cloudflare's edge cache may be holding a previous build. Visit the page with `?_ts=<random>` appended, or use **Caching → Purge Everything** in the zone dashboard. (For routine redeploys this is rarely needed — Wrangler's deploy invalidates the asset bundle.)

### Custom Domain stuck in "Initializing"

Cloudflare is provisioning the certificate. This usually takes 30–90 seconds. If it's still pending after 5 minutes, check **SSL/TLS → Edge Certificates** for any certificate authority validation errors on the zone.

---

## Reference

- **Production URL:** <https://reaction.lusostreams.com>
- **`*.workers.dev` URL** (always live as a fallback): <https://reaction.<workers-subdomain>.workers.dev>
- **Account:** `1bcef46cbe9172d2569dcf7039048842`
- **Worker name:** `reaction`
- **Zone:** `lusostreams.com`
- **Access app:** `ReAction Admin` (Self-hosted, applied to `reaction.lusostreams.com/admin/*`)

Cloudflare docs:

- [Custom Domains for Workers](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/)
- [Cloudflare Access — Self-hosted applications](https://developers.cloudflare.com/cloudflare-one/applications/configure-apps/self-hosted-public-app/)
- [Wrangler `routes` config](https://developers.cloudflare.com/workers/wrangler/configuration/#types-of-routes)
- [Wrangler `versions` and rollback](https://developers.cloudflare.com/workers/wrangler/commands/#versions)
