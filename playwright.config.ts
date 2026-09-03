import { defineConfig } from '@playwright/test';

// 開発サーバーは Playwright が起動する（既に 5173 で動いていればそれを使う）。vite.config.ts 側で strictPort にしてある
export default defineConfig({
  testDir: 'e2e',
  webServer: { command: 'npm run dev', port: 5173, reuseExistingServer: true },
  use: { baseURL: 'http://localhost:5173', viewport: { width: 1280, height: 800 } },
});
