// @ts-check
/**
 * Date helpers for organiser input. Times are typed in the *event's* timezone
 * (for example Europe/London), not the organiser's browser timezone, and are
 * stored as UTC ISO strings.
 */

/** @param {string} timeZone */
export function isValidTimeZone(timeZone) {
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone });
    return typeof timeZone === "string" && timeZone.length > 0;
  } catch {
    return false;
  }
}

/** @param {number} utcMs @param {string} timeZone @returns {Record<string, string>} */
function parts(utcMs, timeZone) {
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  return Object.fromEntries(
    formatter.formatToParts(new Date(utcMs)).map((p) => [p.type, p.value]),
  );
}

/** Offset of a timezone from UTC at an instant, in milliseconds. @param {number} utcMs @param {string} timeZone */
function offsetMs(utcMs, timeZone) {
  const p = parts(utcMs, timeZone);
  const asUtc = Date.UTC(
    Number(p.year),
    Number(p.month) - 1,
    Number(p.day),
    Number(p.hour),
    Number(p.minute),
    Number(p.second),
  );
  return asUtc - Math.floor(utcMs / 1000) * 1000;
}

/**
 * "2030-01-10T18:00" typed in a timezone -> UTC ISO string. Null when the text
 * is malformed or the time does not exist there (a clock-change gap).
 * @param {string} local @param {string} timeZone
 */
export function zonedLocalToIso(local, timeZone) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local);
  if (!m || !isValidTimeZone(timeZone)) return null;
  const [year, month, day, hour, minute] = m.slice(1).map(Number);
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  const first = guess - offsetMs(guess, timeZone);
  const instant = guess - offsetMs(first, timeZone);
  return isoToZonedLocal(new Date(instant).toISOString(), timeZone) === local
    ? new Date(instant).toISOString()
    : null;
}

/** UTC ISO string -> "YYYY-MM-DDTHH:mm" in the timezone (for datetime-local). @param {string} iso @param {string} timeZone */
export function isoToZonedLocal(iso, timeZone) {
  const time = Date.parse(iso);
  if (Number.isNaN(time)) return "";
  const p = parts(time, timeZone);
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}
