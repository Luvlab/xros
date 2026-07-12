# XR Search

An **open-source, AI-powered immersive browser + search engine + XR ad platform**.
Results float around you in 3D space; it works on a plain phone, in a cardboard,
or on the desktop. Licensed **AGPL-3.0**.

Results float around you in 3D space. One codebase, three ways to look:

| Mode | Input | Where |
|---|---|---|
| **Desktop** | drag to look around, click a card | laptop/dev |
| **Tilt** (magic window) | move the phone, the world moves | phone/tablet |
| **VR Cardboard** | stereoscopic split-screen + gaze-dwell to select | phone in a cardboard |

Search is powered by the **Wikipedia API** (free, CORS, no key). Swap `src/search.js`
to change the data source (DuckDuckGo, your own API, an OpenRouter AI-answer endpoint…).

## Run

```bash
npm install
npm run dev      # http://localhost:5173  (also prints a Network URL for your phone)
npm run build    # production bundle in dist/
npm run preview  # serve the built bundle
```

### Testing on your phone
1. Phone + computer on the same Wi-Fi.
2. Open the **Network** URL that `npm run dev` prints (e.g. `http://192.168.1.223:5173`).
3. Tap **TILT** to move with the phone, or drop it in a cardboard and tap **VR**.

> ⚠️ Device orientation (tilt/VR) requires **https or localhost**. Over the LAN
> IP some phones block the motion sensor. For real https on a phone, tunnel it:
> `npx cloudflared tunnel --url http://localhost:5173` and open the https URL.
> On iOS you'll get a "Allow motion access?" prompt — tap Allow.

## How it works

```
index.html        2D overlay: search box, mode buttons, gaze reticle
src/
  main.js         orchestrator: modes, render loop, gaze/click selection
  scene.js        Three.js world: starfield, grid floor, lights, camera at origin
  controls.js     unified look controls — pointer drag + device orientation
  cards.js        result cards on a sphere (canvas-textured) + detail panel
  search.js       Wikipedia search provider (swap me)
```

The camera sits at the origin and only *rotates*; results are placed on a sphere
around you. In cardboard mode a `StereoEffect` renders the scene twice (one per
eye) and a center reticle fills over ~1.4s of gaze to select a card.

## Deploy (Vercel)

Static build — point Vercel at this folder, framework preset **Vite**,
build `npm run build`, output `dist`.

## The platform (roles, accounts, ads, apps)

Everything runs client-side by default. Point it at a **Supabase** project (see
[`supabase/README.md`](supabase/README.md)) to light up accounts, roles, the ad
platform, and the app store — no other server required.

```
cp .env.example .env      # add VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY
# run the migration in supabase/migrations/0001_init.sql
```

### Roles (capability-based RBAC — [`src/rbac.js`](src/rbac.js))
`Guest · Consumer · Creator · Advertiser · Moderator · Admin`. Code checks
**capabilities** (`can(user, 'campaign:manage')`), never role strings — so new
roles slot into `rbac.js` and nowhere else. Roles are stored on `profiles.role`;
a DB trigger prevents anyone but an admin from changing a role.

### Advertiser portal — [`advertiser.html`](advertiser.html)
Sign in → create campaigns → add creatives → activate. Served ads render as
spatial **billboards** in the scene; impressions/clicks log to `ad_events`.
Ad format spec: [`docs/XR-AD-FORMAT.md`](docs/XR-AD-FORMAT.md).

### XR OS shell — [`src/shell.js`](src/shell.js)
A spatial **app dock** beneath the search field. Published apps come from the
`apps` table; a starter set ships by default. (Bookmarks, downloads, and a
360-app embedding SDK are next.)

## Build phases
1. ✅ **Serverless core** — 360 browser + AI search (BYOK) + theme/CSS panel
2. ✅ **Accounts + roles** — Supabase auth, capability RBAC, account tab
3. ✅ **Advertiser portal + XR ad format** — campaigns, creatives, billboard serving
4. 🔵 **XR OS desktop** — app store, bookmarks/downloads sync, embedding SDK
5. 🔵 **Browser polish** — real web embedding, voice search, WebXR (Quest)

## Roadmap
- WebXR path for real headsets (Quest) alongside the cardboard fallback
- Voice search (Web Speech API) — hands-free in the cardboard
- Stripe billing for advertiser campaigns (Supabase Edge Function)
- `skybox` + `portal` ad formats; budget pacing + frequency capping
- Multi-source search federation (Wikipedia + web + your shop/projects)
