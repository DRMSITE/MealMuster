// Seeds demo data into the *emulator* and prints one-off demo links.
// Refuses to run unless the Firestore emulator host is configured.
import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import {
  DEMO_ORGANISERS,
  DEMO_PASSWORD,
  seedDemo,
  seedOrganisers,
} from "./demo.js";
import { DEV_SECRET } from "./dev-secret.js";
import { seedExampleDraft } from "./example-event.js";

if (
  !process.env.FIRESTORE_EMULATOR_HOST ||
  !process.env.FIREBASE_AUTH_EMULATOR_HOST
) {
  console.error(
    "FIRESTORE_EMULATOR_HOST or FIREBASE_AUTH_EMULATOR_HOST is not set. Start the emulators first; this script never touches a live project.",
  );
  process.exit(1);
}

const secret = process.env.MEALMUSTER_SECRET ?? DEV_SECRET;
const app = initializeApp({ projectId: "demo-mealmuster" });
const db = getFirestore(app);
const tokens = await seedDemo(db, secret);
for (const [name, token] of Object.entries(tokens))
  console.log(`${name}: http://localhost:5173/i#${token}`);
await seedOrganisers(db, getAuth(app));
await seedExampleDraft(db);
console.log("Sample Kitchen draft seeded (unapproved, no invitations).");
for (const o of DEMO_ORGANISERS)
  console.log(
    `organiser ${o.email} (${o.role}, ${o.organisationId}): password ${DEMO_PASSWORD}`,
  );
