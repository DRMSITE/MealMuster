// @ts-check
import { randomBytes } from "node:crypto";
import { createAdminHandler } from "./admin.js";
import { fail, ok } from "./http.js";
import {
  createRateLimiter,
  createSession,
  hashToken,
  readCookie,
  safeEqual,
  verifySession,
} from "./security.js";
import {
  dinerTotalMinor,
  orderingGate,
  snapshotSelections,
  validateBooking,
} from "./shared/ordering.js";

export const SESSION_COOKIE = "__session";
const BODY_LIMIT_BYTES = 64 * 1024;
/** Issues that are acceptable while a booking is still a draft. */
const DRAFT_TOLERATED = new Set(["rule_min", "no_diners"]);

/**
 * @typedef {import("./http.js").ApiRequest} ApiRequest
 * @typedef {import("./http.js").ApiResponse} ApiResponse
 * @typedef {Omit<ReturnType<typeof import("./memory-repo.js").createMemoryRepo>, "audit" | "bookings">} Repo
 * @typedef {{ secret: string, allowedOrigins: string[], now?: () => Date, sessionTtlMs?: number, secureCookies?: boolean, redeemLimit?: number, writeLimit?: number, adminRequestLimit?: number, adminFailureLimit?: number, verifyIdToken?: (token: string) => Promise<{ uid: string } | null> }} AppConfig
 */

function newConfirmationId() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no look-alikes
  const bytes = randomBytes(8);
  return `MM-${[...bytes].map((b) => alphabet[b % alphabet.length]).join("")}`;
}

/**
 * Creates the framework-free request handler used by the Cloud Function.
 * @param {Repo} repo @param {AppConfig} config
 * @returns {(req: ApiRequest) => Promise<ApiResponse>}
 */
export function createApp(repo, config) {
  const now = config.now ?? (() => new Date());
  const ttl = config.sessionTtlMs ?? 2 * 60 * 60 * 1000;
  const redeemLimiter = createRateLimiter({
    limit: config.redeemLimit ?? 10,
    windowMs: 60_000,
  });
  const writeLimiter = createRateLimiter({
    limit: config.writeLimit ?? 60,
    windowMs: 60_000,
  });

  /** @param {ApiRequest} req */
  const originOk = (req) => {
    const origin = req.headers.origin;
    return typeof origin === "string" && config.allowedOrigins.includes(origin);
  };

  /** @param {ApiRequest} req */
  async function authenticate(req) {
    const payload = verifySession(
      readCookie(req.headers.cookie, SESSION_COOKIE),
      config.secret,
      now().getTime(),
    );
    if (!payload) return null;
    const invitation = await repo.getInvitation(payload.inv);
    if (!invitation || invitation.eventId !== payload.ev) return null;
    if (invitation.revokedAt) return null;
    if (
      invitation.tokenExpiry &&
      Date.parse(invitation.tokenExpiry) <= now().getTime()
    )
      return null;
    return { payload, invitation };
  }

  /** @param {string} eventId */
  async function loadEventAndMenu(eventId) {
    const event = await repo.getEvent(eventId);
    if (!event) return { event: null, menu: undefined };
    const menu = event.menuId
      ? ((await repo.getMenu(event.menuId)) ?? undefined)
      : undefined;
    return { event, menu };
  }

  /** Hides prices when the organiser has chosen not to display them. */
  const publicMenu = (
    /** @type {any} */ menu,
    /** @type {boolean} */ showPrices,
  ) => ({
    id: menu.id,
    title: menu.title,
    currency: menu.currency,
    sections: menu.sections.map((/** @type {any} */ s) => ({
      id: s.id,
      name: s.name,
      order: s.order,
      sectionType: s.sectionType,
      items: s.items.map((/** @type {any} */ i) => ({
        id: i.id,
        name: i.name,
        description: i.description,
        tags: i.tags,
        available: i.available,
        sortOrder: i.sortOrder,
        optionGroups: i.optionGroups,
        ...(showPrices ? { priceMinor: i.priceMinor } : {}),
      })),
    })),
  });

  /** @param {any} booking */
  const publicBooking = (booking) =>
    booking && {
      attendance: booking.attendance,
      contactName: booking.contactName,
      partyNotes: booking.partyNotes,
      diners: booking.diners,
      status: booking.status,
      confirmationId: booking.confirmationId,
      submittedAt: booking.submittedAt,
      version: booking.version,
    };

  /** Only accepts the documented fields, discarding anything else (e.g. client-supplied prices). */
  const cleanBooking = (/** @type {any} */ body) => ({
    attendance: body?.attendance,
    contactName:
      typeof body?.contactName === "string" ? body.contactName.trim() : "",
    partyNotes:
      typeof body?.partyNotes === "string" ? body.partyNotes : undefined,
    diners: Array.isArray(body?.diners)
      ? body.diners.map((/** @type {any} */ d, /** @type {number} */ i) => ({
          id:
            typeof d?.id === "string" && /^[\w-]{1,40}$/.test(d.id)
              ? d.id
              : `d${i + 1}`,
          name: typeof d?.name === "string" ? d.name.trim() : "",
          isContact: d?.isContact === true,
          dietaryNotes:
            typeof d?.dietaryNotes === "string" && d.dietaryNotes.trim()
              ? d.dietaryNotes.trim()
              : undefined,
          selections: Array.isArray(d?.selections)
            ? d.selections.map((/** @type {any} */ s) => ({
                menuItemId: String(s?.menuItemId),
                quantity: s?.quantity,
                optionIds: Array.isArray(s?.optionIds)
                  ? s.optionIds.map(String)
                  : undefined,
                notes:
                  typeof s?.notes === "string" && s.notes.trim()
                    ? s.notes.trim()
                    : undefined,
              }))
            : [],
        }))
      : [],
  });

  /** @type {Record<string, (req: ApiRequest) => Promise<ApiResponse>>} */
  const routes = {
    async "POST /api/invitations/redeem"(req) {
      if (!originOk(req))
        return fail(403, "bad_origin", "Request origin not allowed");
      const limited = redeemLimiter.check(
        `redeem:${req.ip ?? "unknown"}`,
        now().getTime(),
      );
      if (!limited.allowed)
        return fail(
          429,
          "rate_limited",
          "Too many attempts. Try again shortly.",
          undefined,
          { "Retry-After": String(limited.retryAfterSeconds) },
        );
      const token = req.body?.token;
      if (typeof token !== "string" || token.length < 20 || token.length > 200)
        return fail(400, "bad_request", "Invalid link");
      const invitation = await repo.findInvitationByTokenHash(
        hashToken(token, config.secret),
      );
      // One generic answer for unknown, revoked and expired links, so nothing leaks.
      const invalid = fail(
        401,
        "invalid_link",
        "This link is not valid. Ask the organiser for a new one.",
      );
      if (!invitation || invitation.revokedAt) return invalid;
      if (
        invitation.tokenExpiry &&
        Date.parse(invitation.tokenExpiry) <= now().getTime()
      )
        return invalid;
      const { value } = createSession(
        { invitationId: invitation.id, eventId: invitation.eventId },
        config.secret,
        now().getTime(),
        ttl,
      );
      await repo.updateInvitation(invitation.id, {
        lastUsedAt: now().toISOString(),
        status: invitation.status === "issued" ? "opened" : invitation.status,
      });
      await repo.addAudit({
        actor: `invitation:${invitation.id}`,
        action: "invitation.redeemed",
        entity: "invitation",
        entityId: invitation.id,
        timestamp: now().toISOString(),
      });
      const cookie = [
        `${SESSION_COOKIE}=${value}`,
        "HttpOnly",
        "SameSite=Strict",
        "Path=/",
        `Max-Age=${Math.floor(ttl / 1000)}`,
        ...(config.secureCookies === false ? [] : ["Secure"]),
      ].join("; ");
      return { status: 204, headers: { "Set-Cookie": cookie } };
    },

    async "GET /api/session"(req) {
      const auth = await authenticate(req);
      if (!auth)
        return fail(
          401,
          "unauthenticated",
          "Please open your invitation link again.",
        );
      const { event, menu } = await loadEventAndMenu(auth.payload.ev);
      if (!event) return fail(404, "not_found", "Event not found");
      const venue = event.venueId ? await repo.getVenue(event.venueId) : null;
      const gate = orderingGate(event, menu, now());
      return ok({
        csrfToken: auth.payload.csrf,
        invitation: { displayName: auth.invitation.displayName },
        event: {
          id: event.id,
          title: event.title,
          description: event.description,
          startAt: event.startAt,
          timezone: event.timezone,
          rsvpDeadline: event.rsvpDeadline,
          orderDeadline: event.orderDeadline,
          instructions: event.instructions,
          organiserContact: event.organiserContact,
          orderingMode: event.orderingMode,
          currency: event.currency,
          guestLimit: event.guestLimit,
          allowContactNotAttending: event.allowContactNotAttending,
          showPrices: event.showPrices && menu?.status === "approved",
          rules: event.rules,
          venue: venue ? { name: venue.name, address: venue.address } : null,
        },
        permissions: {
          canEdit: gate.open,
          closedReason: gate.open ? undefined : gate.reason,
        },
      });
    },

    async "POST /api/session/logout"(req) {
      if (!originOk(req))
        return fail(403, "bad_origin", "Request origin not allowed");
      return {
        status: 204,
        headers: {
          "Set-Cookie": `${SESSION_COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${config.secureCookies === false ? "" : "; Secure"}`,
        },
      };
    },

    async "GET /api/booking"(req) {
      const auth = await authenticate(req);
      if (!auth)
        return fail(
          401,
          "unauthenticated",
          "Please open your invitation link again.",
        );
      // The booking is looked up by the session's invitation only; no client-supplied id is read.
      const booking = await repo.getBooking(
        auth.invitation.id,
        auth.payload.ev,
      );
      return ok({ booking: publicBooking(booking) });
    },

    async "PUT /api/booking"(req) {
      return saveBooking(req, false);
    },

    async "POST /api/booking/submit"(req) {
      return saveBooking(req, true);
    },
  };

  /** @param {ApiRequest} req @param {boolean} submit */
  async function saveBooking(req, submit) {
    const auth = await authenticate(req);
    if (!auth)
      return fail(
        401,
        "unauthenticated",
        "Please open your invitation link again.",
      );
    if (!originOk(req))
      return fail(403, "bad_origin", "Request origin not allowed");
    if (
      !req.headers["x-csrf-token"] ||
      !safeEqual(String(req.headers["x-csrf-token"]), auth.payload.csrf)
    )
      return fail(403, "bad_csrf", "Missing or invalid CSRF token");
    const limited = writeLimiter.check(
      `write:${auth.invitation.id}`,
      now().getTime(),
    );
    if (!limited.allowed)
      return fail(
        429,
        "rate_limited",
        "Too many requests. Try again shortly.",
        undefined,
        { "Retry-After": String(limited.retryAfterSeconds) },
      );

    const { event, menu } = await loadEventAndMenu(auth.payload.ev);
    if (!event) return fail(404, "not_found", "Event not found");
    const gate = orderingGate(event, menu, now());
    if (!gate.open)
      return fail(
        403,
        gate.reason ?? "closed",
        "Orders are not open for this event.",
      );

    const existing = await repo.getBooking(auth.invitation.id, auth.payload.ev);
    const expectedVersion = submit
      ? (existing?.version ?? 0)
      : Number(req.body?.version);
    if (!Number.isInteger(expectedVersion) || expectedVersion < 0)
      return fail(400, "bad_request", "version must be a whole number");

    // Submitting repeats the stored booking: idempotent, and never trusts a client body.
    if (submit && existing?.status === "submitted") {
      return ok({
        confirmationId: existing.confirmationId,
        booking: publicBooking(existing),
      });
    }
    const input = submit ? existing : cleanBooking(req.body);
    if (!input)
      return fail(
        422,
        "nothing_to_submit",
        "Save your booking before submitting.",
      );

    const issues = validateBooking(/** @type {any} */ (input), event, menu);
    const strict =
      submit || existing?.status === "submitted" || input.attendance === "no";
    const blocking = strict
      ? issues
      : issues.filter((i) => !DRAFT_TOLERATED.has(i.code));
    if (blocking.length > 0)
      return fail(
        422,
        "validation_failed",
        "Please correct the highlighted problems.",
        blocking,
      );
    if (submit && input.attendance === "undecided")
      return fail(
        422,
        "validation_failed",
        "Choose attending or not attending first.",
        [
          {
            path: "attendance",
            code: "invalid_attendance",
            message: "Choose attending or not attending",
          },
        ],
      );

    const diners =
      menu?.status === "approved" && event.orderingMode !== "rsvp_only"
        ? snapshotSelections(/** @type {any} */ (input), menu)
        : input.diners;
    const nowIso = now().toISOString();
    const becomesSubmitted = submit || existing?.status === "submitted";
    const result = await repo.saveBooking(
      {
        id: existing?.id ?? auth.invitation.id,
        eventId: event.id,
        invitationId: auth.invitation.id,
        attendance: input.attendance,
        contactName: input.contactName,
        partyNotes: input.partyNotes,
        diners,
        status: becomesSubmitted ? "submitted" : "draft",
        confirmationId: becomesSubmitted
          ? (existing?.confirmationId ?? newConfirmationId())
          : undefined,
        submittedAt: becomesSubmitted
          ? (existing?.submittedAt ?? nowIso)
          : undefined,
        updatedAt: nowIso,
        version: expectedVersion,
      },
      expectedVersion,
      event.capacity,
    );
    if (!result.ok) {
      return result.reason === "capacity_reached"
        ? fail(
            409,
            "capacity_reached",
            "Sorry, there are not enough places left.",
          )
        : fail(
            409,
            "version_conflict",
            "This booking changed elsewhere. Reload to see the latest version.",
          );
    }
    // Audit metadata is deliberately free of names, dietary notes and order contents.
    await repo.addAudit({
      actor: `invitation:${auth.invitation.id}`,
      action: submit ? "booking.submitted" : "booking.saved",
      entity: "booking",
      entityId: result.booking.id,
      timestamp: nowIso,
      safeMetadata: {
        dinerCount: result.booking.diners.length,
        attendance: result.booking.attendance,
      },
    });
    const total =
      menu && event.showPrices && menu.status === "approved"
        ? result.booking.diners.reduce(
            (t, d) => t + dinerTotalMinor(d, event, menu),
            0,
          )
        : undefined;
    return ok({
      booking: publicBooking(result.booking),
      confirmationId: result.booking.confirmationId,
      estimatedTotalMinor: total,
    });
  }

  /**
   * Menu route has a path parameter, so it is matched separately.
   * @param {ApiRequest} req
   */
  async function menuRoute(req) {
    const auth = await authenticate(req);
    if (!auth)
      return fail(
        401,
        "unauthenticated",
        "Please open your invitation link again.",
      );
    const requested = decodeURIComponent(req.path.split("/")[3] ?? "");
    if (requested !== auth.payload.ev)
      return fail(403, "forbidden", "Not allowed");
    const { event, menu } = await loadEventAndMenu(auth.payload.ev);
    if (!event) return fail(404, "not_found", "Event not found");
    if (menu?.status !== "approved")
      return fail(
        403,
        "menu_not_approved",
        "The menu has not been approved yet.",
      );
    return ok({ menu: publicMenu(menu, event.showPrices) });
  }

  const admin = createAdminHandler(repo, config, now);

  return async (req) => {
    let path = req.path.split("?")[0];
    while (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);
    try {
      const size = JSON.stringify(req.body ?? "").length;
      if (size > BODY_LIMIT_BYTES)
        return fail(400, "bad_request", "Request too large");
      if (path.startsWith("/api/admin/")) return await admin(req, path);
      const handler = routes[`${req.method} ${path}`];
      if (handler) return await handler(req);
      if (req.method === "GET" && /^\/api\/events\/[^/]+\/menu$/.test(path))
        return await menuRoute(req);
      return fail(404, "not_found", "Not found");
    } catch (error) {
      // Log the class of failure only: never request bodies, tokens or cookies.
      console.error(
        "api_error",
        error instanceof Error ? error.name : "unknown",
      );
      return fail(
        500,
        "internal_error",
        "Something went wrong. Please try again.",
      );
    }
  };
}
