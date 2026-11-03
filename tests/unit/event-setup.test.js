import { describe, expect, it } from "vitest";
import {
  isoToZonedLocal,
  isValidTimeZone,
  zonedLocalToIso,
} from "../../shared/datetime.js";
import { validateEventSettings } from "../../shared/event-settings.js";
import { importToMenu } from "../../shared/menu-import.js";
import { reviewMenu } from "../../shared/menu-lifecycle.js";
import { readinessChecklist } from "../../shared/readiness.js";
import { alaCarteEvent, alaCarteMenu, rsvpOnlyEvent } from "../fixtures.js";

const NOW = new Date("2026-11-02T09:00:00Z");

describe("event-timezone dates", () => {
  it("reads winter and summer times in Europe/London", () => {
    expect(zonedLocalToIso("2026-12-12T18:30", "Europe/London")).toBe(
      "2026-12-12T18:30:00.000Z",
    );
    expect(zonedLocalToIso("2027-07-10T18:30", "Europe/London")).toBe(
      "2027-07-10T17:30:00.000Z",
    );
  });

  it("round-trips, and rejects a time that does not exist on a clock-change night", () => {
    const iso = zonedLocalToIso("2027-07-10T18:30", "Europe/London");
    expect(isoToZonedLocal(iso, "Europe/London")).toBe("2027-07-10T18:30");
    expect(zonedLocalToIso("2027-03-28T01:30", "Europe/London")).toBeNull();
  });

  it("rejects malformed text and unknown timezones", () => {
    expect(zonedLocalToIso("tomorrow", "Europe/London")).toBeNull();
    expect(zonedLocalToIso("2027-07-10T18:30", "Mars/Olympus")).toBeNull();
    expect(isValidTimeZone("Europe/London")).toBe(true);
    expect(isValidTimeZone("nope")).toBe(false);
  });
});

describe("validateEventSettings", () => {
  const current = {
    ...alaCarteEvent,
    startAt: undefined,
    rsvpDeadline: undefined,
    orderDeadline: undefined,
  };

  it("accepts a coherent set of details and normalises them", () => {
    const result = validateEventSettings(
      {
        title: "  Club meal  ",
        startAt: "2026-12-12T18:30:00Z",
        rsvpDeadline: "2026-11-30T12:00:00Z",
        orderDeadline: "2026-12-01T12:00:00Z",
        guestLimit: 3,
        capacity: 20,
        retentionDays: 30,
        showPrices: false,
      },
      current,
      NOW,
    );
    expect(result).toMatchObject({
      ok: true,
      changes: { title: "Club meal", guestLimit: 3 },
    });
  });

  it("rejects dates in the past and deadlines after the start", () => {
    const issues = (body) => {
      const r = validateEventSettings(body, current, NOW);
      return r.ok ? [] : r.issues.map((i) => i.path);
    };
    expect(issues({ startAt: "2020-01-01T00:00:00Z" })).toContain("startAt");
    expect(
      issues({
        startAt: "2026-12-12T18:30:00Z",
        orderDeadline: "2026-12-13T00:00:00Z",
      }),
    ).toContain("orderDeadline");
    expect(
      issues({
        rsvpDeadline: "2026-12-05T00:00:00Z",
        orderDeadline: "2026-12-01T00:00:00Z",
      }),
    ).toContain("orderDeadline");
    expect(issues({ startAt: "not a date" })).toContain("startAt");
  });

  it("rejects bad numbers, text and unknown or protected fields", () => {
    const paths = (body) => {
      const r = validateEventSettings(body, current, NOW);
      return r.ok ? [] : r.issues.map((i) => i.path);
    };
    expect(paths({ guestLimit: -1 })).toContain("guestLimit");
    expect(paths({ guestLimit: 1.5 })).toContain("guestLimit");
    expect(paths({ capacity: 0 })).toContain("capacity");
    expect(paths({ retentionDays: "30" })).toContain("retentionDays");
    expect(paths({ title: "   " })).toContain("title");
    expect(paths({ organiserContact: "x".repeat(201) })).toContain(
      "organiserContact",
    );
    expect(paths({ timezone: "Nowhere/Land" })).toContain("timezone");
    expect(paths({ showPrices: "yes" })).toContain("showPrices");
    for (const protectedField of [
      "status",
      "menuId",
      "orderingMode",
      "organisationId",
      "id",
    ])
      expect(paths({ [protectedField]: "x" })).toContain(protectedField);
    expect(paths({})).toContain("");
  });
});

describe("reviewMenu", () => {
  const menu = importToMenu(
    {
      currency: "GBP",
      sections: [
        {
          name: "Mains",
          items: [
            {
              name: "Dish A",
              printedPriceMinor: 700,
              printedTags: ["V"],
              verification: "needs-manual-review",
            },
            {
              name: "Dish B",
              printedTags: [],
              verification: "needs-manual-review",
            },
          ],
        },
      ],
    },
    { id: "m", organisationId: "o" },
  );
  const [a, b] = menu.sections[0].items;

  it("renames, hides and verifies without losing the printed values or mutating the input", () => {
    const result = reviewMenu(menu, [
      { id: a.id, name: " Dish A (large) ", verified: true },
      { id: b.id, available: false },
    ]);
    expect(result.ok).toBe(true);
    const [na, nb] = result.menu.sections[0].items;
    expect(na).toMatchObject({
      name: "Dish A (large)",
      verification: "verified",
      printedPriceMinor: 700,
      tags: ["V"],
    });
    expect(nb).toMatchObject({
      available: false,
      verification: "needs-manual-review",
    });
    expect(a.name).toBe("Dish A");
    expect(result.changed).toBe(2);
  });

  it("can un-verify an item", () => {
    const verified = reviewMenu(menu, [{ id: a.id, verified: true }]).menu;
    const undone = reviewMenu(verified, [{ id: a.id, verified: false }]).menu;
    expect(undone.sections[0].items[0].verification).toBe(
      "needs-manual-review",
    );
  });

  it("rejects unknown ids, bad values, empty requests and non-draft menus", () => {
    expect(reviewMenu(menu, [{ id: "nope", verified: true }]).ok).toBe(false);
    expect(reviewMenu(menu, [{ id: a.id, name: "" }]).ok).toBe(false);
    expect(reviewMenu(menu, [{ id: a.id, name: "x".repeat(201) }]).ok).toBe(
      false,
    );
    expect(reviewMenu(menu, [{ id: a.id, available: "no" }]).ok).toBe(false);
    expect(reviewMenu(menu, [{ id: a.id, verified: "yes" }]).ok).toBe(false);
    expect(reviewMenu(menu, []).ok).toBe(false);
    expect(reviewMenu(menu, "x").ok).toBe(false);
    expect(
      reviewMenu({ ...menu, status: "approved" }, [
        { id: a.id, verified: true },
      ]).ok,
    ).toBe(false);
  });
});

describe("importToMenu", () => {
  it("refuses an invalid document", () => {
    expect(() =>
      importToMenu(
        { currency: "GBP", sections: [] },
        { id: "m", organisationId: "o" },
      ),
    ).toThrow(/invalid/);
  });
});

describe("readinessChecklist", () => {
  it("lists required items as outstanding until they are supplied", () => {
    const todo = readinessChecklist(
      { ...alaCarteEvent, startAt: undefined, organiserContact: undefined },
      { ...alaCarteMenu, status: "draft" },
    )
      .filter((i) => i.required && !i.done)
      .map((i) => i.id);
    expect(todo).toEqual(["startAt", "organiserContact", "menuApproved"]);
  });

  it("needs no menu items for an RSVP-only event", () => {
    const ids = readinessChecklist(rsvpOnlyEvent, undefined).map((i) => i.id);
    expect(ids).not.toContain("menuApproved");
    expect(ids).not.toContain("orderDeadline");
  });
});
