import { defineConfig, devices } from '@playwright/test';

// Default Chromium resolution: PLAYWRIGHT_BROWSERS_PATH locally, `npx playwright install` on CI.

const BASE = 'http://localhost:4173/em-time/';
const SYNC_BASE = 'http://localhost:4174/em-time/';

const launchOptions = {
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
};

const supaUrl = process.env.VITE_SUPABASE_URL || 'https://qa-fake.example.test';
const supaKey = process.env.VITE_SUPABASE_ANON_KEY || 'qa-fake-anon-key';
// The e2e build (VITE_E2E=1, no Supabase env) is made BEFORE this run: `VITE_E2E=1 npm run build`.
// The webServers below never rebuild it. Only the QA-only second build (fake Supabase env, written to
// playwright-report/dist-sync, never the CI artifact) is produced here, because nothing else builds it.
const syncPreview = 'npx vite preview --config frontend/vite.config.ts --outDir ../playwright-report/dist-sync --port 4174';
const syncCommand = `VITE_E2E=1 VITE_SUPABASE_URL=${supaUrl} VITE_SUPABASE_ANON_KEY=${supaKey} npx vite build --config frontend/vite.config.ts --outDir ../playwright-report/dist-sync --emptyOutDir && ${syncPreview}`;

export default defineConfig({
  testDir: './tests/e2e',
  outputDir: './test-results',
  timeout: 60_000,
  expect: { timeout: 7_500 },
  fullyParallel: true,
  workers: process.env.CI ? 2 : 3,
  retries: 0,
  reporter: [['list'], ['json', { outputFile: 'test-results/results.json' }]],
  use: {
    baseURL: BASE,
    locale: 'en-US',
    timezoneId: 'America/Los_Angeles',
    colorScheme: 'light',
    trace: 'off',
    launchOptions,
  },
  // 1) the already-built dist/ (preview only, no rebuild), local-only, on 4173.
  // 2) a second build with fake Supabase env on 4174, used only to prove the Sync card appears.
  //    The fake host is never reachable; no spec signs in.
  webServer: [
    {
      command: 'npm run preview',
      url: BASE,
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
    },
    {
      command: syncCommand,
      url: SYNC_BASE,
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
    },
  ],
  projects: [
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 }, launchOptions },
    },
    {
      name: 'mobile',
      use: {
        ...devices['Pixel 7'],
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 2,
        isMobile: true,
        hasTouch: true,
        launchOptions,
      },
    },
  ],
});
