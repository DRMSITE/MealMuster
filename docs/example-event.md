# Example Social Club meal at Sample Kitchen: handover

Every name, address, dish and price here is **fictitious**. The example shows how
a first real event is set up and released, and it is what the tests exercise. It
exists in the emulator seed as a **draft**. Nothing about it is approved, and no
invitation has been created or sent.

## What the draft is

- The venue and address (Sample Kitchen, 1 Example Street, Exampletown, EX1 1AA)
  are invented.
- The menu is a made-up draft in `reference/sample-draft-menu.json`: 5 sections,
  16 items, every item flagged `needs-manual-review`. It is not evidence of a
  dine-in, group or Christmas menu.
- Printed names, `(V)` / `(VG)` / `(GF)` / `(DF)` labels and prices are kept
  exactly as supplied. The printed prices are shown for reference only and are
  **not** used as ordering prices; no item has an orderable price and the event
  does not display prices.
- **Choices printed on one line.** A printed menu may list several choices at one
  price (here, steamed and pilau rice at £3.99). They are imported as separate
  items that each carry that printed price, so a guest can choose one. That split
  is the importer's, not the menu's wording, so the venue should confirm each
  choice is offered at that price.
- Ordering mode is à la carte. The event status is draft.

## What the organiser must supply or confirm

MealMuster leaves all of these empty rather than guessing. The organiser
dashboard lists them under "Before you can invite people".

1. Event date and time.
2. RSVP deadline and order deadline.
3. Organiser contact for guests.
4. Whether the venue offers a dine-in or group menu, and which items and prices
   apply. If it supplies a set menu, the event can be changed to set-meal
   ordering.
5. Allergy and dietary procedures. Printed labels are not allergy assurances;
   guests are told to confirm allergies with the venue.
6. Party limit, total places, payment arrangements and deadlines.
7. How long personal data is kept after the event, and who may organise it.

## How it is released

1. Sign in as an organiser of the Example Social Club organisation.
2. Open **Review and approve the menu**. Check each item against the venue's
   confirmation, correct names, mark anything not offered, save, then approve.
   Approval is refused while any item is unchecked, and is final.
3. Fill in the event details and save.
4. Choose **Open orders**, then create a private link for each guest and share
   it yourself. The app never sends links.

Until steps 2 and 3 are done, the app refuses to create links, refuses to open
the event, and refuses all guest bookings, whatever the client sends.
