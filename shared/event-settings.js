// @ts-check
import { isValidTimeZone } from "./datetime.js";
import { MAX_DINERS } from "./ordering.js";

/** @typedef {import("./types.js").EventConfig} EventConfig */

const TEXT_LIMITS = {
  title: 120,
  description: 1000,
  instructions: 1000,
  organiserContact: 200,
};
const DATE_FIELDS = ["startAt", "rsvpDeadline", "orderDeadline"];
const INTEGER_FIELDS = {
  guestLimit: [0, MAX_DINERS - 1],
  capacity: [1, 1000],
  retentionDays: [1, 3650],
};
const BOOLEAN_FIELDS = ["showPrices", "allowContactNotAttending"];

/** @param {string | undefined} value */
const at = (value) => (value ? Date.parse(value) : Number.NaN);

/**
 * Validates an organiser's edit of event settings. Only the listed fields can
 * change (status, menu and ordering mode have their own, guarded routes).
 * Optional dates and numbers cannot be cleared, only replaced.
 *
 * @param {unknown} input
 * @param {EventConfig} current
 * @param {Date} now
 * @returns {{ ok: true, changes: Partial<EventConfig> } | { ok: false, issues: { path: string, message: string }[] }}
 */
export function validateEventSettings(input, current, now) {
  /** @type {{ path: string, message: string }[]} */
  const issues = [];
  /** @type {Record<string, any>} */
  const changes = {};
  const body =
    typeof input === "object" && input !== null && !Array.isArray(input)
      ? /** @type {Record<string, any>} */ (input)
      : {};
  const known = new Set([
    ...Object.keys(TEXT_LIMITS),
    ...DATE_FIELDS,
    ...Object.keys(INTEGER_FIELDS),
    ...BOOLEAN_FIELDS,
    "timezone",
  ]);
  for (const key of Object.keys(body))
    if (!known.has(key))
      issues.push({ path: key, message: `${key} cannot be changed here.` });
  if (Object.keys(body).length === 0)
    issues.push({ path: "", message: "Provide at least one setting." });

  for (const [key, max] of Object.entries(TEXT_LIMITS)) {
    if (!(key in body)) continue;
    const value = body[key];
    if (typeof value !== "string" || value.trim().length > max)
      issues.push({ path: key, message: `Use up to ${max} characters.` });
    else if (key === "title" && value.trim().length === 0)
      issues.push({ path: key, message: "The title cannot be empty." });
    else changes[key] = value.trim();
  }
  if ("timezone" in body) {
    if (typeof body.timezone === "string" && isValidTimeZone(body.timezone))
      changes.timezone = body.timezone;
    else issues.push({ path: "timezone", message: "Choose a valid timezone." });
  }
  for (const key of DATE_FIELDS) {
    if (!(key in body)) continue;
    const time =
      typeof body[key] === "string" ? Date.parse(body[key]) : Number.NaN;
    if (Number.isNaN(time))
      issues.push({ path: key, message: "Enter a valid date and time." });
    else if (time <= now.getTime())
      issues.push({
        path: key,
        message: "Choose a date and time in the future.",
      });
    else changes[key] = new Date(time).toISOString();
  }
  for (const [key, [min, max]] of Object.entries(INTEGER_FIELDS)) {
    if (!(key in body)) continue;
    const value = body[key];
    if (!Number.isInteger(value) || value < min || value > max)
      issues.push({
        path: key,
        message: `Enter a whole number from ${min} to ${max}.`,
      });
    else changes[key] = value;
  }
  for (const key of BOOLEAN_FIELDS) {
    if (!(key in body)) continue;
    if (typeof body[key] === "boolean") changes[key] = body[key];
    else issues.push({ path: key, message: "Choose yes or no." });
  }

  // Relationships between dates are checked on the combined result.
  const next = { ...current, ...changes };
  const touched = (/** @type {string[]} */ ...keys) =>
    keys.some((k) => k in changes);
  if (
    at(next.rsvpDeadline) > at(next.startAt) &&
    touched("rsvpDeadline", "startAt")
  )
    issues.push({
      path: "rsvpDeadline",
      message: "The RSVP deadline must be before the event starts.",
    });
  if (
    at(next.orderDeadline) > at(next.startAt) &&
    touched("orderDeadline", "startAt")
  )
    issues.push({
      path: "orderDeadline",
      message: "The order deadline must be before the event starts.",
    });
  if (
    at(next.rsvpDeadline) > at(next.orderDeadline) &&
    touched("rsvpDeadline", "orderDeadline")
  )
    issues.push({
      path: "orderDeadline",
      message: "The order deadline cannot be before the RSVP deadline.",
    });

  return issues.length > 0
    ? { ok: false, issues }
    : { ok: true, changes: /** @type {Partial<EventConfig>} */ (changes) };
}
