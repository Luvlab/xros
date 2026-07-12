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
      title: p.title,
      snippet: stripHtml(p.extract || ''),
      url: `https://en.wikipedia.org/?curid=${p.pageid}`,
      thumb: p.thumbnail?.source || null,
    }))

  return items
}

function stripHtml(s) {
  return s
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}
