// @ts-check
import { isMinorUnits, sumMinor } from "./money.js";

/**
 * @typedef {import("./types.js").Menu} Menu
 * @typedef {import("./types.js").EventConfig} EventConfig
 * @typedef {import("./types.js").BookingInput} BookingInput
 * @typedef {import("./errors.js").ValidationIssue} ValidationIssue
 */

export const MAX_QUANTITY = 20;
export const MAX_NAME = 80;
export const MAX_NOTE = 300;
export const MAX_DINERS = 30;

/**
 * Whether the event accepts changes right now (server-side check).
 * @param {EventConfig} event @param {Menu | undefined} menu @param {Date} now
 * @param {{ organiserOverride?: boolean }} [opts]
 * @returns {{ open: boolean, reason?: string }}
 */
export function orderingGate(event, menu, now, opts = {}) {
  if (event.status !== "open") return { open: false, reason: "event_not_open" };
  if (event.orderingMode !== "rsvp_only" && menu?.status !== "approved")
    return { open: false, reason: "menu_not_approved" };
  const deadline = event.orderDeadline ?? event.rsvpDeadline;
  if (!deadline) return { open: false, reason: "deadline_not_set" };
  if (!opts.organiserOverride && now.getTime() > Date.parse(deadline))
    return { open: false, reason: "deadline_passed" };
  return { open: true };
}

/**
 * @param {Menu | undefined} menu
 */
function indexMenu(menu) {
  /** @type {Map<string, import("./types.js").MenuItem & { sectionId: string }>} */
  const items = new Map();
  /** @type {Map<string, import("./types.js").MenuSection>} */
  const sections = new Map();
  for (const s of menu?.sections ?? []) {
    sections.set(s.id, s);
    for (const i of s.items) items.set(i.id, { ...i, sectionId: s.id });
  }
  return { items, sections };
}

/**
 * Validates a booking against the event and approved menu. Client prices are
 * never read; totals are always computed from the menu.
 * @param {BookingInput} booking @param {EventConfig} event @param {Menu | undefined} menu
 * @returns {ValidationIssue[]}
 */
export function validateBooking(booking, event, menu) {
  /** @type {ValidationIssue[]} */
  const issues = [];
  const fail = (
    /** @type {string} */ path,
    /** @type {string} */ code,
    /** @type {string} */ message,
  ) => issues.push({ path, code, message });

  if (!["yes", "no", "undecided"].includes(booking.attendance))
    fail(
      "attendance",
      "invalid_attendance",
      "Choose attending or not attending",
    );
  if (!booking.contactName?.trim() || booking.contactName.length > MAX_NAME)
    fail("contactName", "invalid_name", "Enter your name");

  // A decline records a response only; no food details are requested or stored.
  if (booking.attendance !== "yes") {
    if (booking.diners?.length)
      fail(
        "diners",
        "diners_not_allowed",
        "Diners can only be added when attending",
      );
    return issues;
  }

  const diners = booking.diners ?? [];
  if (diners.length === 0)
    fail("diners", "no_diners", "Add at least one diner");
  if (diners.length > MAX_DINERS)
    fail("diners", "too_many_diners", "Too many diners");
  const contacts = diners.filter((d) => d.isContact).length;
  if (contacts > 1)
    fail(
      "diners",
      "multiple_contacts",
      "Only one diner can be the booking contact",
    );
  if (contacts === 0 && !event.allowContactNotAttending)
    fail(
      "diners",
      "contact_must_attend",
      "The booking contact must be one of the diners",
    );
  if (event.guestLimit !== undefined) {
    const guests = diners.filter((d) => !d.isContact).length;
    if (guests > event.guestLimit)
      fail(
        "diners",
        "guest_limit",
        `At most ${event.guestLimit} guest(s) are allowed`,
      );
  }

  const { items, sections } = indexMenu(menu);

  diners.forEach((diner, di) => {
    const dp = `diners[${di}]`;
    if (!diner.name?.trim() || diner.name.length > MAX_NAME)
      fail(`${dp}.name`, "invalid_name", "Every diner needs a name");
    if (diner.dietaryNotes && diner.dietaryNotes.length > MAX_NOTE)
      fail(`${dp}.dietaryNotes`, "note_too_long", "Dietary note is too long");

    if (event.orderingMode === "rsvp_only") {
      if (diner.selections?.length)
        fail(
          `${dp}.selections`,
          "selections_not_allowed",
          "This event does not take meal choices",
        );
      return;
    }
    for (const [si, sel] of (diner.selections ?? []).entries()) {
      const sp = `${dp}.selections[${si}]`;
      const item = items.get(sel.menuItemId);
      if (!item) {
        fail(
          `${sp}.menuItemId`,
          "unknown_item",
          "That dish is not on the menu",
        );
        continue;
      }
      if (!item.available)
        fail(
          `${sp}.menuItemId`,
          "item_unavailable",
          `${item.name} is not available`,
        );
      if (
        !Number.isInteger(sel.quantity) ||
        sel.quantity < 1 ||
        sel.quantity > MAX_QUANTITY
      )
        fail(
          `${sp}.quantity`,
          "invalid_quantity",
          `Quantity must be 1 to ${MAX_QUANTITY}`,
        );
      if (sel.notes && sel.notes.length > MAX_NOTE)
        fail(`${sp}.notes`, "note_too_long", "Note is too long");
      const chosen = sel.optionIds ?? [];
      for (const group of item.optionGroups ?? []) {
        const n = group.choices.filter((c) => chosen.includes(c.id)).length;
        if (n < group.min || n > group.max)
          fail(
            `${sp}.optionIds`,
            "option_count",
            `Choose ${group.min} to ${group.max} for ${group.title}`,
          );
      }
      const valid = new Set(
        (item.optionGroups ?? []).flatMap((g) => g.choices.map((c) => c.id)),
      );
      if (chosen.some((id) => !valid.has(id)))
        fail(`${sp}.optionIds`, "unknown_option", "Unknown option");
    }

    for (const [ri, rule] of event.rules.entries()) {
      if (!rule.perDiner) continue;
      const count = (diner.selections ?? [])
        .filter(
          (s) =>
            !rule.sectionId ||
            items.get(s.menuItemId)?.sectionId === rule.sectionId,
        )
        .reduce(
          (n, s) => n + (Number.isInteger(s.quantity) ? s.quantity : 0),
          0,
        );
      const label = rule.sectionId
        ? (sections.get(rule.sectionId)?.name ?? "this section")
        : "the menu";
      if ((rule.required || count > 0) && count < rule.minSelections)
        fail(
          `${dp}.rules[${ri}]`,
          "rule_min",
          `Choose at least ${rule.minSelections} from ${label}`,
        );
      if (count > rule.maxSelections)
        fail(
          `${dp}.rules[${ri}]`,
          "rule_max",
          `Choose at most ${rule.maxSelections} from ${label}`,
        );
    }
  });
  return issues;
}

/**
 * Computes a diner's total from the menu only (never client values).
 * @param {import("./types.js").Diner} diner @param {EventConfig} event @param {Menu} menu
 */
export function dinerTotalMinor(diner, event, menu) {
  if (event.fixedPricePerPersonMinor !== undefined)
    return event.fixedPricePerPersonMinor;
  const { items } = indexMenu(menu);
  return sumMinor(
    diner.selections.map((sel) => {
      const item = items.get(sel.menuItemId);
      if (!item || !isMinorUnits(item.priceMinor)) return 0;
      const mods = (item.optionGroups ?? [])
        .flatMap((g) => g.choices)
        .filter((c) => sel.optionIds?.includes(c.id))
        .reduce((t, c) => t + (c.priceModifierMinor ?? 0), 0);
      return (item.priceMinor + mods) * sel.quantity;
    }),
  );
}

/**
 * Snapshots names and prices at submission so later menu edits cannot rewrite orders.
 * @param {BookingInput} booking @param {Menu} menu
 */
export function snapshotSelections(booking, menu) {
  const { items, sections } = indexMenu(menu);
  return booking.diners.map((d) => ({
    ...d,
    selections: d.selections.map((sel) => {
      const item = items.get(sel.menuItemId);
      return {
        ...sel,
        nameSnapshot: item?.name,
        sectionSnapshot: item ? sections.get(item.sectionId)?.name : undefined,
        unitPriceSnapshotMinor: item?.priceMinor,
      };
    }),
  }));
}
