# XR Ad Format (draft spec)

Ad formats for the spatial search space. Advertisers buy inventory; creatives
are served into the 3D scene and impressions/clicks logged to `ad_events`.

## Formats

| Format | Rendered as | Status |
|---|---|---|
| `billboard` | a floating panel placed in the periphery of the result field | ✅ implemented ([`src/ads.js`](../src/ads.js)) |
| `skybox` | a full 360° backdrop takeover (brand environment) | 🔵 planned |
| `portal` | a doorway/ring that opens a hosted brand experience | 🔵 planned |

## Creative fields (`ad_creatives`)

```
format     billboard | skybox | portal
title      short headline (≤ 2 lines on the panel)
body       message text (≤ 5 lines)
media_url  optional image/texture (billboard art, skybox equirect, portal preview)
click_url  destination opened on activation (click / gaze-dwell)
```

Media guidance:
- **billboard** — 16:10 image, ≥ 640×400, transparent PNG or solid.
- **skybox** — 2:1 equirectangular JPG/PNG, ≥ 4096×2048.
- **portal** — square preview, ≥ 1024×1024.

## Serving

`AdLayer.load()` requests active creatives:

```sql
select … from ad_creatives
join campaigns on campaigns.id = ad_creatives.campaign
where campaigns.status = 'active'
```

RLS lets any authenticated user read creatives of `active` campaigns; everything
else (creating/editing) is restricted to the owning advertiser. When no backend
is configured a built-in demo creative renders so the format is always visible.

Selection weighting (`pickWeighted`) is uniform today — the hook is where
budget/bid pacing and frequency capping will live.

## Measurement

Every render logs an `impression`; every activation logs a `click`, both into
`ad_events` (best-effort; failures never block the UI). Advertisers can read
events for their own campaigns; aggregate reporting lives in the portal.

## Roadmap
- Budget pacing + bid-weighted selection + frequency capping
- `skybox` + `portal` renderers
- Brand-safety review queue (moderator role) before `active`
- Viewability (dwell-time weighted impressions) and gaze heatmaps
