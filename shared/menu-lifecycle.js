// @ts-check
/** @typedef {import("./types.js").Menu} Menu @typedef {import("./types.js").EventConfig} EventConfig */

/** @param {Menu} menu */
export function unverifiedItems(menu) {
  return menu.sections
    .flatMap((s) => s.items)
    .filter((i) => i.verification === "needs-manual-review");
}

/**
 * Approval is explicit and refused while any item is still flagged
 * `needs-manual-review`; the organiser must verify each item against the venue.
 * @param {Menu} menu
 * @param {{ approvedBy: string, now: Date }} actor
 * @returns {Menu}
 */
export function approveMenu(menu, actor) {
  if (menu.status !== "draft")
    throw new Error(
      `Only a draft menu can be approved (status: ${menu.status})`,
    );
  const pending = unverifiedItems(menu);
  if (pending.length > 0)
    throw new Error(
      `${pending.length} item(s) still need manual review before approval`,
    );
  return {
    ...menu,
    status: "approved",
    approvedBy: actor.approvedBy,
    approvedAt: actor.now.toISOString(),
  };
}

/** @param {Menu} menu @returns {Menu} */
export function archiveMenu(menu) {
  if (menu.status === "archived") return menu;
  return { ...menu, status: "archived" };
}

/**
 * Reasons why invitations cannot be sent. Empty means they may be.
 * @param {EventConfig} event @param {Menu | undefined} menu
 * @returns {string[]}
 */
export function invitationBlockers(event, menu) {
  /** @type {string[]} */
  const reasons = [];
  if (event.orderingMode !== "rsvp_only") {
    if (!menu || menu.id !== event.menuId)
      reasons.push("No menu is assigned to the event");
    else if (menu.status !== "approved")
      reasons.push("The menu has not been approved");
  }
  if (!event.startAt) reasons.push("Event date and time is not set");
  if (!event.organiserContact) reasons.push("Organiser contact is not set");
  if (!event.rsvpDeadline) reasons.push("RSVP deadline is not set");
  if (event.orderingMode !== "rsvp_only" && !event.orderDeadline)
    reasons.push("Order deadline is not set");
  return reasons;
}

/** @param {EventConfig} event @param {Menu | undefined} menu */
export const canSendInvitations = (event, menu) =>
  invitationBlockers(event, menu).length === 0;

const MAX_ITEM_NAME = 200;

/**
 * Applies an organiser's review of a DRAFT menu: renaming, marking items as
 * not offered, and confirming (or un-confirming) each against the venue.
 * Nothing is ever deleted, so the original transcription stays traceable.
 * Returns the updated menu or a list of problems; the input is not mutated.
 *
 * @param {Menu} menu
 * @param {unknown} changes list of { id, name?, available?, verified? }
 * @returns {{ ok: true, menu: Menu, changed: number } | { ok: false, issues: string[] }}
 */
export function reviewMenu(menu, changes) {
  if (menu.status !== "draft")
    return { ok: false, issues: ["Only a draft menu can be reviewed."] };
  if (!Array.isArray(changes) || changes.length === 0)
    return { ok: false, issues: ["Provide at least one item to update."] };
  /** @type {string[]} */
  const issues = [];
  const byId = new Map(
    menu.sections.flatMap((s) => s.items).map((i) => [i.id, i]),
  );
  /** @type {Map<string, Record<string, any>>} */
  const wanted = new Map();
  for (const change of changes) {
    const c = /** @type {Record<string, any>} */ (change);
    if (typeof c?.id !== "string" || !byId.has(c.id)) {
      issues.push("An item in the request does not exist.");
      continue;
    }
    if (
      c.name !== undefined &&
      (typeof c.name !== "string" ||
        c.name.trim().length === 0 ||
        c.name.length > MAX_ITEM_NAME)
    )
      issues.push(`Item names must be 1 to ${MAX_ITEM_NAME} characters.`);
    if (c.available !== undefined && typeof c.available !== "boolean")
      issues.push("available must be true or false.");
    if (c.verified !== undefined && typeof c.verified !== "boolean")
      issues.push("verified must be true or false.");
    wanted.set(c.id, c);
  }
  if (issues.length > 0) return { ok: false, issues: [...new Set(issues)] };

  let changed = 0;
  const next = {
    ...menu,
    sections: menu.sections.map((section) => ({
      ...section,
      items: section.items.map((item) => {
        const c = wanted.get(item.id);
        if (!c) return item;
        changed += 1;
        return {
          ...item,
          ...(c.name === undefined ? {} : { name: c.name.trim() }),
          ...(c.available === undefined ? {} : { available: c.available }),
          ...(c.verified === undefined
            ? {}
            : {
                verification: c.verified ? "verified" : "needs-manual-review",
              }),
        };
      }),
    })),
  };
  return { ok: true, menu: next, changed };
}
