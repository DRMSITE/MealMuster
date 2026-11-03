// @ts-check
/**
 * Organiser overview and export builders. Pure functions: every export is
 * derived from one `buildSummary` result, so the per-diner and aggregate views
 * reconcile by construction.
 *
 * Privacy: dietary notes appear only in the restaurant-facing outputs
 * (`summary` and `restaurantCsv`), never in the attendance CSV or counts.
 */
import { toCsv } from "./csv.js";
import { dinerTotalMinor } from "./ordering.js";

/**
 * @typedef {import("./types.js").EventConfig} EventConfig
 * @typedef {import("./types.js").Menu} Menu
 * @typedef {{ id: string, eventId: string, displayName?: string, status: string, revokedAt?: string | null }} InvitationLike
 * @typedef {{ invitationId: string, attendance: string, contactName: string, diners: any[], status: string, confirmationId?: string }} BookingLike
 * @typedef {{ section: string, name: string, options: string, quantity: number, notes?: string }} SummaryItem
 * @typedef {{ name: string, items: SummaryItem[], dietaryNotes?: string }} SummaryDiner
 * @typedef {{ confirmationId: string, contactName: string, diners: SummaryDiner[] }} SummaryBooking
 */

/** @param {BookingLike[]} bookings */
const attendingSubmitted = (bookings) =>
  bookings.filter((b) => b.status === "submitted" && b.attendance === "yes");

/**
 * Headline numbers. "Bookings" are replies; "diners" are people eating.
 * @param {InvitationLike[]} invitations @param {BookingLike[]} bookings
 */
export function eventCounts(invitations, bookings) {
  const active = invitations.filter((i) => !i.revokedAt);
  const byInvitation = new Map(bookings.map((b) => [b.invitationId, b]));
  const submitted = active
    .map((i) => byInvitation.get(i.id))
    .filter((b) => b?.status === "submitted");
  const attending = submitted.filter((b) => b?.attendance === "yes");
  return {
    invitations: active.length,
    revoked: invitations.length - active.length,
    awaitingReply: active.filter((i) => !byInvitation.has(i.id)).length,
    inProgress: active.filter((i) => byInvitation.get(i.id)?.status === "draft")
      .length,
    attendingBookings: attending.length,
    attendingDiners: attending.reduce((n, b) => n + (b?.diners.length ?? 0), 0),
    declined: submitted.filter((b) => b?.attendance === "no").length,
  };
}

/** @param {Menu | undefined} menu @param {any} selection */
function optionText(menu, selection) {
  const ids = selection.optionIds ?? [];
  if (ids.length === 0) return "";
  const titles = new Map(
    (menu?.sections ?? [])
      .flatMap((s) => s.items)
      .flatMap((i) => i.optionGroups ?? [])
      .flatMap((g) => g.choices)
      .map((c) => [c.id, c.title]),
  );
  return ids.map((/** @type {string} */ id) => titles.get(id) ?? id).join("; ");
}

/**
 * Restaurant-facing summary of submitted, attending bookings, grouped by
 * booking/diner and by menu item. Names come from the submission snapshot.
 * @param {EventConfig} event @param {Menu | undefined} menu @param {BookingLike[]} bookings
 */
export function buildSummary(event, menu, bookings) {
  const rows = attendingSubmitted(bookings).toSorted((a, b) =>
    (a.confirmationId ?? "").localeCompare(b.confirmationId ?? ""),
  );
  /** @type {SummaryBooking[]} */
  const byBooking = rows.map((b) => ({
    confirmationId: b.confirmationId ?? "",
    contactName: b.contactName,
    diners: b.diners.map((d) => ({
      name: d.name,
      dietaryNotes: d.dietaryNotes,
      items: (d.selections ?? []).map((/** @type {any} */ s) => ({
        section: s.sectionSnapshot ?? "",
        name: s.nameSnapshot ?? s.menuItemId,
        options: optionText(menu, s),
        quantity: s.quantity,
        notes: s.notes,
      })),
    })),
  }));

  /** @type {Map<string, SummaryItem>} */
  const totals = new Map();
  for (const item of byBooking.flatMap((b) =>
    b.diners.flatMap((d) => d.items),
  )) {
    const key = JSON.stringify([item.section, item.name, item.options]);
    const entry = totals.get(key);
    if (entry) entry.quantity += item.quantity;
    else
      totals.set(key, {
        section: item.section,
        name: item.name,
        options: item.options,
        quantity: item.quantity,
      });
  }
  const byItem = [...totals.values()].toSorted(
    (a, b) =>
      a.section.localeCompare(b.section) || a.name.localeCompare(b.name),
  );

  const dinerCount = byBooking.reduce((n, b) => n + b.diners.length, 0);
  const priced = menu && (event.showPrices || event.fixedPricePerPersonMinor);
  return {
    bookings: byBooking,
    byItem,
    totals: {
      bookings: byBooking.length,
      diners: dinerCount,
      items: byItem.reduce((n, i) => n + i.quantity, 0),
      ...(priced
        ? {
            estimatedTotalMinor: rows
              .flatMap((b) => b.diners)
              .reduce((t, d) => t + dinerTotalMinor(d, event, menu), 0),
          }
        : {}),
    },
  };
}

/**
 * Who replied and how. Contains names but no dietary notes or order contents.
 * @param {InvitationLike[]} invitations @param {BookingLike[]} bookings
 */
export function attendanceCsv(invitations, bookings) {
  const byInvitation = new Map(bookings.map((b) => [b.invitationId, b]));
  /** @param {InvitationLike} i */
  const reply = (i) => {
    if (i.revokedAt) return "Link revoked";
    const b = byInvitation.get(i.id);
    if (!b) return "No reply yet";
    if (b.status === "draft") return "In progress";
    return b.attendance === "yes" ? "Attending" : "Not attending";
  };
  return toCsv([
    [
      "Invitation",
      "Reply",
      "Confirmation",
      "Contact name",
      "Diners attending",
      "Diner names",
    ],
    ...invitations.map((i) => {
      const b = byInvitation.get(i.id);
      const attending = b?.status === "submitted" && b.attendance === "yes";
      return [
        i.displayName ?? i.id,
        reply(i),
        b?.confirmationId ?? "",
        b?.contactName ?? "",
        attending ? b.diners.length : 0,
        attending ? b.diners.map((d) => d.name).join("; ") : "",
      ];
    }),
  ]);
}

/** One row per ordered item per diner. Includes dietary notes: restaurant-facing only. @param {ReturnType<typeof buildSummary>} summary */
export function restaurantCsv(summary) {
  /** @type {unknown[][]} */
  const rows = [
    [
      "Confirmation",
      "Booking contact",
      "Diner",
      "Course or section",
      "Item",
      "Options",
      "Quantity",
      "Item notes",
      "Dietary requests (confirm allergies with the venue)",
    ],
  ];
  for (const b of summary.bookings) {
    for (const d of b.diners) {
      const items = d.items.length > 0 ? d.items : [null];
      items.forEach((item, index) => {
        rows.push([
          b.confirmationId,
          b.contactName,
          d.name,
          item?.section ?? "",
          item?.name ?? "",
          item?.options ?? "",
          item?.quantity ?? "",
          item?.notes ?? "",
          index === 0 ? (d.dietaryNotes ?? "") : "",
        ]);
      });
    }
  }
  return toCsv(rows);
}

/** Item totals for the kitchen or the venue's order sheet. @param {ReturnType<typeof buildSummary>} summary */
export function aggregateCsv(summary) {
  return toCsv([
    ["Course or section", "Item", "Options", "Quantity"],
    ...summary.byItem.map((i) => [i.section, i.name, i.options, i.quantity]),
  ]);
}
