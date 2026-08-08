import { supabase, isBackendConfigured } from './supabaseClient.js'

/**
 * XR ad serving + measurement.
 *
 * Ads render as an in-feed card slotted BETWEEN the search results (see
 * ResultsLayer), so they always sit in view rather than off in the periphery.
 * This layer just picks the creative to serve and logs impressions/clicks.
 *
 * Formats (docs/XR-AD-FORMAT.md): billboard (in-feed card), skybox, portal.
 */
const DEMO_CREATIVE = {
  id: 'demo',
  format: 'billboard',
  title: 'Your brand, in the search space',
  body: 'Buy XR & AR ad inventory on XR Search — in-feed, 360 takeovers, portals. Tap to become an advertiser.',
  media_url: null,
  click_url: 'https://luvlab.io',
}

export class AdLayer {
  constructor() {
    this.creative = DEMO_CREATIVE // available immediately; refined by load()
  }

  async load() {
    this.creative = DEMO_CREATIVE
    if (isBackendConfigured) {
      try {
        const { data } = await supabase
          .from('xros_ad_creatives')
          .select(
            'id, format, title, body, media_url, click_url, campaign:xros_campaigns!inner(status)'
          )
          .eq('campaign.status', 'active')
          .eq('format', 'billboard')
          .limit(10)
        if (data && data.length) this.creative = pickWeighted(data)
      } catch {
        /* keep demo */
      }
    }
    return this.creative
  }

  async logEvent(type, userId = null, creative = this.creative) {
    if (!isBackendConfigured || !creative || creative.id === 'demo') return
    try {
      await supabase.from('xros_ad_events').insert({
        creative: creative.id,
        event_type: type,
        user_id: userId,
      })
    } catch {
      /* analytics is best-effort */
    }
  }
}

function pickWeighted(list) {
  // Placeholder for budget/bid weighting — first active for now.
  return list[0]
}
