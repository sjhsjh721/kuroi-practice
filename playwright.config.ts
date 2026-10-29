import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "tests",
  timeout: 180000,
  expect: { timeout: 15000 },
  workers: 1,
  reporter: [
    ["list"],
    ["json", { outputFile: "../artifacts/pwa-test-results.json" }],
  ],
  use: {
    actionTimeout: 15000,
    baseURL: process.env.PWA_BASE_URL || "http://127.0.0.1:4173/",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  projects: [
    ...(process.env.PWA_COMET_EXECUTABLE
      ? [
          {
            name: "comet-desktop",
            testMatch: "play-click.spec.ts",
            use: {
              viewport: { width: 1280, height: 900 },
              browserName: "chromium" as const,
              launchOptions: {
                executablePath: process.env.PWA_COMET_EXECUTABLE,
              },
            },
          },
        ]
      : []),
    {
      name: "webkit-ipad",
      use: { ...devices["iPad Pro 11"], browserName: "webkit" },
    },
    {
      name: "chromium-phone",
      use: { ...devices["Pixel 7"], browserName: "chromium" },
    },
    {
      name: "webkit-iphone",
      use: { ...devices["iPhone 13"], browserName: "webkit" },
    },
  ],
});
