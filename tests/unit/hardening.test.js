import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createApp } from "../../functions/src/app.js";
import { createMemoryRepo } from "../../functions/src/memory-repo.js";
import {
  createRateLimiter,
  generateToken,
  hashToken,
} from "../../functions/src/security.js";
import { setMealEvent, setMealMenu } from "../fixtures.js";

const SECRET = "test-secret-not-for-production";
const ORIGIN = "https://mealmuster.test";
let nowMs = Date.parse("2029-12-01T00:00:00Z");

const verifyIdToken = async (t) => (t.startsWith("uid-") ? { uid: t } : null);
const memberships = [
  { userId: "uid-owner", organisationId: "org-a", role: "owner" },
];

function build(repoSeed = {}, config = {}) {
  const repo = createMemoryRepo({
    events: [setMealEvent],
    menus: [setMealMenu],
    memberships,
    ...repoSeed,
  });
  const app = createApp(repo, {
    secret: SECRET,
    allowedOrigins: [ORIGIN],
    now: () => new Date(nowMs),
    verifyIdToken,
    ...config,
  });
  return { repo, app };
}

const admin = (app, method, path, { as, ip = "203.0.113.1", body } = {}) =>
  app({
    method,
    path: `/api/admin${path}`,
    body,
    ip,
    headers: as ? { authorization: `Bearer ${as}` } : {},
  });

describe("organiser API abuse limits", () => {
  it("locks out a client address after repeated failed sign-ins, before verifying more tokens", async () => {
    let verifications = 0;
    const { app } = build(
      {},
      {
        adminFailureLimit: 5,
        verifyIdToken: async (t) => {
          verifications += 1;
          return verifyIdToken(t);
        },
      },
    );
    for (let i = 0; i < 5; i += 1)
      expect(
        (await admin(app, "GET", "/events", { as: "bad-token" })).status,
      ).toBe(401);
    const blocked = await admin(app, "GET", "/events", { as: "bad-token" });
    expect(blocked.status).toBe(429);
    expect(blocked.headers["Retry-After"]).toBeDefined();
    expect(verifications).toBe(5);
    // Even a valid token from that address waits; others are unaffected.
    expect(
      (await admin(app, "GET", "/events", { as: "uid-owner" })).status,
    ).toBe(429);
    expect(
      (
        await admin(app, "GET", "/events", {
          as: "uid-owner",
          ip: "203.0.113.9",
        })
      ).status,
    ).toBe(200);
  });

  it("recovers once the window has passed", async () => {
    const { app } = build({}, { adminFailureLimit: 2 });
    for (let i = 0; i < 3; i += 1)
      await admin(app, "GET", "/events", { as: "bad" });
    expect(
      (await admin(app, "GET", "/events", { as: "uid-owner" })).status,
    ).toBe(429);
    nowMs += 61_000;
    expect(
      (await admin(app, "GET", "/events", { as: "uid-owner" })).status,
    ).toBe(200);
  });

  it("caps the total requests per client address", async () => {
    const { app } = build({}, { adminRequestLimit: 3 });
    const statuses = [];
    for (let i = 0; i < 5; i += 1)
      statuses.push(
        (await admin(app, "GET", "/events", { as: "uid-owner" })).status,
      );
    expect(statuses).toEqual([200, 200, 200, 429, 429]);
  });

  it("keeps limiter memory bounded under a flood of distinct keys", () => {
    const limiter = createRateLimiter({ limit: 1, windowMs: 60_000 });
    const started = performance.now();
    for (let i = 0; i < 40_000; i += 1) limiter.check(`k${i}`, 1000);
    // Each check is cheap even when the map is full (no per-request full scan).
    expect(performance.now() - started).toBeLessThan(1000);
    // The oldest keys were dropped, so an early key is counted afresh.
    expect(limiter.peek("k0", 1000)).toBe(true);
    expect(limiter.peek("k39999", 1000)).toBe(false);
  });
});

describe("hostile input", () => {
  it("answers unknown paths and methods with 404, never 500", async () => {
    const { app } = build();
    for (const [method, path] of [
      ["GET", "/api/__proto__"],
      ["GET", "/api/constructor"],
      ["PATCH", "/api/booking"],
      ["OPTIONS", "/api/booking"],
      ["GET", "/api/admin/__proto__"],
      ["GET", "/api/admin/events/ev-set/__proto__"],
    ]) {
      const res = await app({ method, path, headers: {}, ip: "203.0.113.5" });
      expect([401, 404]).toContain(res.status);
    }
  });

  it("refuses oversized bodies on organiser routes", async () => {
    const { app } = build();
    const res = await admin(app, "POST", "/events/ev-set/invitations", {
      as: "uid-owner",
      body: { displayName: "x".repeat(70_000) },
    });
    expect(res.status).toBe(400);
  });

  it("is not affected by prototype-pollution payloads", async () => {
    const { app } = build();
    const payload = JSON.parse(
      '{"__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}},"title":"Fine"}',
    );
    const res = await admin(app, "PATCH", "/events/ev-set", {
      as: "uid-owner",
      body: payload,
    });
    expect(res.status).toBe(422);
    expect({}.polluted).toBeUndefined();
    const review = await admin(app, "POST", "/events/ev-set/menu/review", {
      as: "uid-owner",
      body: JSON.parse(
        '{"items":[{"id":"soup","__proto__":{"polluted":true}}]}',
      ),
    });
    expect([200, 422]).toContain(review.status);
    expect({}.polluted).toBeUndefined();
  });

  it("treats script-like text as inert data and stores it unchanged", async () => {
    const { app, repo } = build();
    const hostile = '<img src=x onerror="alert(1)"> & "quotes"';
    const res = await admin(app, "POST", "/events/ev-set/invitations", {
      as: "uid-owner",
      body: { displayName: hostile },
    });
    expect(res.status).toBe(201);
    expect(res.body.invitation.displayName).toBe(hostile);
    const stored = (await repo.listInvitations("ev-set")).find(
      (i) => i.displayName === hostile,
    );
    expect(stored).toBeDefined();
  });
});

describe("redeem answers do not reveal which links exist", () => {
  it("gives the same answer for unknown, revoked and expired links", async () => {
    const tokens = { revoked: generateToken(), expired: generateToken() };
    const inv = (id, token, extra) => ({
      id,
      eventId: "ev-set",
      status: "issued",
      tokenHash: hashToken(token, SECRET),
      issuedAt: "2029-11-01T00:00:00Z",
      ...extra,
    });
    const { app } = build({
      invitations: [
        inv("r", tokens.revoked, { revokedAt: "2029-11-02T00:00:00Z" }),
        inv("e", tokens.expired, { tokenExpiry: "2029-11-03T00:00:00Z" }),
      ],
    });
    const answers = [];
    for (const token of [generateToken(), tokens.revoked, tokens.expired]) {
      const res = await app({
        method: "POST",
        path: "/api/invitations/redeem",
        body: { token },
        ip: "203.0.113.7",
        headers: { origin: ORIGIN },
      });
      answers.push(JSON.stringify([res.status, res.body, res.headers]));
    }
    expect(new Set(answers).size).toBe(1);
    expect(answers[0]).toContain("401");
  });
});

describe("audit log privacy across a whole workflow", () => {
  it("never records names, notes, contacts, dietary requests or tokens", async () => {
    const token = generateToken();
    const { app, repo } = build({
      invitations: [
        {
          id: "inv-1",
          eventId: "ev-set",
          displayName: "SENTINEL-LINK-NAME",
          status: "issued",
          tokenHash: hashToken(token, SECRET),
          issuedAt: "2029-11-01T00:00:00Z",
        },
      ],
    });
    const redeem = await app({
      method: "POST",
      path: "/api/invitations/redeem",
      body: { token },
      ip: "203.0.113.20",
      headers: { origin: ORIGIN },
    });
    const cookie = redeem.headers["Set-Cookie"].split(";")[0];
    const me = await app({
      method: "GET",
      path: "/api/session",
      headers: { cookie },
      ip: "203.0.113.20",
    });
    const csrf = me.body.csrfToken;
    const save = await app({
      method: "PUT",
      path: "/api/booking",
      ip: "203.0.113.20",
      headers: { origin: ORIGIN, cookie, "x-csrf-token": csrf },
      body: {
        version: 0,
        attendance: "yes",
        contactName: "SENTINEL-CONTACT",
        partyNotes: "SENTINEL-NOTES",
        diners: [
          {
            id: "d1",
            name: "SENTINEL-DINER",
            isContact: true,
            dietaryNotes: "SENTINEL-DIETARY",
            selections: [
              { menuItemId: "soup", quantity: 1 },
              { menuItemId: "roast", quantity: 1, optionIds: ["gravy"] },
            ],
          },
        ],
      },
    });
    expect(save.status).toBe(200);
    expect(
      (
        await app({
          method: "POST",
          path: "/api/booking/submit",
          ip: "203.0.113.20",
          headers: { origin: ORIGIN, cookie, "x-csrf-token": csrf },
        })
      ).status,
    ).toBe(200);

    const as = "uid-owner";
    await admin(app, "POST", "/events/ev-set/invitations", {
      as,
      body: { displayName: "SENTINEL-NEW-LINK" },
    });
    await admin(app, "POST", "/events/ev-set/invitations/inv-1/revoke", { as });
    await admin(app, "POST", "/events/ev-set/invitations/inv-1/reissue", {
      as,
    });
    await admin(app, "GET", "/events/ev-set/exports/restaurant", { as });
    await admin(app, "PATCH", "/events/ev-set", {
      as,
      body: { organiserContact: "SENTINEL-ORGANISER@example.test" },
    });
    await admin(app, "POST", "/events/ev-set/close", { as });

    expect(repo.audit.length).toBeGreaterThanOrEqual(8);
    const log = JSON.stringify(repo.audit);
    for (const secret of ["SENTINEL", token, cookie, csrf, SECRET, "tokenHash"])
      expect(log).not.toContain(secret);
  });
});

describe("source guards", () => {
  const walk = (dir) =>
    readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      if (name === "shared" && dir.endsWith("src")) return [];
      return statSync(path).isDirectory()
        ? walk(path)
        : path.endsWith(".js")
          ? [path]
          : [];
    });
  const files = [...walk("web/src"), ...walk("functions/src")];

  it("has no unsafe HTML or dynamic-code APIs in application code", () => {
    const banned =
      /\b(innerHTML|outerHTML|insertAdjacentHTML|document\.write|srcdoc)\b|\beval\s*\(|new Function\s*\(|setAttribute\(\s*["']on/;
    const offenders = files.filter((f) => banned.test(readFileSync(f, "utf8")));
    expect(offenders).toEqual([]);
    expect(files.length).toBeGreaterThan(10);
  });

  it("has no hard-coded fallback secret in the deployed function", () => {
    const index = readFileSync("functions/src/index.js", "utf8");
    expect(index).toContain('defineSecret("MEALMUSTER_SECRET")');
    expect(index).not.toMatch(/dev-only|not-for-production/);
  });

  it("never logs request data from the API layer", () => {
    for (const file of ["functions/src/app.js", "functions/src/admin.js"]) {
      const calls =
        readFileSync(file, "utf8").match(/console\.\w+\([^)]*\)/g) ?? [];
      for (const call of calls)
        expect(call).not.toMatch(/req\b|body|headers|cookie/);
    }
  });
});
