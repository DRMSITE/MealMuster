// @ts-check
// Fictitious demo data for the emulators. No real people, venues or prices.
import { generateToken, hashToken } from "../functions/src/security.js";

const FAR_FUTURE = "2099-01-01T12:00:00Z";

/**
 * Hostile text for security tests. Every value is plain text that must be
 * displayed literally and must never run: `window.__xss` is set if it does.
 */
export const HOSTILE = {
  image: '<img src=x onerror="window.__xss=1">',
  script: "<script>window.__xss=2</script>",
  svg: '"><svg onload=window.__xss=3>',
  link: "javascript:window.__xss=4",
};

/**
 * Organiser accounts for the Auth emulator only. The password is a fixed,
 * non-secret value that only works against the local emulator.
 */
export const DEMO_PASSWORD = "emulator-only-password";
export const DEMO_ORGANISERS = [
  {
    uid: "demo-owner",
    email: "owner@example.test",
    organisationId: "demo-org",
    role: "owner",
  },
  {
    uid: "demo-helper",
    email: "helper@example.test",
    organisationId: "demo-org",
    role: "organiser",
  },
  {
    uid: "demo-outsider",
    email: "outsider@example.test",
    organisationId: "other-demo-org",
    role: "owner",
  },
];

/** @param {string} id @param {string} name @param {Partial<import("../shared/types.js").MenuItem>} [extra] @returns {import("../shared/types.js").MenuItem} */
const item = (id, name, extra = {}) => ({
  id,
  name,
  tags: [],
  allergenInfoStatus: "unverified",
  available: true,
  sortOrder: 1,
  ...extra,
});

/** @type {import("../shared/types.js").Menu} */
export const demoSetMenu = {
  id: "demo-menu-set",
  organisationId: "demo-org",
  title: "Demo set menu",
  status: "approved",
  currency: "GBP",
  sections: [
    {
      id: "starters",
      name: "Starters",
      order: 1,
      sectionType: "course",
      items: [
        item("soup", "Demo soup"),
        item("salad", "Demo salad", { tags: ["V"] }),
      ],
    },
    {
      id: "mains",
      name: "Mains",
      order: 2,
      sectionType: "course",
      items: [
        item("roast", "Demo roast", {
          optionGroups: [
            {
              id: "sauce",
              title: "Sauce",
              min: 1,
              max: 1,
              choices: [
                { id: "gravy", title: "Gravy" },
                { id: "mustard", title: "Mustard" },
              ],
            },
          ],
        }),
        item("pie", "Demo pie"),
        item("risotto", "Demo risotto", { tags: ["V", "GF"] }),
      ],
    },
  ],
};

/** @type {import("../shared/types.js").Menu} */
export const demoDraftMenu = {
  id: "demo-menu-draft",
  organisationId: "demo-org",
  title: "Demo draft menu (unapproved)",
  status: "draft",
  currency: "GBP",
  sections: [
    {
      id: "all",
      name: "All items",
      order: 1,
      sectionType: "category",
      items: [
        item("curry", "Demo curry", {
          priceMinor: 1000,
          verification: "needs-manual-review",
        }),
      ],
    },
  ],
};

/** @type {import("../shared/types.js").EventConfig} */
const baseEvent = {
  id: "demo-event-set",
  organisationId: "demo-org",
  title: "Demo Club Dinner",
  description: "A fictitious event used for local testing.",
  status: "open",
  orderingMode: "set_meal",
  currency: "GBP",
  menuId: "demo-menu-set",
  venueId: "demo-venue",
  timezone: "Europe/London",
  startAt: "2099-01-10T18:00:00Z",
  organiserContact: "organiser@example.test",
  retentionDays: 30,
  rsvpDeadline: FAR_FUTURE,
  orderDeadline: FAR_FUTURE,
  guestLimit: 3,
  allowContactNotAttending: false,
  showPrices: false,
  rules: [
    {
      sectionId: "starters",
      minSelections: 1,
      maxSelections: 1,
      required: true,
      perDiner: true,
    },
    {
      sectionId: "mains",
      minSelections: 1,
      maxSelections: 1,
      required: true,
      perDiner: true,
    },
  ],
};

/**
 * Writes demo data and returns the raw invitation tokens (printed only to the
 * caller; the database holds hashes).
 * @param {import("firebase-admin/firestore").Firestore} db @param {string} secret
 */
export async function seedDemo(db, secret) {
  const events = [
    baseEvent,
    {
      ...baseEvent,
      id: "demo-event-draft",
      title: "Demo Draft-Menu Event",
      menuId: "demo-menu-draft",
      orderingMode: /** @type {const} */ ("a_la_carte"),
      rules: [],
    },
  ];
  const extraEvents = [
    {
      ...baseEvent,
      id: "demo-event-hostile",
      title: HOSTILE.image,
      description: HOSTILE.script,
      instructions: HOSTILE.svg,
      organiserContact: HOSTILE.link,
      menuId: "demo-menu-hostile",
      venueId: "demo-venue-hostile",
      orderingMode: /** @type {const} */ ("a_la_carte"),
      rules: [],
      guestLimit: 2,
    },
    {
      ...baseEvent,
      id: "demo-event-other",
      organisationId: "other-demo-org",
      title: "Other Organisation Event",
    },
    ...["desktop", "mobile"].map((project) => ({
      ...baseEvent,
      id: `demo-event-approve-${project}`,
      title: `Demo Approval Event ${project}`,
      status: /** @type {const} */ ("draft"),
      menuId: `demo-menu-approve-${project}`,
      orderingMode: /** @type {const} */ ("a_la_carte"),
      rules: [],
      startAt: undefined,
      organiserContact: undefined,
      rsvpDeadline: undefined,
      orderDeadline: undefined,
    })),
    ...["desktop", "mobile"].map((project) => ({
      ...baseEvent,
      id: `demo-event-retention-${project}`,
      title: `Demo Retention Event ${project}`,
      status: /** @type {const} */ ("closed"),
    })),
  ];
  await db
    .collection("venues")
    .doc("demo-venue")
    .set({ name: "The Demo Hall", address: "1 Example Street, Exampleton" });
  await db
    .collection("venues")
    .doc("demo-venue-hostile")
    .set({ name: HOSTILE.image, address: HOSTILE.svg });
  const approvalMenus = ["desktop", "mobile"].map((project) => ({
    ...demoDraftMenu,
    id: `demo-menu-approve-${project}`,
    title: `Demo approval menu ${project}`,
    sections: [
      {
        id: "all",
        name: "All items",
        order: 1,
        sectionType: /** @type {const} */ ("category"),
        items: ["Demo curry", "Demo dhal", "Demo rice"].map((name, index) =>
          item(`item-${index + 1}`, name, {
            printedPriceMinor: 800,
            verification: "needs-manual-review",
          }),
        ),
      },
    ],
  }));
  /** @type {import("../shared/types.js").Menu} */
  const hostileMenu = {
    id: "demo-menu-hostile",
    organisationId: "demo-org",
    title: HOSTILE.script,
    status: "approved",
    currency: "GBP",
    sections: [
      {
        id: "all",
        name: HOSTILE.script,
        order: 1,
        sectionType: "category",
        items: [
          item("hx1", HOSTILE.image, {
            description: HOSTILE.svg,
            tags: [HOSTILE.link],
            optionGroups: [
              {
                id: "sauce",
                title: HOSTILE.svg,
                min: 0,
                max: 1,
                choices: [{ id: "c1", title: HOSTILE.link }],
              },
            ],
          }),
          item("hx2", HOSTILE.svg),
        ],
      },
    ],
  };
  for (const m of [demoSetMenu, demoDraftMenu, hostileMenu, ...approvalMenus])
    await db
      .collection("menus")
      .doc(m.id)
      .set(JSON.parse(JSON.stringify(m)));
  for (const e of [...events, ...extraEvents])
    await db
      .collection("events")
      .doc(e.id)
      .set(JSON.parse(JSON.stringify(e)));

  const names = [
    "accept-desktop",
    "accept-mobile",
    "decline-desktop",
    "decline-mobile",
    "revoked",
    "draft",
    "isolation-a",
    "isolation-b",
    "hostile-desktop",
    "hostile-mobile",
    "a11y-desktop",
    "a11y-mobile",
    "a11y-keyboard",
  ];
  /** @type {Record<string, string>} */
  const tokens = {};
  for (const name of names) {
    const token = generateToken();
    tokens[name] = token;
    await db
      .collection("invitations")
      .doc(`demo-inv-${name}`)
      .set({
        eventId:
          name === "draft"
            ? "demo-event-draft"
            : name.startsWith("hostile")
              ? "demo-event-hostile"
              : "demo-event-set",
        displayName: name.startsWith("hostile")
          ? `${HOSTILE.image} (${name.slice("hostile-".length)})`
          : `Demo ${name}`,
        status: "issued",
        tokenHash: hashToken(token, secret),
        issuedAt: new Date().toISOString(),
        ...(name === "revoked" ? { revokedAt: new Date().toISOString() } : {}),
      });
  }

  // Organiser data: a submitted booking (with a formula-like name, to prove
  // exports are escaped) and one booking in each retention event.
  const submittedBooking = (
    /** @type {string} */ eventId,
    /** @type {string} */ invitationId,
    /** @type {string} */ confirmationId,
    /** @type {string} */ dinerName,
  ) => ({
    id: invitationId,
    eventId,
    invitationId,
    attendance: "yes",
    contactName: "Report Contact",
    status: "submitted",
    confirmationId,
    submittedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    version: 2,
    diners: [
      {
        id: "d1",
        name: dinerName,
        isContact: true,
        dietaryNotes: "Demo dietary request",
        selections: [
          {
            menuItemId: "soup",
            quantity: 1,
            nameSnapshot: "Demo soup",
            sectionSnapshot: "Starters",
          },
          {
            menuItemId: "pie",
            quantity: 1,
            nameSnapshot: "Demo pie",
            sectionSnapshot: "Mains",
          },
        ],
      },
    ],
  });
  const reports = [
    [
      "demo-event-set",
      "demo-inv-report",
      "MM-REPORT22",
      '=HYPERLINK("http://example.invalid")',
    ],
    [
      "demo-event-retention-desktop",
      "demo-inv-ret-desktop",
      "MM-RETDESK2",
      "Retention Diner",
    ],
    [
      "demo-event-retention-mobile",
      "demo-inv-ret-mobile",
      "MM-RETMOBL2",
      "Retention Diner",
    ],
  ];
  for (const [eventId, invitationId, confirmationId, dinerName] of reports) {
    await db
      .collection("invitations")
      .doc(invitationId)
      .set({
        eventId,
        displayName: `Report ${invitationId}`,
        status: "issued",
        tokenHash: hashToken(generateToken(), secret),
        issuedAt: new Date().toISOString(),
      });
    await db
      .collection("events")
      .doc(eventId)
      .collection("bookings")
      .doc(invitationId)
      .set(submittedBooking(eventId, invitationId, confirmationId, dinerName));
  }
  return tokens;
}

/**
 * Creates the organiser accounts in the Auth emulator and their memberships.
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {import("firebase-admin/auth").Auth} auth
 */
export async function seedOrganisers(db, auth) {
  // The fictitious owner can also view the unapproved Example Social Club draft in the emulator.
  await db.collection("memberships").doc("example-club_demo-owner").set({
    userId: "demo-owner",
    organisationId: "example-club",
    role: "owner",
  });
  for (const o of DEMO_ORGANISERS) {
    await auth.deleteUser(o.uid).catch(() => undefined);
    await auth.createUser({
      uid: o.uid,
      email: o.email,
      password: DEMO_PASSWORD,
    });
    await db.collection("memberships").doc(`${o.organisationId}_${o.uid}`).set({
      userId: o.uid,
      organisationId: o.organisationId,
      role: o.role,
    });
  }
}
