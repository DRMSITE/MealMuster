// @ts-check
/**
 * Organiser API (`/api/admin/...`). Every route authenticates a Firebase ID
 * token (Bearer header, so there is no ambient cookie authority to forge) and
 * then checks organisation membership on the event being addressed. Unknown
 * and foreign events both answer 403, so ids cannot be probed.
 */
import { randomBytes } from "node:crypto";
import { fail, ok } from "./http.js";
import { createRateLimiter, generateToken, hashToken } from "./security.js";
import { validateEventSettings } from "./shared/event-settings.js";
import {
  aggregateCsv,
  attendanceCsv,
  buildSummary,
  eventCounts,
  restaurantCsv,
} from "./shared/exports.js";
import {
  approveMenu,
  invitationBlockers,
  reviewMenu,
} from "./shared/menu-lifecycle.js";
import { readinessChecklist } from "./shared/readiness.js";
import { retentionDeleteAfter, retentionDue } from "./shared/retention.js";

/**
 * @typedef {import("./http.js").ApiRequest} ApiRequest
 * @typedef {import("./http.js").ApiResponse} ApiResponse
 * @typedef {{ uid: string, memberships: { organisationId: string, role: string }[] }} Organiser
 */

const EXPORT_KINDS = ["attendance", "restaurant", "aggregate"];
const MAX_DISPLAY_NAME = 80;

/**
 * @param {import("./app.js").Repo} repo
 * @param {import("./app.js").AppConfig} config
 * @param {() => Date} now
 * @returns {(req: ApiRequest, path: string) => Promise<ApiResponse>}
 */
export function createAdminHandler(repo, config, now) {
  const writeLimiter = createRateLimiter({
    limit: config.writeLimit ?? 60,
    windowMs: 60_000,
  });
  // Every admin request, by client address: a coarse brake on scraping.
  const requestLimiter = createRateLimiter({
    limit: config.adminRequestLimit ?? 300,
    windowMs: 60_000,
  });
  // Failed sign-ins, by client address. Checked before the token is verified,
  // so a guessing client cannot make the server call Firebase Auth endlessly.
  const failureLimiter = createRateLimiter({
    limit: config.adminFailureLimit ?? 20,
    windowMs: 60_000,
  });
  const tooMany = (/** @type {number} */ seconds) =>
    fail(
      429,
      "rate_limited",
      "Too many requests. Try again shortly.",
      undefined,
      {
        "Retry-After": String(seconds),
      },
    );

  /** @param {ApiRequest} req @returns {Promise<Organiser | null>} */
  async function authenticate(req) {
    const match = /^Bearer (.+)$/.exec(req.headers.authorization ?? "");
    if (!match || !config.verifyIdToken) return null;
    const user = await config.verifyIdToken(match[1]);
    if (!user) return null;
    return { uid: user.uid, memberships: await repo.getMemberships(user.uid) };
  }

  /**
   * Loads an event the organiser may act on.
   * @param {Organiser} user @param {string} eventId @param {{ ownerOnly?: boolean }} [opts]
   */
  async function authorise(user, eventId, opts = {}) {
    const event = await repo.getEvent(eventId);
    const membership = event
      ? user.memberships.find((m) => m.organisationId === event.organisationId)
      : undefined;
    if (
      !event ||
      !membership ||
      (opts.ownerOnly && membership.role !== "owner")
    )
      return {
        response: fail(
          403,
          "forbidden",
          "You do not have access to this event.",
        ),
      };
    const found = event.menuId ? await repo.getMenu(event.menuId) : null;
    // A menu from another organisation is never used, even if an id points at it.
    const menu =
      found && found.organisationId === event.organisationId
        ? found
        : undefined;
    return { event, menu, role: membership.role };
  }

  /** @param {string} actor @param {string} action @param {string} entity @param {string} entityId @param {Record<string, unknown>} [safeMetadata] */
  const audit = (actor, action, entity, entityId, safeMetadata = {}) =>
    repo.addAudit({
      actor: `organiser:${actor}`,
      action,
      entity,
      entityId,
      timestamp: now().toISOString(),
      safeMetadata,
    });

  /** @param {any} invitation @param {any} booking */
  const invitationRow = (invitation, booking) => ({
    id: invitation.id,
    displayName: invitation.displayName,
    issuedAt: invitation.issuedAt,
    lastUsedAt: invitation.lastUsedAt,
    revoked: Boolean(invitation.revokedAt),
    reply: invitation.revokedAt
      ? "revoked"
      : !booking
        ? "none"
        : booking.status === "draft"
          ? "in_progress"
          : booking.attendance === "yes"
            ? "attending"
            : "not_attending",
    confirmationId: booking?.confirmationId,
    dinerCount:
      booking?.status === "submitted" && booking.attendance === "yes"
        ? booking.diners.length
        : 0,
  });

  /** @param {string} eventId */
  async function loadAll(eventId) {
    const [invitations, bookings] = await Promise.all([
      repo.listInvitations(eventId),
      repo.listBookings(eventId),
    ]);
    return { invitations, bookings };
  }

  /**
   * Handlers receive the already-authorised event.
   * @typedef {{ req: ApiRequest, user: Organiser, event: any, menu: any, role: string, parts: string[] }} Ctx
   */

  /** @param {Ctx} c */
  async function overview(c) {
    const { invitations, bookings } = await loadAll(c.event.id);
    const byInvitation = new Map(bookings.map((b) => [b.invitationId, b]));
    return ok({
      event: c.event,
      menu: c.menu && {
        id: c.menu.id,
        title: c.menu.title,
        status: c.menu.status,
      },
      invitationBlockers: invitationBlockers(c.event, c.menu),
      readiness: readinessChecklist(c.event, c.menu),
      counts: eventCounts(invitations, bookings),
      invitations: invitations
        .toSorted((a, b) =>
          String(a.issuedAt).localeCompare(String(b.issuedAt)),
        )
        .map((i) => invitationRow(i, byInvitation.get(i.id))),
      retention: {
        days: c.event.retentionDays ?? null,
        deleteAfter: retentionDeleteAfter(c.event),
        privateDataDeletedAt: c.event.privateDataDeletedAt ?? null,
      },
      role: c.role,
    });
  }

  /** @param {Ctx} c */
  async function createInvitation(c) {
    const displayName =
      typeof c.req.body?.displayName === "string"
        ? c.req.body.displayName.trim()
        : "";
    if (!displayName || displayName.length > MAX_DISPLAY_NAME)
      return fail(
        422,
        "validation_failed",
        `Enter a name of 1 to ${MAX_DISPLAY_NAME} characters.`,
      );
    const blockers = invitationBlockers(c.event, c.menu);
    if (blockers.length > 0)
      return fail(
        409,
        "invitations_blocked",
        "Links cannot be created yet.",
        blockers,
      );
    const token = generateToken();
    const invitation = {
      id: `inv-${randomBytes(9).toString("base64url")}`,
      eventId: c.event.id,
      displayName,
      status: "issued",
      tokenHash: hashToken(token, config.secret),
      issuedAt: now().toISOString(),
    };
    await repo.createInvitation(invitation);
    await audit(c.user.uid, "invitation.created", "invitation", invitation.id);
    // The raw token is shown once; only its hash is stored.
    return ok(
      { invitation: invitationRow(invitation, null), path: `/i#${token}` },
      201,
    );
  }

  /** @param {Ctx} c @param {"revoke" | "reissue"} action */
  async function changeInvitation(c, action) {
    const invitation = await repo.getInvitation(c.parts[6] ?? "");
    if (!invitation || invitation.eventId !== c.event.id)
      return fail(404, "not_found", "Invitation not found");
    if (action === "revoke") {
      await repo.updateInvitation(invitation.id, {
        revokedAt: now().toISOString(),
      });
      await audit(
        c.user.uid,
        "invitation.revoked",
        "invitation",
        invitation.id,
      );
      return ok({ ok: true });
    }
    const blockers = invitationBlockers(c.event, c.menu);
    if (blockers.length > 0)
      return fail(
        409,
        "invitations_blocked",
        "Links cannot be reissued yet.",
        blockers,
      );
    const token = generateToken();
    await repo.updateInvitation(invitation.id, {
      tokenHash: hashToken(token, config.secret),
      revokedAt: null,
    });
    await audit(c.user.uid, "invitation.reissued", "invitation", invitation.id);
    return ok({ path: `/i#${token}` });
  }

  /** Lists replies without dietary notes. @param {Ctx} c */
  async function listBookings(c) {
    const { invitations, bookings } = await loadAll(c.event.id);
    const byInvitation = new Map(bookings.map((b) => [b.invitationId, b]));
    const search = new URLSearchParams(c.req.path.split("?")[1] ?? "");
    const query = (search.get("q") ?? "").trim().toLowerCase();
    const rows = invitations
      .map((i) => ({ i, b: byInvitation.get(i.id) }))
      .filter(({ i, b }) => {
        if (!query) return true;
        const haystack = [
          i.displayName,
          b?.contactName,
          b?.confirmationId,
          ...(b?.diners ?? []).map((/** @type {any} */ d) => d.name),
        ]
          .join("\n")
          .toLowerCase();
        return haystack.includes(query);
      })
      .map(({ i, b }) => invitationRow(i, b));
    return ok({ bookings: rows });
  }

  /** Full booking for one invitation, with its audit trail. @param {Ctx} c */
  async function bookingDetail(c) {
    const invitationId = c.parts[6] ?? "";
    const invitation = await repo.getInvitation(invitationId);
    if (!invitation || invitation.eventId !== c.event.id)
      return fail(404, "not_found", "Booking not found");
    const booking = await repo.getBooking(invitationId, c.event.id);
    const history = booking ? await repo.listAudit(booking.id) : [];
    return ok({
      invitation: invitationRow(invitation, booking),
      booking,
      history: history.map((h) => ({
        action: h.action,
        actor: h.actor.startsWith("organiser:") ? "Organiser" : "Invitee",
        timestamp: h.timestamp,
      })),
    });
  }

  /** @param {Ctx} c @param {"open" | "closed"} status */
  async function setStatus(c, status) {
    if (status === "open") {
      const blockers = invitationBlockers(c.event, c.menu);
      if (blockers.length > 0)
        return fail(
          409,
          "event_not_ready",
          "This event is not ready to open.",
          blockers,
        );
      const requested = c.req.body?.orderDeadline;
      if (requested !== undefined) {
        const time = Date.parse(requested);
        if (
          typeof requested !== "string" ||
          Number.isNaN(time) ||
          time <= now().getTime()
        )
          return fail(
            422,
            "validation_failed",
            "The new deadline must be a future date and time.",
          );
      }
      await repo.updateEvent(c.event.id, {
        status,
        ...(requested ? { orderDeadline: requested } : {}),
      });
      await audit(c.user.uid, "event.reopened", "event", c.event.id, {
        deadlineChanged: requested !== undefined,
      });
    } else {
      await repo.updateEvent(c.event.id, { status });
      await audit(c.user.uid, "event.closed", "event", c.event.id);
    }
    return ok({ status });
  }

  /** @param {Ctx} c */
  async function summary(c) {
    const { bookings } = await loadAll(c.event.id);
    return ok({
      event: { id: c.event.id, title: c.event.title, startAt: c.event.startAt },
      ...buildSummary(c.event, c.menu, bookings),
    });
  }

  /** @param {Ctx} c */
  async function exportCsv(c) {
    const kind = c.parts[6] ?? "";
    if (!EXPORT_KINDS.includes(kind))
      return fail(404, "not_found", "Unknown export");
    const { invitations, bookings } = await loadAll(c.event.id);
    const built = buildSummary(c.event, c.menu, bookings);
    const text =
      kind === "attendance"
        ? attendanceCsv(invitations, bookings)
        : kind === "restaurant"
          ? restaurantCsv(built)
          : aggregateCsv(built);
    await audit(c.user.uid, "export.generated", "event", c.event.id, { kind });
    const safeId = c.event.id.replaceAll(/[^\w-]/g, "");
    return {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${safeId}-${kind}.csv"`,
      },
      text,
    };
  }

  /** Deletes an event's personal data. Owner only, closed events only, typed confirmation. @param {Ctx} c */
  async function deleteData(c) {
    if (c.event.status !== "closed")
      return fail(
        409,
        "event_not_closed",
        "Close the event before deleting its data.",
      );
    if (c.req.body?.confirmTitle !== c.event.title)
      return fail(
        422,
        "confirmation_mismatch",
        "Type the event title exactly to confirm.",
      );
    const removed = await repo.deleteEventPrivateData(c.event.id);
    await repo.updateEvent(c.event.id, {
      privateDataDeletedAt: now().toISOString(),
    });
    await audit(
      c.user.uid,
      "event.private_data_deleted",
      "event",
      c.event.id,
      removed,
    );
    return ok({ removed });
  }

  /** @param {Ctx} c */
  async function updateSettings(c) {
    const result = validateEventSettings(c.req.body, c.event, now());
    if (!result.ok)
      return fail(
        422,
        "validation_failed",
        "Please correct the highlighted problems.",
        result.issues,
      );
    if (result.changes.capacity !== undefined) {
      const { bookings } = await loadAll(c.event.id);
      const placed = bookings
        .filter((b) => b.status === "submitted" && b.attendance === "yes")
        .reduce((n, b) => n + b.diners.length, 0);
      if (placed > result.changes.capacity)
        return fail(
          422,
          "validation_failed",
          "Places cannot be fewer than people already booked.",
          [
            {
              path: "capacity",
              message: `${placed} people are already booked.`,
            },
          ],
        );
    }
    await repo.updateEvent(c.event.id, result.changes);
    // Field names only: values (such as a contact) never go in the audit log.
    await audit(c.user.uid, "event.settings_changed", "event", c.event.id, {
      fields: Object.keys(result.changes),
    });
    return ok({ event: { ...c.event, ...result.changes } });
  }

  /** @param {Ctx} c */
  async function showMenu(c) {
    if (!c.menu) return fail(404, "not_found", "This event has no menu.");
    return ok({ menu: c.menu, readiness: readinessChecklist(c.event, c.menu) });
  }

  /** @param {Ctx} c */
  async function reviewItems(c) {
    if (!c.menu) return fail(404, "not_found", "This event has no menu.");
    const result = reviewMenu(c.menu, c.req.body?.items);
    if (!result.ok)
      return fail(
        422,
        "validation_failed",
        result.issues[0] ?? "Invalid review.",
        result.issues,
      );
    await repo.updateMenu(result.menu);
    await audit(c.user.uid, "menu.reviewed", "menu", c.menu.id, {
      changed: result.changed,
    });
    return ok({ menu: result.menu });
  }

  /** @param {Ctx} c */
  async function approve(c) {
    if (!c.menu) return fail(404, "not_found", "This event has no menu.");
    if (c.menu.status !== "draft")
      return fail(409, "menu_not_draft", "Only a draft menu can be approved.");
    const available = c.menu.sections
      .flatMap((/** @type {any} */ s) => s.items)
      .filter((/** @type {any} */ i) => i.available);
    if (available.length === 0)
      return fail(
        409,
        "menu_empty",
        "At least one item must be offered before approval.",
      );
    try {
      const approved = approveMenu(c.menu, {
        approvedBy: c.user.uid,
        now: now(),
      });
      await repo.updateMenu(approved);
    } catch (error) {
      return fail(
        409,
        "menu_has_unverified_items",
        error instanceof Error
          ? error.message
          : "The menu cannot be approved yet.",
      );
    }
    await audit(c.user.uid, "menu.approved", "menu", c.menu.id);
    return ok({ status: "approved" });
  }

  /** Purges closed events in the organiser's organisations whose retention has passed. @param {Organiser} user */
  async function purgeExpired(user) {
    const owned = user.memberships.filter((m) => m.role === "owner");
    if (owned.length === 0)
      return fail(
        403,
        "forbidden",
        "Only an organisation owner can run retention.",
      );
    const purged = [];
    for (const m of owned) {
      for (const event of await repo.listEvents(m.organisationId)) {
        if (event.privateDataDeletedAt || !retentionDue(event, now())) continue;
        const removed = await repo.deleteEventPrivateData(event.id);
        await repo.updateEvent(event.id, {
          privateDataDeletedAt: now().toISOString(),
        });
        await audit(user.uid, "event.private_data_deleted", "event", event.id, {
          ...removed,
          reason: "retention",
        });
        purged.push(event.id);
      }
    }
    return ok({ purged });
  }

  /** Event routes: "METHOD sub-path" relative to /api/admin/events/:id. */
  /** @type {Record<string, { write: boolean, ownerOnly?: boolean, run: (c: Ctx) => Promise<ApiResponse> }>} */
  const eventRoutes = {
    "GET overview": { write: false, run: overview },
    "PATCH event": { write: true, run: updateSettings },
    "GET menu": { write: false, run: showMenu },
    "POST menu-review": { write: true, run: reviewItems },
    "POST menu-approve": { write: true, run: approve },
    "POST invitations": { write: true, run: createInvitation },
    "GET bookings": { write: false, run: listBookings },
    "GET booking": { write: false, run: bookingDetail },
    "POST revoke": { write: true, run: (c) => changeInvitation(c, "revoke") },
    "POST reissue": { write: true, run: (c) => changeInvitation(c, "reissue") },
    "POST close": { write: true, run: (c) => setStatus(c, "closed") },
    "POST reopen": { write: true, run: (c) => setStatus(c, "open") },
    "GET summary": { write: false, run: summary },
    "GET export": { write: false, run: exportCsv },
    "DELETE data": { write: true, ownerOnly: true, run: deleteData },
  };

  /** Maps /api/admin/events/:id/<segments> to a route key. @param {string} method @param {string[]} parts */
  function routeKey(method, parts) {
    const section = parts[5];
    const length = parts.length;
    if (length === 5) return method === "PATCH" ? "PATCH event" : null;
    if (section === "menu") {
      if (length === 6) return `${method} menu`;
      return length === 7 ? `${method} menu-${parts[6]}` : null;
    }
    if (section === "invitations") {
      if (length === 6) return `${method} invitations`;
      const action = parts[7];
      if (length === 8 && (action === "revoke" || action === "reissue"))
        return `${method} ${action}`;
      return null;
    }
    if (section === "bookings") {
      if (length === 6) return `${method} bookings`;
      return length === 7 ? `${method} booking` : null;
    }
    if (section === "exports") return length === 7 ? `${method} export` : null;
    return length === 6 ? `${method} ${section}` : null;
  }

  return async (req, path) => {
    const address = req.ip ?? "unknown";
    const nowMs = now().getTime();
    const overall = requestLimiter.check(`admin-ip:${address}`, nowMs);
    if (!overall.allowed) return tooMany(overall.retryAfterSeconds);
    if (!failureLimiter.peek(`admin-fail:${address}`, nowMs))
      return tooMany(60);
    const user = await authenticate(req);
    if (!user) {
      failureLimiter.check(`admin-fail:${address}`, nowMs);
      return fail(401, "unauthenticated", "Please sign in as an organiser.");
    }
    const parts = path.split("/").map(decodeURIComponent);

    if (req.method === "GET" && path === "/api/admin/events") {
      const lists = await Promise.all(
        user.memberships.map((m) => repo.listEvents(m.organisationId)),
      );
      return ok({
        events: lists.flat().map((e) => ({
          id: e.id,
          title: e.title,
          status: e.status,
          startAt: e.startAt,
          organisationId: e.organisationId,
        })),
      });
    }
    if (req.method === "POST" && path === "/api/admin/retention/purge")
      return purgeExpired(user);

    if (parts[3] !== "events" || !parts[4])
      return fail(404, "not_found", "Not found");
    const key = routeKey(req.method, parts);
    const route = key ? eventRoutes[key] : undefined;
    if (!route) return fail(404, "not_found", "Not found");

    const access = await authorise(user, parts[4], {
      ownerOnly: route.ownerOnly,
    });
    if (access.response) return access.response;
    if (route.write) {
      const limited = writeLimiter.check(`admin:${user.uid}`, now().getTime());
      if (!limited.allowed)
        return fail(
          429,
          "rate_limited",
          "Too many requests. Try again shortly.",
          undefined,
          {
            "Retry-After": String(limited.retryAfterSeconds),
          },
        );
    }
    return route.run({ req, user, parts, ...access });
  };
}
