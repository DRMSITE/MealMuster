// Runs a command inside the Firebase emulators (never a live project).
// Usage: node scripts/emulator-run.js <services> <command...>
import { spawnSync } from "node:child_process";
import { existsSync, rmSync, writeFileSync } from "node:fs";
import { DEV_SECRET } from "../seed/dev-secret.js";

const [services, ...command] = process.argv.slice(2);

// The Functions emulator reads its secret and parameters from git-ignored files,
// which a fresh checkout (CI, a new contributor) does not have:
// - without .secret.local every link redemption fails ("no value for
//   MEALMUSTER_SECRET"). The emulator-only secret is the one the seed hashes its
//   demo links with, so a random one would make every seeded link invalid.
// - without .env.local the function allows only localhost:5000, so the Origin
//   check rejects every request from the tests' pages on localhost:5173.
// Supply them for this run and remove what we created afterwards. A file that
// already exists is left alone.
/** @type {[URL, string][]} */
const localFiles = services.includes("functions")
  ? [
      [
        new URL("../functions/.secret.local", import.meta.url),
        `MEALMUSTER_SECRET=${DEV_SECRET}\n`,
      ],
      [
        new URL("../functions/.env.local", import.meta.url),
        [
          "ALLOWED_ORIGINS=http://localhost:5173,http://127.0.0.1:5173,http://localhost:5000,http://127.0.0.1:5000",
          "REDEEM_LIMIT=10",
          "",
        ].join("\n"),
      ],
    ]
  : [];
const created = localFiles.filter(([file]) => !existsSync(file));
for (const [file, content] of created) writeFileSync(file, content);

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
  for (const [file] of created) rmSync(file, { force: true });
}
process.exit(result.status ?? 1);
