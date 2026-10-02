import { defineConfig } from 'vite'
import { resolve } from 'node:path'

// `base` must match the path the site is actually served from.
// A GitHub *user* page (<username>.github.io) serves from root, so '/' is correct.
// A *project* page would need '/<repo>/' — see plan §4 for why we avoid that.
export default defineConfig({
  base: '/',
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
