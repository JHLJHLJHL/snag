import {defineConfig} from '@playwright/test';

export default defineConfig({
  testDir: './scripts',
  testMatch: 'motion.spec.mjs',
  outputDir: '.test-artifacts/motion',
  fullyParallel: true,
  use: {baseURL: 'http://127.0.0.1:1432', viewport: {width: 1280, height: 820}},
  webServer: {
    command: 'npm run dev:web -- --port 1432',
    url: 'http://127.0.0.1:1432',
    reuseExistingServer: false,
  },
});
