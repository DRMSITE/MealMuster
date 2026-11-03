// @ts-check
/** @typedef {import("./types.js").EventConfig} EventConfig */

const DAY_MS = 86_400_000;

/**
 * When an event's personal data should be deleted: the event start plus the
 * configured retention window. Null until both are set, so nothing is ever
 * scheduled for deletion on an assumed date.
 * @param {EventConfig} event
 */
export function retentionDeleteAfter(event) {
  const start = event.startAt ? Date.parse(event.startAt) : Number.NaN;
  const days = event.retentionDays;
  if (Number.isNaN(start) || !Number.isInteger(days) || (days ?? 0) < 1)
    return null;
  return new Date(start + /** @type {number} */ (days) * DAY_MS).toISOString();
}

/** Only closed events are purged automatically. @param {EventConfig} event @param {Date} now */
export function retentionDue(event, now) {
  const after = retentionDeleteAfter(event);
  return (
    event.status === "closed" &&
    after !== null &&
    Date.parse(after) <= now.getTime()
  );
}
