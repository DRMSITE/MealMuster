// Runs a command inside the Firebase emulators (never a live project).
// Usage: node scripts/emulator-run.js <services> <command...>
import { spawnSync } from "node:child_process";
import { existsSync, rmSync, writeFileSync } from "node:fs";
import { DEV_SECRET } from "../seed/dev-secret.js";

const [services, ...command] = process.argv.slice(2);

// The Functions emulator reads secrets from this git-ignored file. A fresh
// checkout (CI) has none, so every link redemption would fail with "no value
// for MEALMUSTER_SECRET". Supply the emulator-only secret for this run, the same
// one the seed hashes its demo links with (a random one would make every seeded
// link invalid), and remove the file afterwards. A file that already exists is
// left alone.
const secretFile = new URL("../functions/.secret.local", import.meta.url);
const createdSecret = services.includes("functions") && !existsSync(secretFile);
if (createdSecret)
  writeFileSync(secretFile, `MEALMUSTER_SECRET=${DEV_SECRET}\n`);

const firebaseCli = new URL(
  "../node_modules/firebase-tools/lib/bin/firebase.js",
  import.meta.url,
);

/** @type {import("node:child_process").SpawnSyncReturns<Buffer>} */
let result;
try {
  result = spawnSync(
    process.execPath,
    [
      firebaseCli.pathname.replace(/^\/([A-Za-z]:)/, "$1"),
      "emulators:exec",
      "--only",
      services,
      "--project",
      "demo-mealmuster",
      command.join(" "),
    ],
    {
      stdio: "inherit",
      // REDEEM_LIMIT is raised for the emulator only, because every test redeems
      // links from one IP address; the production default stays at 10 per minute.
      env: { ...process.env, REDEEM_LIMIT: "1000" },
    },
  );
} finally {
  if (createdSecret) rmSync(secretFile, { force: true });
}
process.exit(result.status ?? 1);
