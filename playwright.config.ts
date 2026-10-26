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
    baseURL: "http://127.0.0.1:4173",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  projects: [
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
