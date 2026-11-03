import { describe, expect, it } from "vitest";
import { createApp } from "../../functions/src/app.js";
import { createMemoryRepo } from "../../functions/src/memory-repo.js";
import {
  buildExampleDraft,
  loadExampleDraftDocument,
} from "../../seed/example-event.js";
import {
  approveMenu,
  canSendInvitations,
  invitationBlockers,
} from "../../shared/menu-lifecycle.js";
import { orderingGate } from "../../shared/ordering.js";

const NOW = new Date("2026-11-02T09:00:00Z");
const ORIGIN = "https://mealmuster.test";

describe("Sample Kitchen draft (unapproved)", () => {
  const { menu, event, venue } = buildExampleDraft();
  const doc = loadExampleDraftDocument();
  const items = menu.sections.flatMap((s) => s.items);

  it("imports every transcribed item, section and printed tag exactly", () => {
    const source = doc.sections.flatMap((s) => s.items);
    expect(menu.sections.map((s) => s.name)).toEqual(
      doc.sections.map((s) => s.name),
    );
    expect(items.map((i) => i.name)).toEqual(source.map((i) => i.name));
    expect(items.map((i) => i.tags)).toEqual(source.map((i) => i.printedTags));
    expect(items.map((i) => i.printedPriceMinor)).toEqual(
      source.map((i) => i.printedPriceMinor),
    );
    expect(new Set(items.map((i) => i.id)).size).toBe(items.length);
    expect(menu.importWarning).toMatch(/not a confirmed Christmas/i);
  });

  it("never turns a takeaway price into an orderable price", () => {
    expect(items.every((i) => i.priceMinor === undefined)).toBe(true);
    expect(event.showPrices).toBe(false);
    expect(event.fixedPricePerPersonMinor).toBeUndefined();
  });

  it("is a draft with every item still needing manual review", () => {
    expect(menu.status).toBe("draft");
    expect(menu.approvedAt).toBeUndefined();
    expect(items.every((i) => i.verification === "needs-manual-review")).toBe(
      true,
    );
    expect(items.every((i) => i.allergenInfoStatus === "unverified")).toBe(
      true,
    );
  });

  it("leaves everything unconfirmed unset rather than inventing it", () => {
    expect(event).toMatchObject({
      status: "draft",
      orderingMode: "a_la_carte",
    });
    for (const key of [
      "startAt",
      "rsvpDeadline",
      "orderDeadline",
      "capacity",
      "guestLimit",
      "organiserContact",
      "retentionDays",
    ])
      expect(event[key]).toBeUndefined();
    expect(venue.address).toBe("1 Example Street, Exampletown, EX1 1AA");
  });

  it("blocks ordering and invitations, and cannot be approved", () => {
    expect(orderingGate(event, menu, NOW)).toEqual({
      open: false,
      reason: "event_not_open",
    });
    expect(orderingGate({ ...event, status: "open" }, menu, NOW).open).toBe(
      false,
    );
    expect(canSendInvitations(event, menu)).toBe(false);
    expect(invitationBlockers(event, menu)).toEqual(
      expect.arrayContaining([
        "The menu has not been approved",
        "Event date and time is not set",
        "Organiser contact is not set",
        "RSVP deadline is not set",
        "Order deadline is not set",
      ]),
    );
    expect(() => approveMenu(menu, { approvedBy: "x", now: NOW })).toThrow(
      new RegExp(`${items.length} item\\(s\\) still need manual review`),
    );
  });
});

describe("organiser workflow on a copy of the Example draft", () => {
  const memberships = [
    { userId: "uid-owner", organisationId: "example-club", role: "owner" },
    { userId: "uid-other", organisationId: "someone-else", role: "owner" },
  ];

  const count = buildExampleDraft().menu.sections.flatMap(
    (s) => s.items,
  ).length;

  function setup() {
    const { menu, event } = buildExampleDraft();
    const repo = createMemoryRepo({
      events: [event],
      menus: [menu],
      memberships,
    });
    const app = createApp(repo, {
      secret: "test-secret-not-for-production",
      allowedOrigins: [ORIGIN],
      now: () => NOW,
      verifyIdToken: async (t) => (t.startsWith("uid-") ? { uid: t } : null),
    });
    const base = `/api/admin/events/${event.id}`;
    const call = (method, path, body, as = "uid-owner") =>
      app({
        method,
        path: `${base}${path}`,
        body,
        headers: { authorization: `Bearer ${as}` },
      });
    return { repo, call, menu };
  }

  it("refuses links, opening and approval while the draft is unchecked", async () => {
    const { call, repo } = setup();
    const link = await call("POST", "/invitations", { displayName: "Sam" });
    expect(link.status).toBe(409);
    expect(link.body.error.code).toBe("invitations_blocked");
    expect((await call("POST", "/reopen")).status).toBe(409);
    const approve = await call("POST", "/menu/approve");
    expect(approve.status).toBe(409);
    expect(approve.body.error.code).toBe("menu_has_unverified_items");
    expect((await repo.getMenu("sample-kitchen-draft-menu")).status).toBe(
      "draft",
    );
    expect(
      await repo.listInvitations("example-club-sample-kitchen"),
    ).toHaveLength(0);
  });

  it("reports what still needs organiser input", async () => {
    const { call } = setup();
    const { body } = await call("GET", "/overview");
    const todo = body.readiness.filter((r) => r.required && !r.done);
    expect(todo.map((r) => r.id)).toEqual(
      expect.arrayContaining([
        "startAt",
        "organiserContact",
        "rsvpDeadline",
        "orderDeadline",
        "menuChecked",
        "menuApproved",
      ]),
    );
    expect(body.readiness.find((r) => r.id === "menuChecked").detail).toBe(
      `${count} of ${count} items still need checking`,
    );
  });

  it("keeps another organisation out of the menu routes", async () => {
    const { call } = setup();
    for (const [method, path] of [
      ["GET", "/menu"],
      ["POST", "/menu/review"],
      ["POST", "/menu/approve"],
      ["PATCH", ""],
    ])
      expect(
        (await call(method, path, { items: [], title: "x" }, "uid-other"))
          .status,
      ).toBe(403);
  });

  it("can be completed by an organiser: check items, approve, set details, then links work", async () => {
    const { call, repo, menu } = setup();
    const ids = menu.sections.flatMap((s) => s.items).map((i) => i.id);

    // Correct one item and mark one as not offered, as the venue may say.
    const review = await call("POST", "/menu/review", {
      items: ids.map((id, index) => ({
        id,
        verified: true,
        ...(index === 0 ? { name: "Sample Nibbles (large)" } : {}),
        ...(index === 1 ? { available: false } : {}),
      })),
    });
    expect(review.status).toBe(200);
    const reviewed = await repo.getMenu(menu.id);
    expect(reviewed.sections[0].items[0].name).toBe("Sample Nibbles (large)");
    expect(reviewed.sections[0].items[1].available).toBe(false);
    // The original printed price survives edits.
    expect(reviewed.sections[0].items[0].printedPriceMinor).toBe(399);

    expect((await call("POST", "/menu/approve")).status).toBe(200);
    const approved = await repo.getMenu(menu.id);
    expect(approved).toMatchObject({
      status: "approved",
      approvedBy: "uid-owner",
    });

    // An approved menu can no longer be edited.
    const late = await call("POST", "/menu/review", {
      items: [{ id: ids[2], name: "Changed after approval" }],
    });
    expect(late.status).toBe(422);

    // Still blocked: the event details are unconfirmed.
    expect(
      (await call("POST", "/invitations", { displayName: "Sam" })).status,
    ).toBe(409);

    const settings = await call("PATCH", "", {
      startAt: "2026-12-12T18:30:00Z",
      organiserContact: "organiser@example.test",
      rsvpDeadline: "2026-11-30T12:00:00Z",
      orderDeadline: "2026-12-01T12:00:00Z",
    });
    expect(settings.status).toBe(200);
    expect((await call("POST", "/reopen")).status).toBe(200);
    const link = await call("POST", "/invitations", { displayName: "Sam" });
    expect(link.status).toBe(201);
    const actions = repo.audit.map((a) => a.action);
    expect(actions).toEqual(
      expect.arrayContaining([
        "menu.reviewed",
        "menu.approved",
        "event.settings_changed",
        "invitation.created",
      ]),
    );
    // Audit holds field names and counts, never the values entered.
    expect(JSON.stringify(repo.audit)).not.toContain("organiser@example.test");
    expect(JSON.stringify(repo.audit)).not.toContain("Sample Nibbles");
  });

  it("cannot approve a menu that offers nothing", async () => {
    const { call, menu } = setup();
    const ids = menu.sections.flatMap((s) => s.items).map((i) => i.id);
    await call("POST", "/menu/review", {
      items: ids.map((id) => ({ id, verified: true, available: false })),
    });
    const res = await call("POST", "/menu/approve");
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("menu_empty");
  });
});
