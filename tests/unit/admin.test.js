import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../functions/src/app.js";
import { createMemoryRepo } from "../../functions/src/memory-repo.js";
import { hashToken } from "../../functions/src/security.js";
import { retentionDeleteAfter, retentionDue } from "../../shared/retention.js";
import {
  alaCarteEvent,
  alaCarteMenu,
  setMealEvent,
  setMealMenu,
} from "../fixtures.js";

const SECRET = "test-secret-not-for-production";
const ORIGIN = "https://mealmuster.test";
const nowMs = Date.parse("2029-12-01T00:00:00Z");

/** Test double for Firebase ID token verification: the token is the uid. */
const verifyIdToken = async (token) =>
  token.startsWith("uid-") ? { uid: token } : null;

const memberships = [
  { userId: "uid-owner", organisationId: "org-a", role: "owner" },
  { userId: "uid-helper", organisationId: "org-a", role: "organiser" },
  { userId: "uid-other", organisationId: "org-b", role: "owner" },
];

const submitted = {
  id: "inv-a",
  eventId: "ev-set",
  invitationId: "inv-a",
  attendance: "yes",
  contactName: "Alex Example",
  status: "submitted",
  confirmationId: "MM-AAAAAAAA",
  version: 2,
  updatedAt: "2029-11-20T00:00:00Z",
  diners: [
    {
      id: "d1",
      name: "Alex Example",
      isContact: true,
      dietaryNotes: "No nuts",
      selections: [
        {
          menuItemId: "soup",
          quantity: 1,
          nameSnapshot: "Soup",
          sectionSnapshot: "Starters",
        },
      ],
    },
  ],
};

function setup() {
  const repo = createMemoryRepo({
    events: [
      setMealEvent,
      { ...alaCarteEvent, id: "ev-b", organisationId: "org-b" },
    ],
    menus: [setMealMenu, { ...alaCarteMenu, organisationId: "org-b" }],
    memberships,
    invitations: [
      {
        id: "inv-a",
        eventId: "ev-set",
        displayName: "Invitee A",
        status: "issued",
        tokenHash: hashToken("tok-a", SECRET),
        issuedAt: "2029-11-01T00:00:00Z",
      },
    ],
  });
  repo.bookings.set("inv-a", structuredClone(submitted));
  const app = createApp(repo, {
    secret: SECRET,
    allowedOrigins: [ORIGIN],
    now: () => new Date(nowMs),
    verifyIdToken,
  });
  const call = (method, path, as, body) =>
    app({
      method,
      path,
      body,
      headers: as ? { authorization: `Bearer ${as}` } : {},
    });
  return { repo, call, app };
}

describe("organiser authentication and tenancy", () => {
  let ctx;
  beforeEach(() => {
    ctx = setup();
  });

  it("rejects requests with no or an invalid token", async () => {
    expect((await ctx.call("GET", "/api/admin/events")).status).toBe(401);
    expect((await ctx.call("GET", "/api/admin/events", "garbage")).status).toBe(
      401,
    );
  });

  it("rejects a valid sign-in that belongs to no organisation", async () => {
    const res = await ctx.call(
      "GET",
      "/api/admin/events/ev-set/overview",
      "uid-nobody",
    );
    expect(res.status).toBe(403);
  });

  it("lists only the organiser's own organisation's events", async () => {
    const res = await ctx.call("GET", "/api/admin/events", "uid-owner");
    expect(res.body.events.map((e) => e.id)).toEqual(["ev-set"]);
  });

  it.each([
    ["GET", "/api/admin/events/ev-set/overview"],
    ["GET", "/api/admin/events/ev-set/bookings"],
    ["GET", "/api/admin/events/ev-set/bookings/inv-a"],
    ["GET", "/api/admin/events/ev-set/summary"],
    ["GET", "/api/admin/events/ev-set/exports/attendance"],
    ["GET", "/api/admin/events/ev-set/exports/restaurant"],
    ["POST", "/api/admin/events/ev-set/invitations"],
    ["POST", "/api/admin/events/ev-set/invitations/inv-a/revoke"],
    ["POST", "/api/admin/events/ev-set/close"],
    ["DELETE", "/api/admin/events/ev-set/data"],
  ])("denies another organisation: %s %s", async (method, path) => {
    const res = await ctx.call(method, path, "uid-other", {
      displayName: "x",
      confirmTitle: setMealEvent.title,
    });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("forbidden");
  });

  it("answers 403 for unknown events too, so ids cannot be probed", async () => {
    const res = await ctx.call(
      "GET",
      "/api/admin/events/nope/overview",
      "uid-owner",
    );
    expect(res.status).toBe(403);
  });

  it("does not accept an invitee session cookie as organiser authority", async () => {
    const res = await ctx.app({
      method: "GET",
      path: "/api/admin/events/ev-set/overview",
      headers: { cookie: "__session=anything" },
    });
    expect(res.status).toBe(401);
  });
});

describe("overview and invitations", () => {
  it("shows counts and never leaks token hashes", async () => {
    const { call } = setup();
    const res = await call(
      "GET",
      "/api/admin/events/ev-set/overview",
      "uid-owner",
    );
    expect(res.status).toBe(200);
    expect(res.body.counts).toMatchObject({
      attendingBookings: 1,
      attendingDiners: 1,
    });
    expect(JSON.stringify(res.body)).not.toContain("tokenHash");
  });

  it("creates a link once, stores only its hash and audits without names", async () => {
    const { call, repo } = setup();
    const res = await call(
      "POST",
      "/api/admin/events/ev-set/invitations",
      "uid-helper",
      { displayName: "Sam Example" },
    );
    expect(res.status).toBe(201);
    const token = res.body.path.replace("/i#", "");
    expect(token.length).toBeGreaterThanOrEqual(40);
    const stored = (await repo.listInvitations("ev-set")).find(
      (i) => i.displayName === "Sam Example",
    );
    expect(stored.tokenHash).toBe(hashToken(token, SECRET));
    expect(JSON.stringify(stored)).not.toContain(token);
    expect(JSON.stringify(repo.audit)).not.toContain("Sam Example");
    expect(JSON.stringify(repo.audit)).not.toContain(token);
  });

  it("validates the display name", async () => {
    const { call } = setup();
    for (const displayName of ["", "   ", "x".repeat(81), 5]) {
      const res = await call(
        "POST",
        "/api/admin/events/ev-set/invitations",
        "uid-owner",
        { displayName },
      );
      expect(res.status).toBe(422);
    }
  });

  it("refuses to create links while the menu is not approved", async () => {
    const draft = { ...setMealMenu, status: "draft" };
    const blocked = createMemoryRepo({
      events: [setMealEvent],
      menus: [draft],
      memberships,
    });
    const app = createApp(blocked, {
      secret: SECRET,
      allowedOrigins: [ORIGIN],
      now: () => new Date(nowMs),
      verifyIdToken,
    });
    const res = await app({
      method: "POST",
      path: "/api/admin/events/ev-set/invitations",
      body: { displayName: "Sam" },
      headers: { authorization: "Bearer uid-owner" },
    });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("invitations_blocked");
    expect(await blocked.listInvitations("ev-set")).toHaveLength(0);
  });

  it("revokes a link immediately and reissues a new one", async () => {
    const { call, repo } = setup();
    const url = "/api/admin/events/ev-set/invitations/inv-a";
    expect((await call("POST", `${url}/revoke`, "uid-owner")).status).toBe(200);
    expect((await repo.getInvitation("inv-a")).revokedAt).toBeTruthy();
    const res = await call("POST", `${url}/reissue`, "uid-owner");
    expect(res.status).toBe(200);
    const stored = await repo.getInvitation("inv-a");
    expect(stored.revokedAt).toBeNull();
    expect(stored.tokenHash).toBe(
      hashToken(res.body.path.replace("/i#", ""), SECRET),
    );
    expect(stored.tokenHash).not.toBe(hashToken("tok-a", SECRET));
  });

  it("will not act on an invitation from another event", async () => {
    const { call } = setup();
    const res = await call(
      "POST",
      "/api/admin/events/ev-set/invitations/missing/revoke",
      "uid-owner",
    );
    expect(res.status).toBe(404);
  });
});

describe("bookings, close and reopen", () => {
  it("searches by name without exposing dietary notes in the list", async () => {
    const { call } = setup();
    const hit = await call(
      "GET",
      "/api/admin/events/ev-set/bookings?q=alex",
      "uid-owner",
    );
    expect(hit.body.bookings).toHaveLength(1);
    expect(JSON.stringify(hit.body)).not.toContain("No nuts");
    const miss = await call(
      "GET",
      "/api/admin/events/ev-set/bookings?q=zzz",
      "uid-owner",
    );
    expect(miss.body.bookings).toHaveLength(0);
  });

  it("returns a booking with its attributed history", async () => {
    const { call, repo } = setup();
    await repo.addAudit({
      actor: "invitation:inv-a",
      action: "booking.submitted",
      entity: "booking",
      entityId: "inv-a",
      timestamp: "2029-11-20T00:00:00Z",
    });
    const res = await call(
      "GET",
      "/api/admin/events/ev-set/bookings/inv-a",
      "uid-owner",
    );
    expect(res.body.booking.diners[0].dietaryNotes).toBe("No nuts");
    expect(res.body.history).toEqual([
      expect.objectContaining({
        action: "booking.submitted",
        actor: "Invitee",
      }),
    ]);
  });

  it("closes an event and reopens it with a validated new deadline", async () => {
    const { call, repo } = setup();
    await call("POST", "/api/admin/events/ev-set/close", "uid-owner");
    expect((await repo.getEvent("ev-set")).status).toBe("closed");
    const past = await call(
      "POST",
      "/api/admin/events/ev-set/reopen",
      "uid-owner",
      {
        orderDeadline: "2020-01-01T00:00:00Z",
      },
    );
    expect(past.status).toBe(422);
    const future = await call(
      "POST",
      "/api/admin/events/ev-set/reopen",
      "uid-owner",
      {
        orderDeadline: "2030-06-01T00:00:00Z",
      },
    );
    expect(future.status).toBe(200);
    const event = await repo.getEvent("ev-set");
    expect(event.status).toBe("open");
    expect(event.orderDeadline).toBe("2030-06-01T00:00:00Z");
    expect(repo.audit.map((a) => a.action)).toEqual(
      expect.arrayContaining(["event.closed", "event.reopened"]),
    );
  });
});

describe("exports", () => {
  it("serves CSV downloads, audits them and keeps dietary notes to the restaurant export", async () => {
    const { call, repo } = setup();
    const attendance = await call(
      "GET",
      "/api/admin/events/ev-set/exports/attendance",
      "uid-owner",
    );
    expect(attendance.headers["Content-Type"]).toContain("text/csv");
    expect(attendance.headers["Content-Disposition"]).toContain("attachment");
    expect(attendance.text).not.toContain("No nuts");
    const restaurant = await call(
      "GET",
      "/api/admin/events/ev-set/exports/restaurant",
      "uid-owner",
    );
    expect(restaurant.text).toContain("No nuts");
    const aggregate = await call(
      "GET",
      "/api/admin/events/ev-set/exports/aggregate",
      "uid-owner",
    );
    expect(aggregate.text).toContain("Soup");
    expect(
      repo.audit.filter((a) => a.action === "export.generated"),
    ).toHaveLength(3);
    expect(JSON.stringify(repo.audit)).not.toContain("Alex");
    expect(
      (await call("GET", "/api/admin/events/ev-set/exports/nope", "uid-owner"))
        .status,
    ).toBe(404);
  });
});

describe("retention and deletion", () => {
  it("computes the delete-after date only when start and window are known", () => {
    expect(
      retentionDeleteAfter({ ...setMealEvent, startAt: undefined }),
    ).toBeNull();
    expect(
      retentionDeleteAfter({
        ...setMealEvent,
        startAt: "2030-01-01T00:00:00Z",
        retentionDays: 30,
      }),
    ).toBe("2030-01-31T00:00:00.000Z");
    expect(
      retentionDue(
        {
          ...setMealEvent,
          status: "open",
          startAt: "2020-01-01T00:00:00Z",
          retentionDays: 1,
        },
        new Date(nowMs),
      ),
    ).toBe(false);
  });

  it("deletes personal data only for a closed event, by an owner, with the title typed", async () => {
    const { call, repo } = setup();
    const url = "/api/admin/events/ev-set/data";
    const body = { confirmTitle: setMealEvent.title };
    expect((await call("DELETE", url, "uid-owner", body)).status).toBe(409);
    await call("POST", "/api/admin/events/ev-set/close", "uid-owner");
    expect((await call("DELETE", url, "uid-helper", body)).status).toBe(403);
    expect(
      (await call("DELETE", url, "uid-owner", { confirmTitle: "wrong" }))
        .status,
    ).toBe(422);
    const res = await call("DELETE", url, "uid-owner", body);
    expect(res.status).toBe(200);
    expect(res.body.removed).toEqual({ bookings: 1, invitations: 1 });
    expect(await repo.listBookings("ev-set")).toHaveLength(0);
    expect(await repo.listInvitations("ev-set")).toHaveLength(0);
    expect((await repo.getEvent("ev-set")).privateDataDeletedAt).toBeTruthy();
  });

  it("purges only closed events whose retention has passed, for owners", async () => {
    const { call, repo } = setup();
    await repo.updateEvent("ev-set", {
      status: "closed",
      startAt: "2029-01-01T00:00:00Z",
      retentionDays: 30,
    });
    expect(
      (await call("POST", "/api/admin/retention/purge", "uid-helper")).status,
    ).toBe(403);
    const res = await call("POST", "/api/admin/retention/purge", "uid-owner");
    expect(res.body.purged).toEqual(["ev-set"]);
    expect(await repo.listBookings("ev-set")).toHaveLength(0);
    // Another organisation's data is never touched.
    expect(await repo.getEvent("ev-b")).toBeTruthy();
    const again = await call("POST", "/api/admin/retention/purge", "uid-owner");
    expect(again.body.purged).toEqual([]);
  });
});
