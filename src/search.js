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
  const q = 'virtual reality OR augmented reality OR mixed reality OR headset'
  const url =
    'https://hn.algolia.com/api/v1/search_by_date?tags=story&hitsPerPage=' +
    limit +
    '&query=' +
    encodeURIComponent(q)
  const res = await fetch(url)
  if (!res.ok) throw new Error(`News fetch failed: ${res.status}`)
  const data = await res.json()
  return (data.hits || [])
    .filter((h) => h.title && (h.url || h.story_url))
    .map((h) => ({
      id: 'hn-' + h.objectID,
      kind: 'link', // opens the in-app browser
      title: h.title,
      snippet:
        (h.points ? `${h.points} pts` : '') +
        (h.author ? ` · by ${h.author}` : '') +
        (h.num_comments ? ` · ${h.num_comments} comments` : ''),
      url: h.url || h.story_url,
      thumb: null,
    }))
}

function stripHtml(s) {
  return s
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim()
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
