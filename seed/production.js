// @ts-check
// What the one-off production setup writes. Pure planning only: nothing here
// touches Firebase, so it can be tested and read before anything is run.
import { buildExampleDraft, EXAMPLE_ORGANISATION_ID } from "./example-event.js";

const DAY = 86_400_000;
export const SMOKE_ORGANISATION_ID = "smoke-test-org";
export const SMOKE_EVENT_ID = "smoke-test-event";

/**
 * @typedef {{ project: string, owner: string, exampleEvent: boolean, smoke: boolean, removeSmoke: boolean, yes: boolean, errors: string[] }} SetupOptions
 * @typedef {{ path: string, data: Record<string, unknown>, mode: "create" | "set", label: string }} PlannedWrite
 */

/** @param {string[]} argv @returns {SetupOptions} */
export function parseSetupArgs(argv) {
  /** @type {SetupOptions} */
  const options = {
    project: "",
    owner: "",
    exampleEvent: false,
    smoke: false,
    removeSmoke: false,
    yes: false,
    errors: [],
  };
  const args = [...argv];
  while (args.length > 0) {
    const arg = args.shift();
    if (arg === "--project") options.project = args.shift() ?? "";
    else if (arg === "--owner") options.owner = args.shift() ?? "";
    else if (arg === "--example-event") options.exampleEvent = true;
    else if (arg === "--smoke") options.smoke = true;
    else if (arg === "--remove-smoke") options.removeSmoke = true;
    else if (arg === "--yes") options.yes = true;
    else options.errors.push(`Unknown option: ${arg}`);
  }
  if (!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(options.project))
    options.errors.push("--project must be a Firebase project id");
  else if (options.project.startsWith("demo-"))
    options.errors.push("--project is a demo project: use the real project id");
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(options.owner))
    options.errors.push(
      "--owner must be the organiser's sign-in email address",
    );
  if (!options.exampleEvent && !options.smoke && !options.removeSmoke)
    options.errors.push(
      "Choose at least one of --example-event, --smoke, --remove-smoke",
    );
  if (options.smoke && options.removeSmoke)
    options.errors.push("Use --smoke or --remove-smoke, not both");
  return options;
}

/**
 * Whether the live draft menu may be replaced by the reference file. Only an
 * unapproved menu on a draft event qualifies: approval is final, and a menu
 * people have already booked against must never change underneath them.
 * @param {{ status?: string, approvedAt?: unknown, sections?: { items?: { verification?: string }[] }[] } | undefined} liveMenu
 * @param {{ status?: string } | undefined} liveEvent
 * @returns {{ ok: boolean, reasons: string[], confirmedItemsLost: number }}
 */
export function menuReplacementCheck(liveMenu, liveEvent) {
  /** @type {string[]} */
  const reasons = [];
  if (!liveMenu) reasons.push("The live menu does not exist");
  else {
    if (liveMenu.status !== "draft" || liveMenu.approvedAt)
      reasons.push("The live menu is approved or not a draft: it is final");
  }
  if (!liveEvent) reasons.push("The live event does not exist");
  else if (liveEvent.status !== "draft")
    reasons.push("The live event is not a draft");
  const confirmedItemsLost = (liveMenu?.sections ?? [])
    .flatMap((s) => s.items ?? [])
    .filter(
      (i) => i.verification && i.verification !== "needs-manual-review",
    ).length;
  return { ok: reasons.length === 0, reasons, confirmedItemsLost };
}

/**
 * The writes for an owner's uid. Event and menu documents use `create`, so an
 * organiser's later edits, checks or approval are never overwritten.
 * @param {SetupOptions} options @param {string} uid @param {Date} now
 * @returns {PlannedWrite[]}
 */
export function planSetup(options, uid, now) {
  /** @type {PlannedWrite[]} */
  const writes = [];
  /** @param {string} organisationId */
  const membership = (organisationId) =>
    writes.push({
      path: `memberships/${organisationId}_${uid}`,
      data: { userId: uid, organisationId, role: "owner" },
      mode: "set",
      label: `owner access to ${organisationId}`,
    });

  if (options.exampleEvent) {
    const { menu, event, venue } = buildExampleDraft();
    membership(EXAMPLE_ORGANISATION_ID);
    writes.push(
      {
        path: `venues/${event.venueId}`,
        data: venue,
        mode: "create",
        label: "venue",
      },
      {
        path: `menus/${menu.id}`,
        data: JSON.parse(JSON.stringify(menu)),
        mode: "create",
        label: "draft menu (unapproved)",
      },
      {
        path: `events/${event.id}`,
        data: JSON.parse(JSON.stringify(event)),
        mode: "create",
        label: "draft event (not open)",
      },
    );
  }

  if (options.smoke) {
    // A throwaway RSVP-only event in its own organisation, to prove the live
    // site end to end without touching the real event. Fictitious values only.
    membership(SMOKE_ORGANISATION_ID);
    writes.push({
      path: `events/${SMOKE_EVENT_ID}`,
      mode: "create",
      label: "smoke-test event (delete afterwards)",
      data: {
        id: SMOKE_EVENT_ID,
        organisationId: SMOKE_ORGANISATION_ID,
        title: "MealMuster smoke test (delete me)",
        description: "A test of the live site. Not a real event.",
        status: "open",
        orderingMode: "rsvp_only",
        currency: "GBP",
        timezone: "Europe/London",
        startAt: new Date(now.getTime() + 14 * DAY).toISOString(),
        rsvpDeadline: new Date(now.getTime() + 7 * DAY).toISOString(),
        organiserContact: "smoke-test@example.invalid",
        guestLimit: 2,
        retentionDays: 7,
        allowContactNotAttending: false,
        showPrices: false,
        rules: [],
      },
    });
  }
  return writes;
}
