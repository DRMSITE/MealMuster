// Runs against the Firestore emulator only (see `npm run test:integration`).
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../functions/src/app.js";
import { createFirestoreRepo } from "../../functions/src/firestore-repo.js";
import { generateToken, hashToken } from "../../functions/src/security.js";
import { setMealEvent, setMealMenu } from "../fixtures.js";

const SECRET = "integration-secret";
const ORIGIN = "https://mealmuster.test";
const now = () => new Date("2029-12-01T00:00:00Z");

/** @type {ReturnType<typeof createApp>} */
let app;
/** @type {import("firebase-admin/firestore").Firestore} */
let db;
const tokens = { a: generateToken(), b: generateToken() };

const call = (method, path, { body, session } = {}) =>
  app({
    method,
    path,
    body,
    ip: "198.51.100.7",
    headers: {
      origin: ORIGIN,
      ...(session
        ? { cookie: session.cookie, "x-csrf-token": session.csrf }
        : {}),
    },
  });

async function login(token) {
  const res = await call("POST", "/api/invitations/redeem", {
    body: { token },
  });
  expect(res.status).toBe(204);
  const cookie = res.headers["Set-Cookie"].split(";")[0];
  const me = await call("GET", "/api/session", { session: { cookie } });
  return { cookie, csrf: me.body.csrfToken };
}

const diner = (id, name, isContact = false) => ({
  id,
  name,
  isContact,
  selections: [
    { menuItemId: "soup", quantity: 1 },
    { menuItemId: "roast", quantity: 1, optionIds: ["gravy"] },
  ],
});
const party = (size) => ({
  version: 0,
  attendance: "yes",
  contactName: "Alex Example",
  diners: Array.from({ length: size }, (_, i) =>
    diner(`d${i}`, `Diner ${i}`, i === 0),
  ),
});

beforeAll(async () => {
  if (!process.env.FIRESTORE_EMULATOR_HOST)
    throw new Error(
      "Run via firebase emulators:exec; refusing to touch a live project.",
    );
  db = getFirestore(initializeApp({ projectId: "demo-mealmuster" }));
  const event = { ...setMealEvent, capacity: 4, guestLimit: 5 };
  await db.collection("events").doc(event.id).set(event);
  await db.collection("menus").doc(setMealMenu.id).set(setMealMenu);
  for (const [id, token] of [
    ["inv-a", tokens.a],
    ["inv-b", tokens.b],
  ]) {
    await db
      .collection("invitations")
      .doc(id)
      .set({
        eventId: event.id,
        status: "issued",
        tokenHash: hashToken(token, SECRET),
        issuedAt: "2029-11-01T00:00:00Z",
      });
  }
  app = createApp(createFirestoreRepo(db), {
    secret: SECRET,
    allowedOrigins: [ORIGIN],
    now,
  });
});

describe("Firestore-backed booking API", () => {
  it("never stores the raw token", async () => {
    const dump = JSON.stringify(
      (await db.collection("invitations").get()).docs.map((d) => d.data()),
    );
    expect(dump).not.toContain(tokens.a);
  });

  it("allows only one of two concurrent writes with the same version", async () => {
    const session = await login(tokens.a);
    const results = await Promise.all([
      call("PUT", "/api/booking", { session, body: party(2) }),
      call("PUT", "/api/booking", { session, body: party(2) }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    const bookings = await db
      .collection("events")
      .doc("ev-set")
      .collection("bookings")
      .get();
    expect(bookings.size).toBe(1);
    expect(bookings.docs[0].data().version).toBe(1);
  });

  it("enforces capacity across bookings transactionally", async () => {
    const a = await login(tokens.a);
    const b = await login(tokens.b);
    const first = await call("PUT", "/api/booking", {
      session: a,
      body: { ...party(3), version: 1 },
    });
    expect(first.status).toBe(200); // 3 of 4 places
    const second = await call("PUT", "/api/booking", {
      session: b,
      body: party(2),
    });
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe("capacity_reached");
  });

  it("submits idempotently and keeps a single stored order", async () => {
    const session = await login(tokens.a);
    const one = await call("POST", "/api/booking/submit", { session });
    const two = await call("POST", "/api/booking/submit", { session });
    expect(one.status).toBe(200);
    expect(two.body.confirmationId).toBe(one.body.confirmationId);
    expect(
      (await db.collection("events").doc("ev-set").collection("bookings").get())
        .size,
    ).toBe(1);
  });

  it("does not let invitee B see invitee A's booking", async () => {
    const session = await login(tokens.b);
    const res = await call("GET", "/api/booking?invitationId=inv-a", {
      session,
    });
    expect(res.body.booking).toBeNull();
  });

  it("keeps names and notes out of audit documents", async () => {
    const dump = JSON.stringify(
      (await db.collection("auditEvents").get()).docs.map((d) => d.data()),
    );
    expect(dump).not.toMatch(/Alex Example|Diner \d/);
    expect(dump).not.toContain(tokens.a);
  });
});

describe("organiser data access in Firestore", () => {
  const repo = () => createFirestoreRepo(db);

  it("finds memberships and only the events of an organisation", async () => {
    await db.collection("memberships").doc("org-int_user-int").set({
      userId: "user-int",
      organisationId: "org-int",
      role: "owner",
    });
    await db
      .collection("events")
      .doc("ev-int")
      .set({ organisationId: "org-int", title: "Integration event" });
    await db
      .collection("events")
      .doc("ev-int-other")
      .set({ organisationId: "org-int-other", title: "Not yours" });
    expect(await repo().getMemberships("user-int")).toEqual([
      expect.objectContaining({ organisationId: "org-int", role: "owner" }),
    ]);
    expect((await repo().listEvents("org-int")).map((e) => e.id)).toEqual([
      "ev-int",
    ]);
  });

  it("creates invitations, lists audit history in order and deletes an event's private data", async () => {
    const r = repo();
    await r.createInvitation({
      id: "inv-int-1",
      eventId: "ev-int",
      displayName: "Integration",
      status: "issued",
      tokenHash: "hash",
      issuedAt: "2029-11-01T00:00:00Z",
    });
    await r.createInvitation({
      id: "inv-int-keep",
      eventId: "ev-int-other",
      displayName: "Other event",
      status: "issued",
      tokenHash: "hash2",
      issuedAt: "2029-11-01T00:00:00Z",
    });
    await db
      .collection("events")
      .doc("ev-int")
      .collection("bookings")
      .doc("inv-int-1")
      .set({ eventId: "ev-int", invitationId: "inv-int-1", diners: [] });
    await r.addAudit({ entityId: "inv-int-1", timestamp: "2", action: "b" });
    await r.addAudit({ entityId: "inv-int-1", timestamp: "1", action: "a" });

    expect((await r.listAudit("inv-int-1")).map((a) => a.action)).toEqual([
      "a",
      "b",
    ]);
    expect(await r.listInvitations("ev-int")).toHaveLength(1);
    expect(await r.listBookings("ev-int")).toHaveLength(1);

    expect(await r.deleteEventPrivateData("ev-int")).toEqual({
      bookings: 1,
      invitations: 1,
    });
    expect(await r.listInvitations("ev-int")).toHaveLength(0);
    expect(await r.listBookings("ev-int")).toHaveLength(0);
    // Another event's data is untouched.
    expect(await r.listInvitations("ev-int-other")).toHaveLength(1);
  });
});

describe("Firestore security rules", () => {
  // Plain REST calls carry no admin credentials, so the rules apply to them
  // exactly as they would to a browser using a leaked web API key.
  const documents = () =>
    `http://${process.env.FIRESTORE_EMULATOR_HOST}/v1/projects/demo-mealmuster/databases/(default)/documents`;

  it.each([
    "events",
    "menus",
    "venues",
    "invitations",
    "memberships",
    "auditEvents",
    "events/ev-int/bookings",
  ])("denies anonymous reads and writes of %s", async (collection) => {
    const read = await fetch(`${documents()}/${collection}`);
    expect(read.status).toBe(403);
    const create = await fetch(`${documents()}/${collection}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fields: { x: { stringValue: "1" } } }),
    });
    expect(create.status).toBe(403);
  });

  it("denies reading a known document by id", async () => {
    await db.collection("invitations").doc("rules-probe").set({ eventId: "e" });
    const res = await fetch(`${documents()}/invitations/rules-probe`);
    expect(res.status).toBe(403);
  });
});
