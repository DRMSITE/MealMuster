// @ts-check
import { unverifiedItems } from "./menu-lifecycle.js";

/**
 * @typedef {import("./types.js").EventConfig} EventConfig
 * @typedef {import("./types.js").Menu} Menu
 * @typedef {{ id: string, label: string, done: boolean, required: boolean, detail?: string }} ReadinessItem
 */

/**
 * What an organiser still has to supply or confirm before the event can be
 * opened to invitees. Nothing here is guessed: unknown means "to do".
 * @param {EventConfig} event @param {Menu | undefined} menu
 * @returns {ReadinessItem[]}
 */
export function readinessChecklist(event, menu) {
  const needsMenu = event.orderingMode !== "rsvp_only";
  const items = menu?.sections.flatMap((s) => s.items) ?? [];
  const unchecked = menu ? unverifiedItems(menu).length : 0;
  /** @type {ReadinessItem[]} */
  const list = [
    {
      id: "startAt",
      label: "Event date and time",
      done: Boolean(event.startAt),
      required: true,
    },
    {
      id: "organiserContact",
      label: "Organiser contact",
      done: Boolean(event.organiserContact),
      required: true,
    },
    {
      id: "rsvpDeadline",
      label: "RSVP deadline",
      done: Boolean(event.rsvpDeadline),
      required: true,
    },
  ];
  if (needsMenu)
    list.push({
      id: "orderDeadline",
      label: "Order deadline",
      done: Boolean(event.orderDeadline),
      required: true,
    });
  list.push(
    {
      id: "guestLimit",
      label: "Guests allowed per booking",
      done: event.guestLimit !== undefined,
      required: false,
    },
    {
      id: "capacity",
      label: "Total places at the venue",
      done: event.capacity !== undefined,
      required: false,
    },
    {
      id: "retentionDays",
      label: "How long to keep personal data",
      done: event.retentionDays !== undefined,
      required: false,
    },
  );
  if (needsMenu) {
    list.push(
      {
        id: "menuChecked",
        label: "Every menu item checked against the venue's confirmation",
        done: Boolean(menu) && items.length > 0 && unchecked === 0,
        required: true,
        detail: menu
          ? `${unchecked} of ${items.length} items still need checking`
          : "No menu is assigned",
      },
      {
        id: "menuApproved",
        label: "Menu approved",
        done: menu?.status === "approved",
        required: true,
      },
    );
  }
  return list;
}
