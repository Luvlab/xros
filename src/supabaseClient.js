import { createClient } from '@supabase/supabase-js'

/**
 * Supabase client — created only when env vars are present. The whole app is
 * designed to run WITHOUT a backend (Phase 1: search + theming + local
 * bookmarks). When these are set, accounts/roles/ads/app-store light up.
 *
 * Set in a .env file (see .env.example):
 *   VITE_SUPABASE_URL=...
 *   VITE_SUPABASE_ANON_KEY=...
 */
const url = import.meta.env.VITE_SUPABASE_URL
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY

export const isBackendConfigured = Boolean(url && anon)

export const supabase = isBackendConfigured
  ? createClient(url, anon, {
      auth: { persistSession: true, autoRefreshToken: true },
    })
  : null
