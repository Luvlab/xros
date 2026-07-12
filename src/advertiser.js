import { supabase, isBackendConfigured } from './supabaseClient.js'
import { Auth } from './auth.js'
import { can } from './rbac.js'
import { Settings } from './settings.js'

// Match the user's chosen theme on the portal too.
new Settings().applyTheme()

const root = document.getElementById('portal-root')
const auth = new Auth()

boot()

async function boot() {
  if (!isBackendConfigured) {
    return note(
      'No backend configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY (see .env.example) to enable the advertiser portal.'
    )
  }
  await auth.init()
  auth.onChange(render)
  render()
}

function note(msg, cls = 'portal-note') {
  root.innerHTML = `<div class="${cls}"></div>`
  root.firstChild.textContent = msg
}

function render() {
  if (!auth.profile) return renderSignIn()
  if (!can(auth.profile, 'campaign:manage')) return renderGate()
  renderDashboard()
}

function renderSignIn() {
  root.innerHTML = `
    <div class="panel">
      <h2>Advertiser sign-in</h2>
      <p class="muted">Sign in to manage XR & AR ad campaigns.</p>
      <div class="row" style="margin-top:12px">
        <div style="flex:2 1 220px">
          <label class="f" for="email">Email (magic link)</label>
          <input class="i" id="email" type="email" placeholder="you@brand.com" />
        </div>
        <button class="btn" id="signin">Send link</button>
      </div>
      <p class="err" id="err"></p>
    </div>`
  const err = document.getElementById('err')
  document.getElementById('signin').addEventListener('click', async () => {
    const email = document.getElementById('email').value.trim()
    if (!email) return
    try {
      await auth.signInWithEmail(email)
      note('Check your email for the magic link, then return here.')
    } catch (e) {
      err.textContent = String(e.message || e)
    }
  })
}

function renderGate() {
  root.innerHTML = `
    <div class="panel">
      <h2>Advertiser access needed</h2>
      <p class="muted">
        You're signed in as <b>${escapeHtml(auth.profile.email)}</b> with the
        role <b>${escapeHtml(auth.role)}</b>. Ad campaign tools require the
        <b>advertiser</b> role. Contact an admin to upgrade your account
        (roles can only be changed by an administrator).
      </p>
      <button class="btn ghost" id="out" style="margin-top:12px">Sign out</button>
    </div>`
  document.getElementById('out').addEventListener('click', () => auth.signOut())
}

async function renderDashboard() {
  root.innerHTML = `
    <div class="panel">
      <div class="row" style="justify-content:space-between">
        <h2 style="flex:0">New campaign</h2>
        <button class="btn ghost" id="out" style="flex:0">Sign out</button>
      </div>
      <div class="row">
        <div style="flex:2 1 200px">
          <label class="f" for="c-name">Name</label>
          <input class="i" id="c-name" placeholder="Summer XR push" />
        </div>
        <div>
          <label class="f" for="c-budget">Budget (kr)</label>
          <input class="i" id="c-budget" type="number" min="0" value="1000" />
        </div>
        <button class="btn" id="c-create">Create</button>
      </div>
      <p class="err" id="c-err"></p>
    </div>
    <div id="list"><div class="portal-note">Loading campaigns…</div></div>`

  document.getElementById('out').addEventListener('click', () => auth.signOut())
  document
    .getElementById('c-create')
    .addEventListener('click', createCampaign)
  loadCampaigns()
}

async function createCampaign() {
  const err = document.getElementById('c-err')
  err.textContent = ''
  const name = document.getElementById('c-name').value.trim()
  const kr = Number(document.getElementById('c-budget').value || 0)
  if (!name) return (err.textContent = 'Name is required.')
  const { error } = await supabase.from('xros_campaigns').insert({
    advertiser: auth.profile.id,
    name,
    budget_cents: Math.round(kr * 100),
    status: 'draft',
  })
  if (error) return (err.textContent = error.message)
  document.getElementById('c-name').value = ''
  loadCampaigns()
}

async function loadCampaigns() {
  const list = document.getElementById('list')
  const { data: campaigns, error } = await supabase
    .from('xros_campaigns')
    .select('id, name, status, budget_cents, spend_cents, created_at')
    .order('created_at', { ascending: false })
  if (error) {
    list.innerHTML = `<div class="err">${escapeHtml(error.message)}</div>`
    return
  }
  if (!campaigns.length) {
    list.innerHTML = `<div class="portal-note">No campaigns yet — create your first above.</div>`
    return
  }

  // Fetch creatives for all campaigns in one query.
  const ids = campaigns.map((c) => c.id)
  const { data: creatives } = await supabase
    .from('xros_ad_creatives')
    .select('id, campaign, format, title, click_url')
    .in('campaign', ids)
  const byCampaign = groupBy(creatives || [], 'campaign')

  list.innerHTML = ''
  for (const c of campaigns) {
    list.appendChild(campaignCard(c, byCampaign[c.id] || []))
  }
}

function campaignCard(c, creatives) {
  const el = document.createElement('div')
  el.className = 'panel'
  const kr = (c.budget_cents / 100).toFixed(0)
  el.innerHTML = `
    <div class="campaign-head">
      <div>
        <strong>${escapeHtml(c.name)}</strong>
        <div class="muted">Budget ${kr} kr · spent ${(c.spend_cents / 100).toFixed(0)} kr</div>
      </div>
      <span class="status ${c.status === 'active' ? 'active' : ''}">${c.status}</span>
    </div>
    <div class="row" style="margin-top:10px">
      <button class="btn ghost toggle" style="flex:0">${c.status === 'active' ? 'Pause' : 'Activate'}</button>
    </div>
    <div class="creatives"></div>
    <div class="row" style="margin-top:10px">
      <div style="flex:2 1 180px"><label class="f">Creative title</label><input class="i ct" placeholder="Headline" /></div>
      <div style="flex:3 1 220px"><label class="f">Body</label><input class="i cb" placeholder="Short message" /></div>
      <div style="flex:2 1 160px"><label class="f">Click URL</label><input class="i cu" placeholder="https://…" /></div>
      <button class="btn add" style="flex:0">Add</button>
    </div>
    <p class="err cerr"></p>`

  const cwrap = el.querySelector('.creatives')
  if (!creatives.length) {
    cwrap.innerHTML = `<div class="creative">No creatives yet.</div>`
  } else {
    for (const cr of creatives) {
      const d = document.createElement('div')
      d.className = 'creative'
      d.textContent = `▸ [${cr.format}] ${cr.title || '(untitled)'} → ${cr.click_url || '—'}`
      cwrap.appendChild(d)
    }
  }

  el.querySelector('.toggle').addEventListener('click', async () => {
    const next = c.status === 'active' ? 'paused' : 'active'
    const { error } = await supabase
      .from('xros_campaigns')
      .update({ status: next })
      .eq('id', c.id)
    if (!error) loadCampaigns()
    else el.querySelector('.cerr').textContent = error.message
  })

  el.querySelector('.add').addEventListener('click', async () => {
    const title = el.querySelector('.ct').value.trim()
    const body = el.querySelector('.cb').value.trim()
    const url = el.querySelector('.cu').value.trim()
    const cerr = el.querySelector('.cerr')
    cerr.textContent = ''
    if (!title) return (cerr.textContent = 'Title required.')
    const { error } = await supabase.from('xros_ad_creatives').insert({
      campaign: c.id,
      format: 'billboard',
      title,
      body,
      click_url: url,
    })
    if (error) cerr.textContent = error.message
    else loadCampaigns()
  })

  return el
}

function groupBy(arr, key) {
  return arr.reduce((acc, x) => {
    ;(acc[x[key]] ||= []).push(x)
    return acc
  }, {})
}

function escapeHtml(s) {
  return String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  )
}
