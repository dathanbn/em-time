import { fileURLToPath } from 'node:url';
import preact from '@preact/preset-vite';
import { defineConfig } from 'vite';
import { readFileSync } from 'node:fs';
import { VitePWA } from 'vite-plugin-pwa';

const frontendDir = fileURLToPath(new URL('.', import.meta.url));
const repoRoot = fileURLToPath(new URL('..', import.meta.url));

// BASE_PATH is set by CI to /<repo-name>/. An empty value falls back to the default.
const base = process.env.BASE_PATH || '/em-time/';
const version = (
  JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }
).version;

export default defineConfig({
  root: frontendDir,
  base,
  // .env.local lives at the repo root, next to .env.example
  envDir: repoRoot,
  publicDir: 'public',
  define: { __APP_VERSION__: JSON.stringify(version) },
  resolve: {
    alias: {
      '@core': fileURLToPath(new URL('./src/core', import.meta.url)),
    },
  },
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    target: 'es2022',
    sourcemap: false,
    rollupOptions: {
      output: {
        // The sync engine and supabase-js are lazy chunks. A `sync-` prefix lets the service worker
        // leave them out of the precache (SYNC-2) and cache them on first use instead.
        chunkFileNames: (chunk: { moduleIds?: string[] }) =>
          chunk.moduleIds?.some((id) => id.includes('/core/sync/engine') || id.includes('/@supabase/'))
            ? 'assets/sync-[name]-[hash].js'
            : 'assets/[name]-[hash].js',
      },
    },
  },
  server: { host: true, port: 5173 },
  plugins: [
    preact(),
    VitePWA({
      registerType: 'prompt',
      injectRegister: false,
      includeAssets: ['favicon.ico', 'favicon.svg', 'icon.svg', 'apple-touch-icon-180x180.png'],
      manifest: {
        name: 'Em Time',
        short_name: 'Em Time',
        description: 'A calm focus timer.',
        start_url: './#/timer',
        scope: './',
        display: 'standalone',
        orientation: 'any',
        background_color: '#F4F9FE',
        theme_color: '#F4F9FE',
        icons: [
          { src: 'pwa-64x64.png', sizes: '64x64', type: 'image/png', purpose: 'any' },
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'maskable-icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
        navigateFallback: 'index.html',
        // notificationclick handler: focuses the app when a phase-end notification is tapped
        importScripts: ['sw-notify.js'],
        globIgnores: ['**/assets/sync-*.js'],
        runtimeCaching: [
          {
            urlPattern: ({ url }) => /\/assets\/sync-[^/]+\.js$/.test(url.pathname),
            handler: 'CacheFirst',
            options: { cacheName: 'em-time-sync', expiration: { maxEntries: 6 } },
          },
        ],
        cleanupOutdatedCaches: true,
      },
      devOptions: { enabled: false },
    }),
  ],
});
