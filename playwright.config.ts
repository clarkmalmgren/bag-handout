// playwright.config.ts
import { defineConfig } from '@playwright/test';

// Set PLAYWRIGHT_CHROMIUM_EXECUTABLE to use an already-installed Chromium instead of Playwright's own download.
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined;

export default defineConfig({
  testDir: 'e2e',
  timeout: 90_000,
  use: { baseURL: 'http://localhost:4173' },
  projects: [{ name: 'chromium', use: { browserName: 'chromium', launchOptions: { executablePath } } }],
  webServer: {
    command: 'npx vite --port 4173',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
