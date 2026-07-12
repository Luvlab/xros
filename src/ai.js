/**
 * Bring-your-own-key AI client. Called directly from the browser — great for
 * open-source / self-host / local Ollama. Keys live only in the user's browser.
 *
 * ⚠ CORS reality (for a hosted product, proxy these server-side instead):
 *   - openrouter : browser calls work well ✅ (free models available)
 *   - ollama     : local, works if OLLAMA_ORIGINS allows the page ✅
 *   - anthropic  : works with the dangerous-direct-browser-access header ✅
 *   - openai/groq: usually CORS-blocked from a browser ✗ (need a proxy)
 */

export const PROVIDERS = {
  none: { label: 'Off (Wikipedia only)', needsKey: false },
  openrouter: {
    label: 'OpenRouter (recommended)',
    needsKey: true,
    defaultModel: 'meta-llama/llama-3.3-70b-instruct:free',
  },
  anthropic: {
    label: 'Anthropic (Claude)',
    needsKey: true,
    defaultModel: 'claude-haiku-4-5-20251001',
  },
  openai: { label: 'OpenAI', needsKey: true, defaultModel: 'gpt-4o-mini' },
  groq: {
    label: 'Groq',
    needsKey: true,
    defaultModel: 'llama-3.3-70b-versatile',
  },
  ollama: {
    label: 'Ollama (local)',
    needsKey: false,
    defaultModel: 'llama3.2',
  },
}

const SYSTEM =
  'You are XR Search, a concise spatial search assistant. Answer the query in ' +
  '2–4 sentences of plain text (no markdown). Use the provided context when ' +
  'relevant; if the context is thin, answer from general knowledge and say so briefly.'

/**
 * @returns {Promise<string>} the answer text (throws on failure)
 */
export async function aiAnswer(cfg, query, context = '') {
  const model = cfg.model || PROVIDERS[cfg.provider]?.defaultModel || ''
  const userMsg = context
    ? `Query: ${query}\n\nContext:\n${context}`
    : `Query: ${query}`

  switch (cfg.provider) {
    case 'openrouter':
      return openaiCompatible(
        'https://openrouter.ai/api/v1/chat/completions',
        cfg.apiKey,
        model,
        userMsg,
        { 'HTTP-Referer': location.origin, 'X-Title': 'XR Search' }
      )
    case 'openai':
      return openaiCompatible(
        'https://api.openai.com/v1/chat/completions',
        cfg.apiKey,
        model,
        userMsg
      )
    case 'groq':
      return openaiCompatible(
        'https://api.groq.com/openai/v1/chat/completions',
        cfg.apiKey,
        model,
        userMsg
      )
    case 'anthropic':
      return anthropic(cfg.apiKey, model, userMsg)
    case 'ollama':
      return ollama(cfg.ollamaUrl, model, userMsg)
    default:
      throw new Error('AI provider not configured')
  }
}

async function openaiCompatible(url, key, model, userMsg, extraHeaders = {}) {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
      ...extraHeaders,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: userMsg },
      ],
      temperature: 0.3,
      max_tokens: 400,
    }),
  })
  if (!res.ok) throw new Error(await errText(res))
  const data = await res.json()
  return data.choices?.[0]?.message?.content?.trim() || '(empty answer)'
}

async function anthropic(key, model, userMsg) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model,
      max_tokens: 400,
      system: SYSTEM,
      messages: [{ role: 'user', content: userMsg }],
    }),
  })
  if (!res.ok) throw new Error(await errText(res))
  const data = await res.json()
  return data.content?.[0]?.text?.trim() || '(empty answer)'
}

async function ollama(baseUrl, model, userMsg) {
  const res = await fetch(`${baseUrl.replace(/\/$/, '')}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      stream: false,
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: userMsg },
      ],
    }),
  })
  if (!res.ok) throw new Error(await errText(res))
  const data = await res.json()
  return data.message?.content?.trim() || '(empty answer)'
}

async function errText(res) {
  let body = ''
  try {
    body = (await res.text()).slice(0, 200)
  } catch {}
  return `AI request failed (${res.status}) ${body}`
}
