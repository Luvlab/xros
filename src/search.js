/**
 * Search provider. Uses the Wikipedia API — free, CORS-enabled (origin=*),
 * no API key. Returns normalized result objects the scene can render.
 *
 * Swap this file to change data sources (DuckDuckGo, your own API, an
 * OpenRouter-backed AI answer endpoint, etc.). Keep the returned shape:
 *   { id, title, snippet, url, thumb }   // thumb may be null
 */

const WIKI = 'https://en.wikipedia.org/w/api.php'

/**
 * @param {string} query
 * @param {number} limit
 * @returns {Promise<Array<{id:string,title:string,snippet:string,url:string,thumb:string|null}>>}
 */
export async function search(query, limit = 10) {
  const q = query.trim()
  if (!q) return []

  // One call: full-text search + thumbnails + intro extract via generator.
  const params = new URLSearchParams({
    action: 'query',
    format: 'json',
    origin: '*',
    generator: 'search',
    gsrsearch: q,
    gsrlimit: String(limit),
    prop: 'pageimages|extracts',
    piprop: 'thumbnail',
    pithumbsize: '480',
    exintro: '1',
    explaintext: '1',
    exsentences: '2',
  })

  const res = await fetch(`${WIKI}?${params.toString()}`)
  if (!res.ok) throw new Error(`Search failed: ${res.status}`)
  const data = await res.json()

  const pages = data?.query?.pages
  if (!pages) return []

  const items = Object.values(pages)
    // Preserve the search ranking order Wikipedia returns.
    .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
    .map((p) => ({
      id: String(p.pageid),
      kind: 'wiki', // opens the in-scene reader
      title: p.title,
      snippet: stripHtml(p.extract || ''),
      url: `https://en.wikipedia.org/?curid=${p.pageid}`,
      thumb: p.thumbnail?.source || null,
    }))

  return items
}

/**
 * XR tech news for the home page — recent stories from Hacker News (free,
 * CORS-enabled). Returns link-kind results (open in the in-app browser).
 */
export async function xrNews(limit = 30) {
  // HN Algolia treats the query as plain terms (no boolean OR), so we run a
  // few XR queries and merge, newest first.
  const queries = ['virtual reality', 'augmented reality', 'VR headset', 'mixed reality']
  const per = Math.max(10, Math.ceil(limit / 2))
  const reqs = queries.map((q) =>
    fetch(
      'https://hn.algolia.com/api/v1/search_by_date?tags=story&hitsPerPage=' +
        per +
        '&query=' +
        encodeURIComponent(q)
    )
      .then((r) => (r.ok ? r.json() : { hits: [] }))
      .catch(() => ({ hits: [] }))
  )
  const sets = await Promise.all(reqs)
  const seen = new Set()
  const out = []
  for (const d of sets) {
    for (const h of d.hits || []) {
      if (!h.title || !(h.url || h.story_url) || seen.has(h.objectID)) continue
      seen.add(h.objectID)
      out.push({
        id: 'hn-' + h.objectID,
        kind: 'link', // opens the in-app browser
        title: h.title,
        snippet:
          (h.points ? `${h.points} pts` : '') +
          (h.author ? ` · by ${h.author}` : '') +
          (h.num_comments ? ` · ${h.num_comments} comments` : ''),
        url: h.url || h.story_url,
        thumb: null,
        _t: h.created_at_i || 0,
      })
    }
  }
  out.sort((a, b) => b._t - a._t)
  return out.slice(0, limit)
}

function stripHtml(s) {
  return s
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Images — Openverse (CC-licensed, CORS-enabled, no key). kind:'image'. */
export async function searchImages(q, limit = 40) {
  const url =
    'https://api.openverse.org/v1/images/?page_size=' +
    limit +
    '&q=' +
    encodeURIComponent(q)
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Image search failed: ${res.status}`)
  const d = await res.json()
  return (d.results || [])
    .filter((r) => r.thumbnail)
    .map((r) => ({
      id: 'img-' + r.id,
      kind: 'image',
      title: r.title || 'Image',
      snippet:
        (r.creator ? `by ${r.creator}` : '') +
        (r.license ? ` · ${String(r.license).toUpperCase()}` : ''),
      url: r.foreign_landing_url || r.url,
      thumb: r.thumbnail,
    }))
}

/** Videos — Piped (YouTube front-end API, CORS). kind:'video'. */
export async function searchVideos(q, limit = 30) {
  const instances = [
    'https://pipedapi.kavin.rocks',
    'https://pipedapi.adminforge.de',
    'https://api.piped.private.coffee',
  ]
  for (const base of instances) {
    try {
      const res = await fetch(
        base + '/search?filter=videos&q=' + encodeURIComponent(q)
      )
      if (!res.ok) continue
      const d = await res.json()
      const items = d.items || []
      const out = items
        .filter((i) => i.url && i.url.includes('watch?v='))
        .slice(0, limit)
        .map((i) => {
          const id = i.url.split('watch?v=')[1].split('&')[0]
          return {
            id: 'vid-' + id,
            kind: 'video',
            title: i.title,
            snippet:
              (i.uploaderName || '') +
              (i.duration ? ` · ${fmtDur(i.duration)}` : ''),
            // Embeddable player URL (regular watch pages block iframing).
            url: 'https://www.youtube-nocookie.com/embed/' + id,
            thumb: `https://i.ytimg.com/vi/${id}/mqdefault.jpg`,
          }
        })
      if (out.length) return out
    } catch {
      /* try next instance */
    }
  }
  return []
}

/** Maps — Nominatim (OpenStreetMap geocoding, CORS). kind:'place'. */
export async function searchPlaces(q, limit = 20) {
  const url =
    'https://nominatim.openstreetmap.org/search?format=jsonv2&limit=' +
    limit +
    '&q=' +
    encodeURIComponent(q)
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Places failed: ${res.status}`)
  const d = await res.json()
  return (d || []).map((p) => {
    const lat = +p.lat
    const lon = +p.lon
    const bb = 0.05
    return {
      id: 'place-' + p.place_id,
      kind: 'place',
      title: (p.display_name || '').split(',')[0],
      snippet: p.display_name || '',
      // OSM embed loads inside the in-app browser (allows iframing).
      url: `https://www.openstreetmap.org/export/embed.html?bbox=${lon - bb}%2C${lat - bb}%2C${lon + bb}%2C${lat + bb}&layer=mapnik&marker=${lat}%2C${lon}`,
      thumb: null,
    }
  })
}

/** Shopping — links into major marketplaces for the query (no free product API). */
export function shoppingLinks(q) {
  const eq = encodeURIComponent(q)
  return [
    { store: 'Amazon', url: `https://www.amazon.com/s?k=${eq}`, color: '#ff9900' },
    { store: 'eBay', url: `https://www.ebay.com/sch/i.html?_nkw=${eq}`, color: '#e53238' },
    { store: 'Etsy', url: `https://www.etsy.com/search?q=${eq}`, color: '#f56400' },
    { store: 'Google Shopping', url: `https://www.google.com/search?tbm=shop&q=${eq}`, color: '#4285f4' },
    { store: 'AliExpress', url: `https://www.aliexpress.com/wholesale?SearchText=${eq}`, color: '#ff4747' },
  ].map((s, i) => ({
    id: 'shop-' + i,
    kind: 'link',
    title: `${q} — ${s.store}`,
    snippet: `Shop “${q}” on ${s.store}`,
    url: s.url,
    thumb: null,
  }))
}

function fmtDur(sec) {
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

/**
 * Fetch the full article content for the in-XROS reader — so results open
 * *inside* the browser instead of a new tab.
 * @param {string} pageid
 * @returns {Promise<{title:string,text:string,thumb:string|null,url:string}>}
 */
export async function fetchArticle(pageid) {
  const params = new URLSearchParams({
    action: 'query',
    format: 'json',
    origin: '*',
    pageids: String(pageid),
    prop: 'extracts|pageimages|info',
    explaintext: '1',
    exsectionformat: 'plain',
    piprop: 'thumbnail',
    pithumbsize: '640',
    inprop: 'url',
  })
  const res = await fetch(`${WIKI}?${params.toString()}`)
  if (!res.ok) throw new Error(`Article fetch failed: ${res.status}`)
  const data = await res.json()
  const p = data?.query?.pages?.[pageid]
  if (!p) throw new Error('Article not found')
  return {
    title: p.title,
    // Collapse runs of blank lines to single paragraph breaks.
    text: (p.extract || '').replace(/\n{2,}/g, '\n').trim(),
    thumb: p.thumbnail?.source || null,
    url: p.fullurl || `https://en.wikipedia.org/?curid=${pageid}`,
  }
}
