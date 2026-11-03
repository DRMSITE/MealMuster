// @ts-check
// Fictitious fixtures only. No real people, venues or prices.

/** @type {import("../shared/types.js").Menu} */
export const setMealMenu = {
  id: "menu-set",
  organisationId: "org-a",
  title: "Example set menu",
  status: "approved",
  currency: "GBP",
  sections: [
    {
      id: "starters",
      name: "Starters",
      order: 1,
      sectionType: "course",
      items: [
        {
          id: "soup",
          name: "Soup",
          priceMinor: 0,
          tags: [],
          allergenInfoStatus: "unverified",
          available: true,
          sortOrder: 1,
        },
        {
          id: "pate",
          name: "Pâté",
          priceMinor: 0,
          tags: [],
          allergenInfoStatus: "unverified",
          available: false,
          sortOrder: 2,
        },
      ],
    },
    {
      id: "mains",
      name: "Mains",
      order: 2,
      sectionType: "course",
      items: [
        {
          id: "roast",
          name: "Roast",
          priceMinor: 0,
          tags: [],
          allergenInfoStatus: "unverified",
          available: true,
          sortOrder: 1,
          optionGroups: [
            {
              id: "sauce",
              title: "Sauce",
              min: 1,
              max: 1,
              choices: [
                { id: "gravy", title: "Gravy" },
                { id: "pepper", title: "Pepper", priceModifierMinor: 150 },
              ],
            },
          ],
        },
        {
          id: "nutloaf",
          name: "Nut loaf",
          priceMinor: 0,
          tags: ["V"],
          allergenInfoStatus: "unverified",
          available: true,
          sortOrder: 2,
        },
      ],
    },
  ],
};

/** @type {import("../shared/types.js").EventConfig} */
export const setMealEvent = {
  id: "ev-set",
  organisationId: "org-a",
  title: "Example dinner",
  status: "open",
  orderingMode: "set_meal",
  currency: "GBP",
  menuId: "menu-set",
  startAt: "2030-01-10T18:00:00Z",
  organiserContact: "organiser@example.test",
  rsvpDeadline: "2030-01-01T12:00:00Z",
  orderDeadline: "2030-01-01T12:00:00Z",
  guestLimit: 2,
  allowContactNotAttending: false,
  showPrices: true,
  fixedPricePerPersonMinor: 2500,
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

/** @type {import("../shared/types.js").Menu} */
export const alaCarteMenu = {
  id: "menu-ala",
  organisationId: "org-a",
  title: "Example à la carte",
  status: "approved",
  currency: "GBP",
  sections: [
    {
      id: "curries",
      name: "Curries",
      order: 1,
      sectionType: "category",
      items: [
        {
          id: "korma",
          name: "Korma",
          priceMinor: 1000,
          tags: ["GF"],
          allergenInfoStatus: "unverified",
          available: true,
          sortOrder: 1,
        },
        {
          id: "dhal",
          name: "Dhal",
          priceMinor: 800,
          tags: ["VG"],
          allergenInfoStatus: "unverified",
          available: true,
          sortOrder: 2,
        },
      ],
    },
    {
      id: "breads",
      name: "Breads",
      order: 2,
      sectionType: "addon",
      items: [
        {
          id: "naan",
          name: "Naan",
          priceMinor: 300,
          tags: [],
          allergenInfoStatus: "unverified",
          available: true,
          sortOrder: 1,
        },
      ],
    },
  ],
};

/** @type {import("../shared/types.js").EventConfig} */
export const alaCarteEvent = {
  ...setMealEvent,
  id: "ev-ala",
  orderingMode: "a_la_carte",
  menuId: "menu-ala",
  fixedPricePerPersonMinor: undefined,
  rules: [],
};

/** @type {import("../shared/types.js").EventConfig} */
export const rsvpOnlyEvent = {
  ...setMealEvent,
  id: "ev-rsvp",
  orderingMode: "rsvp_only",
  menuId: undefined,
  orderDeadline: undefined,
  fixedPricePerPersonMinor: undefined,
  rules: [],
};

export const beforeDeadline = new Date("2029-12-01T00:00:00Z");
export const afterDeadline = new Date("2030-01-02T00:00:00Z");
