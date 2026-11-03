// @ts-check
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/** Invitation tokens: 256 bits of CSPRNG output, URL-safe. */
export function generateToken() {
  return randomBytes(32).toString("base64url");
}

/**
 * Keyed digest stored server-side instead of the raw token.
 * @param {string} token @param {string} secret
 */
export function hashToken(token, secret) {
  return createHmac("sha256", secret).update(`token:${token}`).digest("hex");
}

/** @param {string} a @param {string} b */
export function safeEqual(a, b) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** @param {string} body @param {string} secret */
const sign = (body, secret) =>
  createHmac("sha256", secret).update(`session:${body}`).digest("base64url");

/**
 * @typedef {{ inv: string, ev: string, exp: number, csrf: string }} SessionPayload
 */

/**
 * Creates a short-lived signed session value scoped to one invitation.
 * @param {{ invitationId: string, eventId: string }} scope
 * @param {string} secret @param {number} nowMs @param {number} ttlMs
 */
export function createSession(scope, secret, nowMs, ttlMs) {
  /** @type {SessionPayload} */
  const payload = {
    inv: scope.invitationId,
    ev: scope.eventId,
    exp: nowMs + ttlMs,
    csrf: randomBytes(16).toString("base64url"),
  };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return { value: `${body}.${sign(body, secret)}`, payload };
}

/**
 * @param {string | undefined} value @param {string} secret @param {number} nowMs
 * @returns {SessionPayload | null}
 */
export function verifySession(value, secret, nowMs) {
  if (!value) return null;
  const parts = value.split(".");
  const [body, sig] = parts;
  if (
    !body ||
    !sig ||
    parts.length !== 2 ||
    !safeEqual(sig, sign(body, secret))
  )
    return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (
      typeof payload.inv !== "string" ||
      typeof payload.ev !== "string" ||
      typeof payload.csrf !== "string"
    )
      return null;
    if (typeof payload.exp !== "number" || payload.exp <= nowMs) return null;
    return payload;
  } catch {
    return null;
  }
}

/** @param {string | undefined} header @param {string} name */
export function readCookie(header, name) {
  for (const part of (header ?? "").split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === name) return rest.join("=");
  }
  return undefined;
}

const MAX_TRACKED_KEYS = 20_000;
const SWEEP_THRESHOLD = 10_000;

/**
 * Fixed-window in-memory limiter. Per function instance only: a coarse brake
 * on abuse and cost, not a global guarantee (see docs/security.md).
 * @param {{ limit: number, windowMs: number }} opts
 */
export function createRateLimiter({ limit, windowMs }) {
  /** @type {Map<string, { count: number, resetAt: number }>} */
  const hits = new Map();
  let nextSweepAt = 0;
  return {
    /** Whether a key is still under its limit, without counting a hit. @param {string} key @param {number} nowMs */
    peek(key, nowMs) {
      const entry = hits.get(key);
      return !entry || entry.resetAt <= nowMs || entry.count < limit;
    },
    /** @param {string} key @param {number} nowMs */
    check(key, nowMs) {
      // Sweep expired entries at most every 10 seconds, so a flood of distinct
      // keys cannot make every request scan the whole map.
      if (hits.size > SWEEP_THRESHOLD && nowMs >= nextSweepAt) {
        for (const [k, v] of hits) if (v.resetAt <= nowMs) hits.delete(k);
        nextSweepAt = nowMs + 10_000;
      }
      const entry = hits.get(key);
      if (!entry || entry.resetAt <= nowMs) {
        hits.set(key, { count: 1, resetAt: nowMs + windowMs });
        // Hard cap: evict the oldest key (O(1)) so memory stays bounded.
        if (hits.size > MAX_TRACKED_KEYS) {
          const oldest = hits.keys().next().value;
          if (oldest !== undefined) hits.delete(oldest);
        }
        return { allowed: true, retryAfterSeconds: 0 };
      }
      entry.count++;
      return {
        allowed: entry.count <= limit,
        retryAfterSeconds: Math.ceil((entry.resetAt - nowMs) / 1000),
      };
    },
  };
}
