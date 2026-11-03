// @ts-check
// One-off production setup: owner access, the Sample Kitchen draft, and an
// optional throwaway smoke-test event. Defaults to a dry run that only prints
// what it would write; nothing is written without --yes.
//
//   node scripts/prod-setup.js --project <id> --owner <email> --example-event
//   node scripts/prod-setup.js --project <id> --owner <email> --smoke
//   node scripts/prod-setup.js --project <id> --owner <email> --remove-smoke
//
// Needs Application Default Credentials for the real project:
//   gcloud auth application-default login
// The organiser's account must already exist (create it in the Firebase console).
import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { createFirestoreRepo } from "../functions/src/firestore-repo.js";
import {
  parseSetupArgs,
  planSetup,
  SMOKE_EVENT_ID,
  SMOKE_ORGANISATION_ID,
} from "../seed/production.js";

const USAGE =
  "Usage: node scripts/prod-setup.js --project <id> --owner <email> (--example-event | --smoke | --remove-smoke) [--yes]";

if (
  process.env.FIRESTORE_EMULATOR_HOST ||
  process.env.FIREBASE_AUTH_EMULATOR_HOST
) {
  console.error(
    "An emulator host is set, so this would write to the emulator, not production. Unset it first.",
  );
  process.exit(1);
}

const options = parseSetupArgs(process.argv.slice(2));
if (options.errors.length > 0) {
  for (const e of options.errors) console.error(e);
  console.error(USAGE);
  process.exit(1);
}

const app = initializeApp({ projectId: options.project });
const db = getFirestore(app);

/** @param {unknown} error */
const code = (error) => /** @type {any} */ (error)?.code;

let uid;
try {
  uid = (await getAuth(app).getUserByEmail(options.owner)).uid;
} catch (error) {
  console.error(
    code(error) === "auth/user-not-found"
      ? `No account for ${options.owner} in ${options.project}. Create it under Authentication > Users first.`
      : `Could not look up the account (${code(error) ?? "error"}). Check you are signed in with gcloud for this project.`,
  );
  process.exit(1);
}

console.log(
  `${options.yes ? "WRITING to" : "Dry run for"} project ${options.project}`,
);

if (options.removeSmoke) {
  console.log(
    `- remove ${SMOKE_EVENT_ID}: its links, replies, the event and owner access to ${SMOKE_ORGANISATION_ID}`,
  );
  if (options.yes) {
    await createFirestoreRepo(db).deleteEventPrivateData(SMOKE_EVENT_ID);
    await db.doc(`events/${SMOKE_EVENT_ID}`).delete();
    await db.doc(`memberships/${SMOKE_ORGANISATION_ID}_${uid}`).delete();
    console.log("Smoke test removed.");
  }
} else {
  for (const write of planSetup(options, uid, new Date())) {
    console.log(
      `- ${write.mode === "create" ? "create (never overwrites)" : "set"} ${write.path}: ${write.label}`,
    );
    if (!options.yes) continue;
    try {
      if (write.mode === "create") await db.doc(write.path).create(write.data);
      else await db.doc(write.path).set(write.data, { merge: true });
    } catch (error) {
      // 6 = ALREADY_EXISTS: leave an organiser's existing document alone.
      if (code(error) === 6) console.log("    already exists, left alone");
      else throw error;
    }
  }
}
if (!options.yes)
  console.log("\nNothing was written. Re-run with --yes to apply.");
