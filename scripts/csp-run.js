// Builds the production bundle (pointed at the Auth emulator) and runs the CSP
// checks against it through the Hosting emulator. Never touches a live project.
import { spawnSync } from "node:child_process";

const vite = new URL("../node_modules/vite/bin/vite.js", import.meta.url);
const toPath = (/** @type {URL} */ url) =>
  url.pathname.replace(/^\/([A-Za-z]:)/, "$1");

const build = spawnSync(
  process.execPath,
  [toPath(vite), "build", "--config", "web/vite.config.js"],
  {
    stdio: "inherit",
    env: { ...process.env, VITE_USE_AUTH_EMULATOR: "true" },
  },
);
if (build.status !== 0) process.exit(build.status ?? 1);

const run = spawnSync(
  process.execPath,
  [
    toPath(new URL("./emulator-run.js", import.meta.url)),
    "auth,firestore,functions,hosting",
    "npx",
    "playwright",
    "test",
    "-c",
    "playwright.csp.config.js",
  ],
  { stdio: "inherit" },
);
process.exit(run.status ?? 1);
