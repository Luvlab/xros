import { supabase, isBackendConfigured } from './supabaseClient.js'

/**
 * Auth + profile layer. Wraps Supabase Auth and the `profiles` table.
 *
 * The rest of the app talks to this, never to Supabase directly, so swapping
 * the backend later touches only this file. When no backend is configured,
 * the user is always the anonymous "guest" and all methods no-op safely.
 */
export class Auth {
  constructor() {
    this.user = null // Supabase auth user (or null)
    this.profile = null // { id, email, display_name, role } (or null => guest)
    this._listeners = new Set()
    this.enabled = isBackendConfigured
  }

  /** role string used by rbac.can() — 'guest' when signed out. */
  get role() {
    return this.profile?.role || 'guest'
  }

  onChange(cb) {
    this._listeners.add(cb)
    return () => this._listeners.delete(cb)
  }

  _emit() {
    for (const cb of this._listeners) cb(this)
  }

  async init() {
    if (!this.enabled) return
    const {
      data: { session },
    } = await supabase.auth.getSession()
    await this._setSession(session)

    supabase.auth.onAuthStateChange(async (_event, session) => {
      await this._setSession(session)
    })
  }

  async _setSession(session) {
    this.user = session?.user || null
    if (this.user) {
      await this._loadProfile()
    } else {
      this.profile = null
    }
    this._emit()
  }

  async _loadProfile() {
    const { data, error } = await supabase
      .from('profiles')
      .select('id, email, display_name, role')
      .eq('id', this.user.id)
      .single()
    // Row is created by a DB trigger on signup; tolerate a brief race.
    this.profile = error ? null : data
  }

  /** Magic-link email sign-in. */
  async signInWithEmail(email) {
    if (!this.enabled) throw new Error('Backend not configured')
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: location.href.split('#')[0] },
    })
    if (error) throw error
    return true
  }

  /** OAuth (e.g. 'google', 'github'). */
  async signInWithOAuth(provider) {
    if (!this.enabled) throw new Error('Backend not configured')
    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo: location.href.split('#')[0] },
    })
    if (error) throw error
  }

  async signOut() {
    if (!this.enabled) return
    await supabase.auth.signOut()
  }
}
