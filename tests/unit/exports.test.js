import { describe, expect, it } from "vitest";
import {
  aggregateCsv,
  attendanceCsv,
  buildSummary,
  eventCounts,
  restaurantCsv,
} from "../../shared/exports.js";
import { setMealEvent, setMealMenu } from "../fixtures.js";

const sel = (menuItemId, nameSnapshot, sectionSnapshot, extra = {}) => ({
  menuItemId,
  nameSnapshot,
  sectionSnapshot,
  quantity: 1,
  ...extra,
});

const booking = (invitationId, overrides = {}) => ({
  invitationId,
  attendance: "yes",
  status: "submitted",
  confirmationId: `MM-${invitationId.toUpperCase()}`,
  contactName: `Contact ${invitationId}`,
  diners: [],
  ...overrides,
});

const invitations = [
  { id: "a", eventId: "ev-set", displayName: "Invitee A", status: "issued" },
  { id: "b", eventId: "ev-set", displayName: "Invitee B", status: "issued" },
  { id: "c", eventId: "ev-set", displayName: "Invitee C", status: "issued" },
  { id: "d", eventId: "ev-set", displayName: "Invitee D", status: "issued" },
  {
    id: "e",
    eventId: "ev-set",
    displayName: "Invitee E",
    status: "issued",
    revokedAt: "2029-01-01T00:00:00Z",
  },
];

const bookings = [
  booking("a", {
    diners: [
      {
        name: "=HYPERLINK(1)",
        dietaryNotes: "No nuts, please",
        selections: [
          sel("soup", "Soup", "Starters"),
          sel("roast", "Roast", "Mains", { optionIds: ["gravy"] }),
        ],
      },
      {
        name: "Pat",
        selections: [
          sel("soup", "Soup", "Starters"),
          sel("roast", "Roast", "Mains", { optionIds: ["pepper"] }),
        ],
      },
    ],
  }),
  booking("b", {
    attendance: "no",
    diners: [],
  }),
  booking("c", {
    status: "draft",
    diners: [{ name: "Draft", selections: [] }],
  }),
];

describe("eventCounts", () => {
  it("separates bookings from diners and ignores revoked links", () => {
    expect(eventCounts(invitations, bookings)).toEqual({
      invitations: 4,
      revoked: 1,
      awaitingReply: 1,
      inProgress: 1,
      attendingBookings: 1,
      attendingDiners: 2,
      declined: 1,
    });
  });
});

describe("summary and exports", () => {
  const summary = buildSummary(setMealEvent, setMealMenu, bookings);

  it("includes only submitted, attending bookings", () => {
    expect(summary.totals).toMatchObject({ bookings: 1, diners: 2, items: 4 });
  });

  it("aggregate quantities reconcile exactly with the per-diner rows", () => {
    const perDiner = summary.bookings
      .flatMap((b) => b.diners)
      .flatMap((d) => d.items)
      .reduce((n, i) => n + i.quantity, 0);
    const aggregate = summary.byItem.reduce((n, i) => n + i.quantity, 0);
    expect(aggregate).toBe(perDiner);
    expect(summary.byItem).toContainEqual(
      expect.objectContaining({ name: "Soup", quantity: 2 }),
    );
    expect(summary.byItem).toContainEqual(
      expect.objectContaining({ name: "Roast", options: "Gravy", quantity: 1 }),
    );
    expect(summary.byItem).toContainEqual(
      expect.objectContaining({
        name: "Roast",
        options: "Pepper",
        quantity: 1,
      }),
    );
  });

  it("escapes formula-like names in every CSV", () => {
    expect(restaurantCsv(summary)).toContain(",'=HYPERLINK(1),");
    expect(attendanceCsv(invitations, bookings)).toContain("'=HYPERLINK(1)");
  });

  it("keeps dietary notes out of the attendance and aggregate exports", () => {
    expect(attendanceCsv(invitations, bookings)).not.toContain("No nuts");
    expect(aggregateCsv(summary)).not.toContain("No nuts");
    expect(restaurantCsv(summary)).toContain("No nuts, please");
  });

  it("labels every reply state in the attendance export", () => {
    const csv = attendanceCsv(invitations, bookings);
    for (const label of [
      "Attending",
      "Not attending",
      "In progress",
      "No reply yet",
      "Link revoked",
    ])
      expect(csv).toContain(label);
  });

  it("reports an estimated total only when prices are shown or fixed", () => {
    const unpriced = {
      ...setMealEvent,
      fixedPricePerPersonMinor: undefined,
      showPrices: false,
    };
    expect(
      buildSummary(unpriced, setMealMenu, bookings).totals,
    ).not.toHaveProperty("estimatedTotalMinor");
    expect(
      buildSummary({ ...unpriced, showPrices: true }, setMealMenu, bookings)
        .totals,
    ).toHaveProperty("estimatedTotalMinor");
    expect(summary.totals.estimatedTotalMinor).toBe(
      2 * (setMealEvent.fixedPricePerPersonMinor ?? 0),
    );
  });
});
