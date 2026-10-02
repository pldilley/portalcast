import { defineConfig } from 'vite'
import { resolve } from 'node:path'

// `base` must match the path the site is actually served from.
// It is a GitHub *project* page, served from /<repo>/ — the user page
// (<username>.github.io) is taken. See plan §4. When a domain arrives
// (plan §15), this becomes '/'.
export default defineConfig({
  base: '/portalcast/',
  appType: 'mpa',
  build: {
    target: 'es2017', // TV browsers can be old — plan §4
    rollupOptions: {
      input: {
        source: resolve(__dirname, 'index.html'),
        tv: resolve(__dirname, 'tv/index.html'),
        pair: resolve(__dirname, 'pair/index.html'),
        check: resolve(__dirname, 'check/index.html'),
      },
    },
  },
})
