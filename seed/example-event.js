// @ts-check
// Example Social Club meal at Sample Kitchen: a fictitious worked example.
//
// Everything here is DRAFT and invented. The menu is a made-up sample, which is
// not evidence of any real dine-in or group menu or prices.
// The event has no date, deadlines, capacity, guest limit, contact or retention
// period because none has been confirmed; an organiser must supply them.
import { readFileSync } from "node:fs";
import { importToMenu } from "../shared/menu-import.js";

export const EXAMPLE_ORGANISATION_ID = "example-club";
export const EXAMPLE_EVENT_ID = "example-club-sample-kitchen";
export const EXAMPLE_MENU_ID = "sample-kitchen-draft-menu";

/** The reference transcription, exactly as supplied. */
export function loadExampleDraftDocument() {
  return JSON.parse(
    readFileSync(
      new URL("../reference/sample-draft-menu.json", import.meta.url),
      "utf8",
    ),
  );
}

/** Builds the draft menu and the draft event without writing anything. */
export function buildExampleDraft() {
  const menu = importToMenu(loadExampleDraftDocument(), {
    id: EXAMPLE_MENU_ID,
    organisationId: EXAMPLE_ORGANISATION_ID,
    title: "Sample Kitchen: draft takeaway transcription (unapproved)",
  });
  /** @type {import("../shared/types.js").EventConfig} */
  const event = {
    id: EXAMPLE_EVENT_ID,
    organisationId: EXAMPLE_ORGANISATION_ID,
    title: "Example Social Club meal at Sample Kitchen",
    status: "draft",
    orderingMode: "a_la_carte",
    currency: "GBP",
    menuId: menu.id,
    venueId: "sample-kitchen",
    timezone: "Europe/London",
    allowContactNotAttending: false,
    showPrices: false,
    rules: [],
  };
  const venue = {
    name: "Sample Kitchen",
    address: "1 Example Street, Exampletown, EX1 1AA",
  };
  return { menu, event, venue };
}

/**
 * Writes the draft to the emulator. No invitations are created.
 * @param {import("firebase-admin/firestore").Firestore} db
 */
export async function seedExampleDraft(db) {
  const { menu, event, venue } = buildExampleDraft();
  const clean = (/** @type {unknown} */ value) =>
    JSON.parse(JSON.stringify(value));
  await db
    .collection("venues")
    .doc(event.venueId ?? "")
    .set(venue);
  await db.collection("menus").doc(menu.id).set(clean(menu));
  await db.collection("events").doc(event.id).set(clean(event));
}
