// @ts-check
// Replaces the live Sample Kitchen DRAFT menu with the current
// reference/sample-draft-menu.json. Defaults to a dry run.
//
//   node scripts/replace-draft-menu.js --project <id>          (dry run)
//   node scripts/replace-draft-menu.js --project <id> --yes    (writes)
//
// Refuses unless the live menu is an unapproved draft and the event is a draft.
// Items the organiser has already confirmed in the app go back to "needs
// manual review", because the content they confirmed has been replaced.
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { buildExampleDraft } from "../seed/example-event.js";
import { menuReplacementCheck } from "../seed/production.js";

if (
  process.env.FIRESTORE_EMULATOR_HOST ||
  process.env.FIREBASE_AUTH_EMULATOR_HOST
) {
  console.error("An emulator host is set. Unset it first.");
  process.exit(1);
}

const args = process.argv.slice(2);
const project = args[args.indexOf("--project") + 1];
const yes = args.includes("--yes");
if (
  args.indexOf("--project") === -1 ||
  !/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(project ?? "") ||
  project.startsWith("demo-")
) {
  console.error(
    "Usage: node scripts/replace-draft-menu.js --project <real-project-id> [--yes]",
  );
  process.exit(1);
}

const { menu, event } = buildExampleDraft();
const db = getFirestore(initializeApp({ projectId: project }));
const menuRef = db.doc(`menus/${menu.id}`);
const eventRef = db.doc(`events/${event.id}`);
const next = JSON.parse(JSON.stringify(menu));
const items = next.sections.flatMap(
  (/** @type {{ items: unknown[] }} */ s) => s.items,
);

console.log(`${yes ? "WRITING to" : "Dry run for"} project ${project}`);

const outcome = await db.runTransaction(async (tx) => {
  const [liveMenu, liveEvent] = await Promise.all([
    tx.get(menuRef),
    tx.get(eventRef),
  ]);
  const check = menuReplacementCheck(liveMenu.data(), liveEvent.data());
  if (check.ok && yes) tx.set(menuRef, next);
  return { check, liveItems: countItems(liveMenu.data()) };
});

/** @param {any} data */
function countItems(data) {
  return (data?.sections ?? []).flatMap((/** @type {any} */ s) => s.items)
    .length;
}

if (!outcome.check.ok) {
  for (const reason of outcome.check.reasons)
    console.error(`Refused: ${reason}`);
  process.exit(1);
}
console.log(
  `- replace ${menuRef.path}: ${outcome.liveItems} live items -> ${items.length} items, all needing manual review`,
);
if (outcome.check.confirmedItemsLost > 0)
  console.log(
    `  ${outcome.check.confirmedItemsLost} item(s) already confirmed in the app will go back to needing review`,
  );
console.log(
  yes ? "Menu replaced." : "\nNothing was written. Re-run with --yes to apply.",
);
