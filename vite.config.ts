import { defineConfig, type Plugin } from 'vite'
import { resolve } from 'node:path'
import { execSync } from 'node:child_process'

/**
 * The build's identity: short commit hash plus UTC build time, e.g.
 * "43988cd · 2026-10-03 15:20 UTC". Shown on /check so you can tell a fresh
 * deploy from a cached copy. GITHUB_SHA is set in Actions; locally we ask git.
 */
function buildId(): string {
  let sha = (process.env.GITHUB_SHA ?? '').slice(0, 7)
  if (!sha) {
    try {
      sha = execSync('git rev-parse --short=7 HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
    } catch {
      sha = 'unknown'
    }
  }
  const time = new Date().toISOString().slice(0, 16).replace('T', ' ')
  return `${sha} · ${time} UTC`
}

/** Replaces __CHECK_BUILD__ in every HTML page, including inline scripts Vite does not otherwise touch. */
function stampBuild(): Plugin {
  const id = buildId()
  return {
    name: 'portalcast-stamp-build',
    transformIndexHtml: (html) => html.split('__CHECK_BUILD__').join(id),
  }
}

// `base` must match the path the site is actually served from.
// It is a GitHub *project* page, served from /<repo>/ — the user page
// (<username>.github.io) is taken. See plan §4. When a domain arrives
// (plan §15), this becomes '/'.
export default defineConfig({
  base: '/portalcast/',
  appType: 'mpa',
  plugins: [stampBuild()],
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
