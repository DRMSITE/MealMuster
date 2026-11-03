import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../functions/src/app.js";
import { createMemoryRepo } from "../../functions/src/memory-repo.js";
import { generateToken, hashToken } from "../../functions/src/security.js";
import {
  alaCarteEvent,
  alaCarteMenu,
  setMealEvent,
  setMealMenu,
} from "../fixtures.js";

const SECRET = "test-secret-not-for-production";
const ORIGIN = "https://mealmuster.test";
let nowMs = Date.parse("2029-12-01T00:00:00Z");

const invitation = (id, token, extra = {}) => ({
  id,
  eventId: "ev-set",
  displayName: `Invitee ${id}`,
  status: "issued",
  tokenHash: hashToken(token, SECRET),
  issuedAt: "2029-11-01T00:00:00Z",
  ...extra,
});

function setup() {
  const tokens = { a: generateToken(), b: generateToken() };
  const repo = createMemoryRepo({
    events: [setMealEvent, { ...alaCarteEvent, id: "ev-other" }],
    menus: [setMealMenu, alaCarteMenu],
    invitations: [invitation("inv-a", tokens.a), invitation("inv-b", tokens.b)],
  });
  const app = createApp(repo, {
    secret: SECRET,
    allowedOrigins: [ORIGIN],
    now: () => new Date(nowMs),
  });
  return { repo, app, tokens };
}

const call = (app, method, path, { body, session, headers = {} } = {}) =>
  app({
    method,
    path,
    body,
    ip: "203.0.113.1",
    headers: {
      origin: ORIGIN,
      ...(session
        ? { cookie: session.cookie, "x-csrf-token": session.csrf }
        : {}),
      ...headers,
    },
  });

async function login(app, token) {
  const res = await call(app, "POST", "/api/invitations/redeem", {
    body: { token },
  });
  expect(res.status).toBe(204);
  const cookie = res.headers["Set-Cookie"].split(";")[0];
  const me = await call(app, "GET", "/api/session", { session: { cookie } });
  return { cookie, csrf: me.body.csrfToken, me };
}

const diner = (id, name, starter, main, isContact = false) => ({
  id,
  name,
  isContact,
  selections: [
    { menuItemId: starter, quantity: 1 },
    {
      menuItemId: main,
      quantity: 1,
      ...(main === "roast" ? { optionIds: ["gravy"] } : {}),
    },
  ],
});
const party = () => ({
  version: 0,
  attendance: "yes",
  contactName: "Alex Example",
  diners: [
    diner("d1", "Alex Example", "soup", "roast", true),
    diner("d2", "Guest One", "soup", "nutloaf"),
    diner("d3", "Guest Two", "soup", "roast"),
  ],
});

beforeEach(() => {
  nowMs = Date.parse("2029-12-01T00:00:00Z");
});

describe("invitation redemption", () => {
  it("sets a hardened cookie and never returns or stores the raw token", async () => {
    const { app, tokens, repo } = setup();
    const res = await call(app, "POST", "/api/invitations/redeem", {
      body: { token: tokens.a },
    });
    expect(res.status).toBe(204);
    expect(res.headers["Set-Cookie"]).toMatch(
      /^__session=.+; HttpOnly; SameSite=Strict; Path=\/; Max-Age=\d+; Secure$/,
    );
    expect(JSON.stringify([...repo.audit])).not.toContain(tokens.a);
    expect(await repo.findInvitationByTokenHash(tokens.a)).toBeNull();
  });

  it("rejects unknown, revoked and expired tokens identically", async () => {
    const { app, repo, tokens } = setup();
    await repo.updateInvitation("inv-a", { revokedAt: "2029-11-02T00:00:00Z" });
    await repo.updateInvitation("inv-b", {
      tokenExpiry: "2029-11-03T00:00:00Z",
    });
    const results = await Promise.all(
      [generateToken(), tokens.a, tokens.b].map((token) =>
        call(app, "POST", "/api/invitations/redeem", { body: { token } }),
      ),
    );
    expect(results.map((r) => r.status)).toEqual([401, 401, 401]);
    expect(new Set(results.map((r) => JSON.stringify(r.body))).size).toBe(1);
  });

  it("ends an existing session when the invitation is revoked", async () => {
    const { app, tokens, repo } = setup();
    const session = await login(app, tokens.a);
    await repo.updateInvitation("inv-a", { revokedAt: "2029-12-01T00:00:01Z" });
    expect((await call(app, "GET", "/api/session", { session })).status).toBe(
      401,
    );
  });

  it("rejects a foreign origin and rate-limits repeated attempts", async () => {
    const { app } = setup();
    expect(
      (
        await call(app, "POST", "/api/invitations/redeem", {
          body: { token: "x".repeat(30) },
          headers: { origin: "https://evil.test" },
        })
      ).status,
    ).toBe(403);
    let last;
    for (let i = 0; i < 12; i++)
      last = await call(app, "POST", "/api/invitations/redeem", {
        body: { token: "x".repeat(30) },
      });
    expect(last.status).toBe(429);
    expect(last.headers["Retry-After"]).toBeDefined();
  });

  it("rejects tampered or expired sessions", async () => {
    const { app, tokens } = setup();
    const { cookie } = await login(app, tokens.a);
    expect(
      (
        await call(app, "GET", "/api/session", {
          session: { cookie: `${cookie}x` },
        })
      ).status,
    ).toBe(401);
    nowMs += 3 * 60 * 60 * 1000;
    expect(
      (await call(app, "GET", "/api/session", { session: { cookie } })).status,
    ).toBe(401);
  });
});

describe("session and menu", () => {
  it("returns minimal event metadata for the invitation's event only", async () => {
    const { app, tokens } = setup();
    const { me } = await login(app, tokens.a);
    expect(me.body.event.id).toBe("ev-set");
    expect(me.body.permissions.canEdit).toBe(true);
    expect(JSON.stringify(me.body)).not.toMatch(/tokenHash|inv-b/);
  });

  it("serves the approved menu for the session's event and refuses other ids", async () => {
    const { app, tokens } = setup();
    const session = await login(app, tokens.a);
    expect(
      (await call(app, "GET", "/api/events/ev-set/menu", { session })).body.menu
        .sections,
    ).toHaveLength(2);
    expect(
      (await call(app, "GET", "/api/events/ev-other/menu", { session })).status,
    ).toBe(403);
  });

  it("withholds the menu when it is an unapproved draft", async () => {
    const { app, tokens, repo } = setup();
    repo.getMenu = async () => ({ ...setMealMenu, status: "draft" });
    const session = await login(app, tokens.a);
    expect(
      (await call(app, "GET", "/api/events/ev-set/menu", { session })).status,
    ).toBe(403);
    const save = await call(app, "PUT", "/api/booking", {
      session,
      body: party(),
    });
    expect(save.status).toBe(403);
    expect(save.body.error.code).toBe("menu_not_approved");
  });
});

describe("booking", () => {
  it("accepts a contact plus two guests, submits, and amends before the deadline", async () => {
    const { app, tokens } = setup();
    const session = await login(app, tokens.a);
    const saved = await call(app, "PUT", "/api/booking", {
      session,
      body: party(),
    });
    expect(saved.status).toBe(200);
    expect(saved.body.booking.diners).toHaveLength(3);
    expect(saved.body.estimatedTotalMinor).toBe(7500);

    const submitted = await call(app, "POST", "/api/booking/submit", {
      session,
    });
    expect(submitted.status).toBe(200);
    const id = submitted.body.confirmationId;
    expect(id).toMatch(/^MM-[A-Z2-9]{8}$/);

    const again = await call(app, "POST", "/api/booking/submit", { session });
    expect(again.body.confirmationId).toBe(id);

    const edit = party();
    edit.version = submitted.body.booking.version;
    edit.diners[1].selections[1] = {
      menuItemId: "roast",
      quantity: 1,
      optionIds: ["pepper"],
    };
    const amended = await call(app, "PUT", "/api/booking", {
      session,
      body: edit,
    });
    expect(amended.status).toBe(200);
    expect(amended.body.confirmationId).toBe(id);
    expect(amended.body.booking.diners).toHaveLength(3);
    const stored = await call(app, "GET", "/api/booking", { session });
    expect(
      stored.body.booking.diners[1].selections.map((s) => s.menuItemId),
    ).toEqual(["soup", "roast"]);
  });

  it("keeps exactly one current order when a retry reuses a stale version", async () => {
    const { app, tokens, repo } = setup();
    const session = await login(app, tokens.a);
    expect(
      (await call(app, "PUT", "/api/booking", { session, body: party() }))
        .status,
    ).toBe(200);
    const retry = await call(app, "PUT", "/api/booking", {
      session,
      body: party(),
    });
    expect(retry.status).toBe(409);
    expect(retry.body.error.code).toBe("version_conflict");
    expect(repo.bookings.size).toBe(1);
  });

  it("records a decline without any menu details", async () => {
    const { app, tokens } = setup();
    const session = await login(app, tokens.a);
    const res = await call(app, "PUT", "/api/booking", {
      session,
      body: { version: 0, attendance: "no", contactName: "Sam" },
    });
    expect(res.status).toBe(200);
    expect(
      (await call(app, "POST", "/api/booking/submit", { session })).status,
    ).toBe(200);
  });

  it("will not submit an incomplete order but allows saving a draft", async () => {
    const { app, tokens } = setup();
    const session = await login(app, tokens.a);
    const partial = {
      version: 0,
      attendance: "yes",
      contactName: "Alex",
      diners: [{ id: "d1", name: "Alex", isContact: true, selections: [] }],
    };
    expect(
      (await call(app, "PUT", "/api/booking", { session, body: partial }))
        .status,
    ).toBe(200);
    const submit = await call(app, "POST", "/api/booking/submit", { session });
    expect(submit.status).toBe(422);
    expect(submit.body.error.details.map((d) => d.code)).toContain("rule_min");
  });

  it("rejects invalid menu ids, unavailable items, forged prices, over-limit guests and closed deadlines", async () => {
    const { app, tokens } = setup();
    const session = await login(app, tokens.a);
    const bad = party();
    bad.diners[0].selections[0] = {
      menuItemId: "pate",
      quantity: 1,
      priceMinor: 1,
    };
    bad.diners[1].selections[0] = { menuItemId: "ghost", quantity: 1 };
    bad.diners.push(diner("d4", "Guest Three", "soup", "roast"));
    const res = await call(app, "PUT", "/api/booking", { session, body: bad });
    expect(res.status).toBe(422);
    expect(res.body.error.details.map((d) => d.code)).toEqual(
      expect.arrayContaining([
        "item_unavailable",
        "unknown_item",
        "guest_limit",
      ]),
    );

    const good = party();
    good.diners[0].selections[0].priceMinor = 1; // forged field is ignored
    const saved = await call(app, "PUT", "/api/booking", {
      session,
      body: good,
    });
    expect(saved.body.estimatedTotalMinor).toBe(7500);
    expect(JSON.stringify(saved.body)).not.toContain('"priceMinor":1,');

    nowMs = Date.parse("2030-01-02T00:00:00Z");
    const fresh = await login(app, tokens.a);
    const late = await call(app, "PUT", "/api/booking", {
      session: fresh,
      body: { ...good, version: 1 },
    });
    expect(late.status).toBe(403);
    expect(late.body.error.code).toBe("deadline_passed");
  });

  it("requires Origin and CSRF token for writes", async () => {
    const { app, tokens } = setup();
    const session = await login(app, tokens.a);
    expect(
      (
        await call(app, "PUT", "/api/booking", {
          session: { ...session, csrf: "nope" },
          body: party(),
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await call(app, "PUT", "/api/booking", {
          session,
          body: party(),
          headers: { origin: "https://evil.test" },
        })
      ).status,
    ).toBe(403);
    expect(
      (await call(app, "PUT", "/api/booking", { body: party() })).status,
    ).toBe(401);
  });

  it("stops one invitee reading or editing another's booking", async () => {
    const { app, tokens } = setup();
    const a = await login(app, tokens.a);
    const b = await login(app, tokens.b);
    await call(app, "PUT", "/api/booking", { session: a, body: party() });
    const asB = await call(
      app,
      "GET",
      "/api/booking?invitationId=inv-a&bookingId=inv-a",
      { session: b },
    );
    expect(asB.body.booking).toBeNull();
    const write = await call(app, "PUT", "/api/booking", {
      session: b,
      body: { ...party(), invitationId: "inv-a", id: "inv-a" },
    });
    expect(write.status).toBe(200);
    const aStill = await call(app, "GET", "/api/booking", { session: a });
    expect(aStill.body.booking.version).toBe(1);
    expect(aStill.body.booking.contactName).toBe("Alex Example");
  });

  it("enforces capacity", async () => {
    const { app, tokens, repo } = setup();
    repo.getEvent = async () => ({ ...setMealEvent, capacity: 4 });
    const a = await login(app, tokens.a);
    const b = await login(app, tokens.b);
    expect(
      (await call(app, "PUT", "/api/booking", { session: a, body: party() }))
        .status,
    ).toBe(200);
    const full = await call(app, "PUT", "/api/booking", {
      session: b,
      body: party(),
    });
    expect(full.status).toBe(409);
    expect(full.body.error.code).toBe("capacity_reached");
  });

  it("keeps names, dietary notes and tokens out of the audit log", async () => {
    const { app, tokens, repo } = setup();
    const session = await login(app, tokens.a);
    const body = party();
    body.diners[0].dietaryNotes = "SECRET-NOTE";
    await call(app, "PUT", "/api/booking", { session, body });
    const log = JSON.stringify(repo.audit);
    for (const forbidden of ["SECRET-NOTE", "Alex Example", tokens.a])
      expect(log).not.toContain(forbidden);
  });
});

describe("misc", () => {
  it("logs out by expiring the cookie and answers unknown routes with 404", async () => {
    const { app } = setup();
    const out = await call(app, "POST", "/api/session/logout");
    expect(out.headers["Set-Cookie"]).toContain("Max-Age=0");
    expect((await call(app, "GET", "/api/nothing")).status).toBe(404);
  });

  it("hides prices from the menu when the organiser disables them", async () => {
    const { app, tokens, repo } = setup();
    repo.getEvent = async () => ({ ...setMealEvent, showPrices: false });
    const session = await login(app, tokens.a);
    const menu = await call(app, "GET", "/api/events/ev-set/menu", { session });
    expect(JSON.stringify(menu.body)).not.toContain("priceMinor");
  });
});
