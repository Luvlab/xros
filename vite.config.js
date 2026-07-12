import { defineConfig } from 'vite'
import { resolve } from 'path'

// Served at luvlab.io/xros in production, so built asset URLs are prefixed with
// /xros/. In dev we stay at the root ('/') for a clean localhost experience.
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/xros/' : '/',
  server: {
    host: true,
    port: 5173,
  },
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        advertiser: resolve(__dirname, 'advertiser.html'),
      },
    },
  },
}))
