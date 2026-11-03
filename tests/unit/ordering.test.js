import { describe, expect, it } from "vitest";
import { csvCell, toCsv } from "../../shared/csv.js";
import {
  approveMenu,
  canSendInvitations,
  invitationBlockers,
} from "../../shared/menu-lifecycle.js";
import { formatMoney, isMinorUnits } from "../../shared/money.js";
import {
  dinerTotalMinor,
  orderingGate,
  snapshotSelections,
  validateBooking,
} from "../../shared/ordering.js";
import {
  afterDeadline,
  alaCarteEvent,
  alaCarteMenu,
  beforeDeadline,
  rsvpOnlyEvent,
  setMealEvent,
  setMealMenu,
} from "../fixtures.js";

const sel = (menuItemId, extra = {}) => ({ menuItemId, quantity: 1, ...extra });
const setMealDiner = (id, name, isContact = false) => ({
  id,
  name,
  isContact,
  selections: [sel("soup"), sel("roast", { optionIds: ["gravy"] })],
});
const codes = (issues) => issues.map((i) => i.code);

describe("money", () => {
  it("formats pence as pounds and rejects floats", () => {
    expect(formatMoney(1190)).toBe("£11.90");
    expect(() => formatMoney(11.9)).toThrow();
    expect(isMinorUnits(399)).toBe(true);
    expect(isMinorUnits(3.99)).toBe(false);
  });
});

describe("set-meal ordering", () => {
  const booking = {
    attendance: "yes",
    contactName: "Alex Example",
    diners: [
      setMealDiner("d1", "Alex Example", true),
      setMealDiner("d2", "Guest One"),
      setMealDiner("d3", "Guest Two"),
    ],
  };

  it("accepts a contact plus two guests with their own choices", () => {
    booking.diners[1].selections[1] = sel("nutloaf");
    expect(validateBooking(booking, setMealEvent, setMealMenu)).toEqual([]);
  });

  it("rejects over-limit guests", () => {
    const more = {
      ...booking,
      diners: [...booking.diners, setMealDiner("d4", "Guest Three")],
    };
    expect(codes(validateBooking(more, setMealEvent, setMealMenu))).toContain(
      "guest_limit",
    );
  });

  it("enforces required course rules per diner", () => {
    const missing = {
      ...booking,
      diners: [{ ...booking.diners[0], selections: [sel("soup")] }],
    };
    const issues = validateBooking(missing, setMealEvent, setMealMenu);
    expect(issues.find((i) => i.code === "rule_min")?.path).toContain(
      "diners[0]",
    );
  });

  it("rejects unknown and unavailable items, bad quantities and options", () => {
    const bad = {
      ...booking,
      diners: [
        {
          id: "d1",
          name: "A",
          isContact: true,
          selections: [
            sel("nope"),
            sel("pate"),
            sel("soup", { quantity: 0 }),
            sel("roast", { optionIds: ["x"] }),
          ],
        },
      ],
    };
    expect(codes(validateBooking(bad, setMealEvent, setMealMenu))).toEqual(
      expect.arrayContaining([
        "unknown_item",
        "item_unavailable",
        "invalid_quantity",
        "unknown_option",
        "option_count",
      ]),
    );
  });

  it("requires a name for every diner", () => {
    const nameless = {
      ...booking,
      diners: [{ ...setMealDiner("d1", "  ", true) }],
    };
    expect(
      codes(validateBooking(nameless, setMealEvent, setMealMenu)),
    ).toContain("invalid_name");
  });

  it("uses the fixed per-person price, ignoring client values", () => {
    expect(
      dinerTotalMinor(
        { ...booking.diners[0], priceMinor: 1 },
        setMealEvent,
        setMealMenu,
      ),
    ).toBe(2500);
  });
});

describe("a la carte ordering", () => {
  const diner = {
    id: "d1",
    name: "Alex",
    isContact: true,
    selections: [sel("korma", {}), { menuItemId: "naan", quantity: 2 }],
  };

  it("totals from menu prices with quantities", () => {
    expect(dinerTotalMinor(diner, alaCarteEvent, alaCarteMenu)).toBe(1600);
  });

  it("applies option price modifiers", () => {
    const total = dinerTotalMinor(
      { ...diner, selections: [sel("roast", { optionIds: ["pepper"] })] },
      { ...setMealEvent, fixedPricePerPersonMinor: undefined },
      {
        ...setMealMenu,
        sections: setMealMenu.sections.map((s) => ({
          ...s,
          items: s.items.map((i) =>
            i.id === "roast" ? { ...i, priceMinor: 1000 } : i,
          ),
        })),
      },
    );
    expect(total).toBe(1150);
  });

  it("snapshots names and prices so menu edits do not rewrite orders", () => {
    const [snap] = snapshotSelections(
      { attendance: "yes", contactName: "A", diners: [diner] },
      alaCarteMenu,
    );
    expect(snap.selections[0]).toMatchObject({
      nameSnapshot: "Korma",
      sectionSnapshot: "Curries",
      unitPriceSnapshotMinor: 1000,
    });
  });
});

describe("decline and RSVP only", () => {
  it("accepts a decline with no menu details", () => {
    expect(
      validateBooking(
        { attendance: "no", contactName: "Sam", diners: [] },
        setMealEvent,
        setMealMenu,
      ),
    ).toEqual([]);
  });

  it("rejects diners on a decline", () => {
    expect(
      codes(
        validateBooking(
          {
            attendance: "no",
            contactName: "Sam",
            diners: [setMealDiner("d", "X")],
          },
          setMealEvent,
          setMealMenu,
        ),
      ),
    ).toContain("diners_not_allowed");
  });

  it("allows a non-attending contact only when configured", () => {
    const b = {
      attendance: "yes",
      contactName: "Sam",
      diners: [{ id: "g", name: "Guest", isContact: false, selections: [] }],
    };
    const e = { ...rsvpOnlyEvent, allowContactNotAttending: false };
    expect(codes(validateBooking(b, e, undefined))).toContain(
      "contact_must_attend",
    );
    expect(
      validateBooking(b, { ...e, allowContactNotAttending: true }, undefined),
    ).toEqual([]);
  });

  it("rejects selections in RSVP-only mode", () => {
    const b = {
      attendance: "yes",
      contactName: "Sam",
      diners: [
        { id: "g", name: "Sam", isContact: true, selections: [sel("x")] },
      ],
    };
    expect(codes(validateBooking(b, rsvpOnlyEvent, undefined))).toContain(
      "selections_not_allowed",
    );
  });
});

describe("gates", () => {
  it("blocks ordering from an unapproved draft menu", () => {
    const draft = { ...alaCarteMenu, status: "draft" };
    expect(orderingGate(alaCarteEvent, draft, beforeDeadline)).toEqual({
      open: false,
      reason: "menu_not_approved",
    });
  });

  it("enforces deadlines, with an explicit organiser override", () => {
    expect(orderingGate(alaCarteEvent, alaCarteMenu, beforeDeadline).open).toBe(
      true,
    );
    expect(
      orderingGate(alaCarteEvent, alaCarteMenu, afterDeadline).reason,
    ).toBe("deadline_passed");
    expect(
      orderingGate(alaCarteEvent, alaCarteMenu, afterDeadline, {
        organiserOverride: true,
      }).open,
    ).toBe(true);
  });

  it("blocks closed or draft events", () => {
    expect(
      orderingGate(
        { ...alaCarteEvent, status: "draft" },
        alaCarteMenu,
        beforeDeadline,
      ).reason,
    ).toBe("event_not_open");
  });
});

describe("menu approval", () => {
  const draft = { ...alaCarteMenu, status: "draft" };

  it("blocks invitations until the menu is approved", () => {
    expect(canSendInvitations(alaCarteEvent, draft)).toBe(false);
    expect(invitationBlockers(alaCarteEvent, draft)).toContain(
      "The menu has not been approved",
    );
    expect(canSendInvitations(alaCarteEvent, alaCarteMenu)).toBe(true);
  });

  it("refuses approval while items need manual review", () => {
    const flagged = {
      ...draft,
      sections: [
        {
          ...draft.sections[0],
          items: [
            {
              ...draft.sections[0].items[0],
              verification: "needs-manual-review",
            },
          ],
        },
      ],
    };
    expect(() =>
      approveMenu(flagged, { approvedBy: "u1", now: new Date() }),
    ).toThrow(/manual review/);
  });

  it("approves a fully reviewed draft only once", () => {
    const approved = approveMenu(draft, {
      approvedBy: "u1",
      now: new Date("2026-11-01T00:00:00Z"),
    });
    expect(approved).toMatchObject({ status: "approved", approvedBy: "u1" });
    expect(() =>
      approveMenu(approved, { approvedBy: "u1", now: new Date() }),
    ).toThrow();
  });

  it("reports missing deadlines as blockers", () => {
    expect(
      invitationBlockers(
        { ...alaCarteEvent, rsvpDeadline: undefined },
        alaCarteMenu,
      ),
    ).toContain("RSVP deadline is not set");
  });
});

describe("csv", () => {
  it("neutralises formula-like cells", () => {
    for (const v of ["=1+1", "+1", "-1", "@SUM(A1)", "\tx", "\rx"])
      expect(csvCell(v).replace(/^"/, "")).toMatch(/^'/);
  });

  it("quotes commas, quotes and newlines", () => {
    expect(csvCell('a,"b"')).toBe('"a,""b"""');
    expect(
      toCsv([
        ["a", "b c"],
        [1, null],
      ]),
    ).toBe("a,b c\r\n1,\r\n");
  });
});
