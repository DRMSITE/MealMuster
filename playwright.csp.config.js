import { defineConfig, devices } from "@playwright/test";

// Runs against the production build (`vite preview`), proxied to the Functions
// emulator, with the headers shipped in firebase.json added to each page. See
// `npm run test:csp`.
export default defineConfig({
  testDir: "tests/csp",
  globalSetup: "./tests/e2e/global-setup.js",
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: { baseURL: "http://localhost:5173", trace: "retain-on-failure" },
  webServer: {
    command: "npx vite preview --config web/vite.config.js",
    url: "http://localhost:5173",
    reuseExistingServer: false,
    timeout: 60_000,
  },
  projects: [
    {
      name: "desktop",
      use: {
        ...devices["Desktop Chrome"],
        // Pages whose responses Playwright rewrites lose their loopback origin, so
        // Chrome's local-network check would block the call to the Auth emulator.
        // This affects the test browser only, not the policy under test.
        launchOptions: {
          args: [
            "--disable-features=LocalNetworkAccessChecks,PrivateNetworkAccessSendPreflights,BlockInsecurePrivateNetworkRequests",
          ],
        },
      },
    },
  ],
});
