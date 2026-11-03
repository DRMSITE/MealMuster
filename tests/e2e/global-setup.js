import { writeFileSync } from "node:fs";
import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { seedDemo, seedOrganisers } from "../../seed/demo.js";
import { DEV_SECRET } from "../../seed/dev-secret.js";
import { seedExampleDraft } from "../../seed/example-event.js";

export default async function globalSetup() {
  if (
    !process.env.FIRESTORE_EMULATOR_HOST ||
    !process.env.FIREBASE_AUTH_EMULATOR_HOST
  ) {
    throw new Error(
      "Run via `npm run test:e2e` (firebase emulators:exec). Refusing to run without the emulator.",
    );
  }
  const app = initializeApp({ projectId: "demo-mealmuster" });
  const db = getFirestore(app);
  const tokens = await seedDemo(
    db,
    process.env.MEALMUSTER_SECRET ?? DEV_SECRET,
  );
  await seedOrganisers(db, getAuth(app));
  await seedExampleDraft(db);
  writeFileSync(
    new URL("./.tokens.json", import.meta.url),
    JSON.stringify(tokens),
  );
}
