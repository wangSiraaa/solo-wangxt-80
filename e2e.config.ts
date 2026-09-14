import { defineConfig } from '@playwright/test';

// 无 root 环境下把本地解压的 Chromium 依赖库提供给浏览器
const extraLib = ['/tmp/chromelibs/usr/lib/aarch64-linux-gnu', '/tmp/chromelibs/lib/aarch64-linux-gnu']
  .filter(Boolean)
  .join(':');

export default defineConfig({
  testDir: './e2e',
  timeout: 30000,
  use: {
    baseURL: 'http://localhost:5173',
    headless: true,
    launchOptions: {
      args: ['--no-sandbox'],
      env: {
        ...process.env,
        LD_LIBRARY_PATH: `${extraLib}:${process.env.LD_LIBRARY_PATH ?? ''}`,
      },
    },
  },
  webServer: {
    command: 'npm run dev -- --port 5173',
    url: 'http://localhost:5173',
    reuseExistingServer: true,
    timeout: 30000,
  },
});
