# MealMuster — product specification

> This is the original product brief. The first deployment's real names, address and menu have been replaced with fictitious ones (Example Social Club, Sample Kitchen, a made-up menu) so the repository can be public.

**Project:** MealMuster (working title)  
**Publisher:** DRMSITE Ltd  
**Licence:** AGPL-3.0-or-later (decided 2026-11-03; the brief proposed MIT)  
**Status:** MVP specification, 1 November 2026  
**First deployment:** Example Social Club group meal at Sample Kitchen  
**Principle:** A reusable event meal-ordering application, not an archery-club or Christmas-specific application.

## 1. Purpose

MealMuster lets an organiser invite people to an event, collect RSVPs, obtain individual meal choices for every attendee and guest, then produce a reliable order summary for a venue. It should be easier than circulating a spreadsheet, without requiring invitees to create accounts.

The application must distinguish _the person replying_ (a booking contact) from _the people eating_ (diners). One booking may contain zero or more diners, including guests who are not club members. An invitee may decline without making an order.

### Goals

- Mobile-first RSVP and ordering flow that takes only a few minutes.
- Reusable by clubs, charities, community groups and private organisers.
- Secure private invitations with no general public list of attendee names.
- Configurable menus, optional courses, individual dishes, options and prices.
- Accurate per-person order summaries and aggregate counts per menu item.
- Clear deadlines, editing rules and organiser-only administration.
- Open-source, inexpensive to host and independent of Slack for core functionality.
- Accessibility, privacy, validation and automated tests from the outset.

### Non-goals for MVP

- Restaurant discovery, table reservations, restaurant POS integration, payment processing, split bills or deposits.
- General public self-registration, social logins, Slack workspace membership enforcement, email marketing or a multi-tenant SaaS billing platform.
- AI-generated menu interpretation in production, OCR as a runtime dependency, seat plans or multiple currencies within one event.

## 2. Naming and identity

**MealMuster** is a proposed product name: it suggests getting a group together and collecting meal choices without implying a specific club or venue. Use _MealMuster by DRMSITE_ in the footer and repository metadata. The name and potential domain/trademark availability are **not verified**; check before publication.

Use neutral organisation branding by default, with optional logo, title, accent colour and short introductory text. Do not hard-code archery, Christmas, Sample Kitchen or DRMSITE-specific identity into the domain model.

## 3. Roles and access

| Actor                     | Allowed actions                                                                                                                                               |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Visitor                   | See only an event's minimal public landing information if explicitly enabled; no participant records.                                                         |
| Invitee / booking contact | Open a private invitation, accept/decline, add/edit diners and choices for that invitation, view only their own party, until deadline.                        |
| Event organiser           | Sign in, manage only their authorised organisation/events, manage invitations, configure menus, inspect submissions, export totals and close/reopen an event. |
| Organisation owner        | Manage organisers and organisation settings. One owner is adequate for MVP.                                                                                   |

**A link posted in Slack is not proof of Slack membership.** MVP authorisation uses unguessable personal invitation tokens sent privately (Slack DM or another secure channel); anyone holding a token is able to use it. Do not distribute a single shared edit-capable token in a public Slack channel. Slack OIDC login is optional post-MVP and must be independently verified with Slack; opening a Slack-origin link alone must never authorise anyone.

Invitation tokens: generate at least 128 bits of cryptographic randomness (prefer 256); store only a secure keyed hash or suitable digest server-side; never expose a raw token in the database, logs, analytics or exports. Redeem the link to create a short-lived, scoped, HttpOnly/Secure/SameSite session cookie, then redirect to a token-free URL. Protect against token leakage via Referer, third-party scripts and browser history with an appropriate `Referrer-Policy: no-referrer` and no external assets on the redemption page. Support revocation and reissue. Rate-limit redemption and submission. Treat links as bearer credentials, not authenticated identities.

Organisers use Firebase Authentication or another verified secure identity provider and server-enforced roles; simply hiding admin UI is insufficient. An organiser may not enumerate or access another organisation's data.

## 4. Generic domain model

- **Organisation** `{id, name, slug, logoUrl?, settings, createdAt}`.
- **OrganiserMembership** `{organisationId, userId, role}`.
- **Venue** `{id, organisationId, name, address?, contactDetails?}`; a venue does not have to be a registered user.
- **Event** `{id, organisationId, venueId?, title, description?, startAt, timezone, rsvpDeadline, orderDeadline, status, currency, capacity?, guestLimit?, instructions?, menuVersionId?, createdAt}`.
- **Invitation** `{id, eventId, displayName?, deliveryMethod?, status, tokenHash, tokenExpiry?, revokedAt?, issuedAt, lastUsedAt?}`.
- **Booking** `{id, invitationId, eventId, attendance: yes|no|undecided, contactName, partyNotes?, submittedAt?, updatedAt, version}`.
- **Diner** `{id, bookingId, name, isContact, dietaryNotes?, selections[]}`.
- **Menu** `{id, organisationId, title, source?, status: draft|approved|archived, currency}`.
- **MenuSection** `{id, menuId, name, order, sectionType: course|category|addon}`.
- **MenuItem** `{id, sectionId, name, description?, priceMinor?, tags[], allergenInfoStatus, available, sortOrder}`.
- **ItemOptionGroup** `{id, menuItemId, title, min, max, choices[]}` with optional price modifiers.
- **MenuRule** `{eventId, sectionId?, minSelections, maxSelections, required, perDiner, condition?}`.
- **Selection** `{dinerId, menuItemId, optionIds[], quantity, unitPriceSnapshotMinor?, notes?}`.
- **AuditEvent** `{actor, action, entity, entityId, timestamp, safeMetadata}`; exclude tokens and dietary information from logs.

Use IDs rather than names for references. Snapshot names and prices at final submission/export so subsequent menu edits cannot silently rewrite previously submitted orders. Money is represented as integer minor units (pence), never floating-point values. Preserve original menu spelling and original source prices separately from normalised fields. Configure tax/service-charge semantics explicitly if ever introduced; do not assume them.

### Menu flexibility

Support **three ordering modes** within one model:

1. **Set meal:** choose one starter, one main, one dessert, optionally with supplements; event may have a fixed per-person price.
2. **À la carte:** choose individual items from categories, optional sides and quantities.
3. **RSVP only:** no meal choice required, suitable for future non-dining events.

Menu categories can be arbitrary (starters, mains, sides, drinks); do not assume that a venue's menu follows a three-course Christmas format. Per-item dietary tags such as `(V)`, `(VG)`, `(GF)`, `(DF)` are _labels printed by the restaurant_, not verified allergy-safety assurances. Do not infer ingredient safety from them. Let the organiser configure whether prices are displayed, and whether costs are per item, fixed package, or unavailable.

## 5. Invitee journey

1. Open personal invitation link; securely redeem and redirect.
2. See event title, venue, date/time, deadline, organiser contact and short privacy note.
3. Choose `Attending` or `Not attending`; decline records a response without soliciting food details.
4. If attending, enter or confirm booking contact's name.
5. Add each guest by name; if the contact attends, include them as an independently editable diner. If contact is not attending but books for others, allow that as an event setting.
6. For each diner, browse categories and select dishes. Show item descriptions, printed prices, labels and quantity; keep guest selections distinct.
7. Allow optional dietary requests, with a warning that the organiser must confirm all allergies directly with the venue. Do not claim any menu choice is allergen-safe.
8. Display a per-person review and party-level total _only if pricing has been approved_. Clearly label estimates where appropriate.
9. Submit; show a confirmation number and accessible success message. Never silently discard changes.
10. Return through their invitation/session to amend before the deadline; confirm that edits replace the current order rather than creating duplicates.

Required validation: no diner without a name; event-specific maximum guests; selectable item exists and is available; quantities bounded; all required course rules satisfied; date/deadline enforced **server-side**; participant may only alter their own booking; capacity enforced transactionally if enabled.

## 6. Organiser journey

- Create organisation and event, choose time zone and deadline.
- Create reusable menus and sections manually; optional JSON/CSV import with a validation preview.
- Assign menu and menu rules to event. **Approval of menu/version is required before sending invitations.**
- Create invitations by name, optionally record Slack user ID for delivery, copy each private link separately.
- View invited, attending, declined, undecided, submitted and outstanding counts; distinguish **bookings** from **diners**.
- Inspect individual diners and orders, search by contact/name and edit only with clear attribution and audit history.
- Close orders automatically at deadline; allow explicit override with an audit event.
- Export (1) attendance CSV, (2) per-diner restaurant order CSV, (3) aggregate items/quantities CSV, (4) printable summary grouped by diner and by menu item.
- Show missing choices, food notes and outstanding attendees separately; do not quietly count incomplete bookings as confirmed meal orders.
- Support removal of an event and its personal data after a configurable retention period.

CSV exporting must escape formula-like cell values (`=`, `+`, `-`, `@`, tabs/CR) to prevent spreadsheet formula injection, in addition to correct CSV quoting. Export dietary notes only when the organiser explicitly selects the necessary restaurant-facing export. Keep any health-related free text minimised and access-controlled.

## 7. First implementation: Example Social Club

**Use case:** A club organiser has tentatively booked a group table at **Sample Kitchen, 1 Example Street, Exampletown, EX1 1AA**, and needs people and their guests to confirm attendance and select meals. Invites are expected to be shared through the club's Slack workspace. The event date, time, deadlines, capacity, meal arrangement and approved group pricing are **not yet confirmed**; require organiser input rather than inventing them.

**Crucial source distinction:** The photographed leaflets supplied for the original event showed a **takeaway menu** with separately priced dishes (in this repository they are replaced by a fictitious sample). They are **not evidence of a Christmas set menu or dine-in/group prices**. Store the transcription as a **draft, unapproved import**. Confirm with Sample Kitchen which items, prices, group ordering options, allergies, deadlines and payment arrangements apply before opening the event to invitees.

The sample import file `reference/sample-draft-menu.json` is a fictitious menu in the shape such a transcription takes, preserving menu categories and dietary tags. It is starter data, **not a validated commercial menu**. For a real menu, visually check every item against the original source before approval; do not assume photos or extracted text establish allergen information.

The printed menu uses abbreviations: `(V)` vegetarian, `(VG)` vegan, `(GF)` gluten-free and `(DF)` dairy-free where shown; preserve exactly what is printed rather than converting one label to another. Some menu items have multiple tags. Prices are in GBP.

For this example, seed configuration should use `orderingMode: "a_la_carte"`, `menu.status: "draft"`, `event.status: "draft"`, with the invitation send action disabled until menu approval. This can be changed to set-meal ordering if the restaurant supplies a Christmas menu.

## 8. Technology decisions

- **Front end:** Vite + vanilla JavaScript modules with JSDoc (`// @ts-check` and checkJs), native custom elements with **open/light DOM by default**; no React or TypeScript. Use plain HTML/CSS for semantic structure.
- **UI:** only **Web Awesome Core (free)**, imported from `@awesome.me/webawesome`; no Pro elements, paid patterns or themes. Verify components against official documentation; prefer `<wa-input>`, `<wa-select>`, `<wa-option>`, `<wa-button>`, `<wa-dialog>`, `<wa-alert>`, `<wa-checkbox>`, `<wa-card>` where their exact current APIs are supported. Use real form labels and helpful validation messages.
- **Backend:** Firebase Hosting + Cloud Functions (Node) + Firestore + Firebase Auth for organiser identities. Keep architecture portable behind repository/service interfaces, but don't build adapters for other backends in MVP.
- **Local development:** Firebase Emulator Suite for Functions, Auth and Firestore; test with seed fixtures. Never use real club members' details as seed data.
- **Tooling:** npm, Biome for formatting/linting, JSDoc type checking with TypeScript compiler, Vitest for units and integration logic, Playwright for E2E and accessibility with axe-core/axe-playwright. CI via GitHub Actions.
- **Project licence:** AGPL-3.0-or-later for original application code (the brief proposed MIT; changed on 2026-11-03 to match ParishMap). Include the required notices for Web Awesome and every dependency; confirm third-party licence compatibility.

Web Awesome Core is MIT licensed, including commercial use, but the Pro components and design patterns are distinct. Consult https://webawesome.com/license and https://webawesome.com/docs when implementing.

## 9. Security/privacy requirements

- Treat invitation URLs as secrets. Store their hashes server-side; exchange for appropriately scoped session cookies; revoke and rotate on demand.
- Separate invitee authorization and organiser authentication. Enforce event + organisation scoping at every API boundary.
- Do not expose Firestore collections to anonymous clients. Prefer server-owned writes and restrictive Firestore rules (deny by default except carefully justified organiser access).
- Verify CSRF protections for cookie-backed state-changing requests: SameSite alone is not the complete defence; add Origin checks and CSRF token strategy as appropriate.
- Apply rate limits and anti-abuse measures at public endpoints, account for Cloud Functions costs. Never trust client prices or totals.
- Store minimal personal information. Dietary notes can reveal sensitive information; avoid unnecessary detail, restrict access and delete after the event.
- Keep audit logs free of names, dietary notes, tokens and full order payloads unless strictly justified.
- HTTPS throughout; secure headers (CSP, Referrer-Policy, HSTS). Avoid third-party analytics and trackers.
- Include a plain-English privacy notice, retention window, organiser contact, data controller context and deletion workflow appropriate to the organisation.
- Explicitly note that link-based access is possession-based and does **not** prove the user's identity or Slack membership.
- Protect against XSS from names, notes, menu descriptions and imported CSV/JSON. Render user text as text, never unsanitised HTML.
- Log meaningful errors without exposing internal details. Make submission idempotent and concurrency-safe.

## 10. Accessibility and usability

- WCAG 2.2 AA as target, keyboard-only operation and visible focus indicators.
- Proper headings and field labels, clear error summaries, live submission feedback and adequate contrast.
- Avoid colour-only statuses; touch targets appropriate for mobile devices.
- Never rely solely on inaccessible custom widgets; test the _actual_ Web Awesome components with screen-reader semantics and keyboard workflows.
- No auto-saving of potentially sensitive fields without clear user notice; warn about unsaved changes.
- Clear per-diner headings to prevent orders being assigned to the wrong guest.
- Respect reduced motion and users who increase browser text size.

## 11. API outline (server-enforced)

- `POST /api/invitations/redeem` — token redemption, scoped session, redirect without token.
- `GET /api/session` — invitation/event metadata and minimal viewer permission.
- `GET /api/events/:id/menu` — approved event menu accessible to invitee.
- `GET /api/booking` — only current invitation's booking.
- `PUT /api/booking` — validate and atomically create/update current booking with optimistic version.
- `POST /api/booking/submit` — finalise and return confirmation ID.
- `POST /api/session/logout` — expire session.
- `/api/admin/...` — organisation-scoped CRUD for events, menus, invitations and exports, authenticated for organisers.

Define response schemas and error codes (`400`, `401`, `403`, `404`, `409`, `422`, `429`) before implementation. Never expose private invitation identifiers through query parameters to unrelated endpoints.

## 12. Test acceptance criteria

1. An invitee accepts, adds two guests, chooses different food for all three, submits and later edits before deadline.
2. An invitee declines and is not required to complete the menu.
3. A contact can invite guests without ordering for themselves only when configured.
4. A second invitee cannot retrieve or edit the first invitee's booking, even with modified IDs.
5. A revoked/expired token cannot create a session; a leaked token does not appear in logs or analytics.
6. A submitted booking has exactly one current set of selections after repeated clicks/retries; no duplicate orders.
7. Invalid menu IDs, unavailable items, forged prices, over-limit guests and closed deadlines are rejected server-side.
8. Menu approval and publication gates block ordering from an unapproved draft.
9. Per-diner and aggregate exports reconcile exactly, including quantities and selected options.
10. CSV names beginning with spreadsheet formula characters are exported safely.
11. An organiser from another organisation receives a permission error for all cross-tenant resources.
12. Axe and keyboard navigation run on all significant screens; unit and E2E tests run in CI.
13. Both set-meal and à-la-carte fixtures pass ordering/validation/export tests.
14. Dietary notes are absent from normal analytics, logs and general attendance exports.
15. Event deletion/retention tests verify associated private data are removed according to policy.

## 13. Delivery increments

### Milestone 0 — repository setup and contracts

README, licence, dependency notices, architecture record, data schemas, docs, Biome, JSDoc type checking, Vitest/Playwright/axe, CI and Firebase emulator. Decide naming later without tying it to the code.

### Milestone 1 — generic event and menu model

Implement organisations, events, menu editing, ordering rules, import validation and approval lifecycle. Ship tests before user interface polish.

### Milestone 2 — invitee flow

Implement secure invitation redemption, RSVP, multi-diner editing, order review and deadline enforcement. Mobile accessibility first.

### Milestone 3 — organiser tools

Invitation management, attendance overview, order totals, per-diner/aggregate exports, printable restaurant summary, retention controls.

### Milestone 4 — club event configuration

Import the draft menu (here, the fictitious sample), correct/approve it against venue confirmation, set actual meal date/time and deadlines, test with fictitious club members. Release only when event-specific data are approved.

### Later, not MVP

Slack sign-in via verified OIDC flow; Slack bot DMs; automated reminders; deposits and payments; multi-language UI; reusable venue-owned menus; seating plans; capacity waitlists; commercial subscription/billing.

## 14. Instructions for Claude Code

1. Read this specification and inspect the existing repository. Keep existing code unless explicitly asked to replace it.
2. Implement **generic functionality before event-specific configuration**. Use the Example Social Club meal solely as the initial seed/example and acceptance test.
3. Respect the JavaScript/JSDoc, Web Awesome Core, Biome, Vitest and Playwright/axe constraints.
4. Start with a short `IMPLEMENTATION_PLAN.md` mapping milestones, schema, security boundaries and risks; then proceed incrementally with tests.
5. Do not introduce React, TypeScript source files, a paid Web Awesome component, an extra framework or a hosted authentication provider without justifying and obtaining approval.
6. Do not perform irreversible operations on live Firebase projects, deploy to production or send live invitations without explicit authorisation.
7. Keep documentation up to date, provide working emulator setup and demo seed scripts.
8. Do not invent menu prices or a Christmas menu. Treat transcribed food data as a **draft** and require explicit organiser approval.
9. Run formatting, type checks, unit tests, E2E and accessibility checks before claiming completion; report actual results and unresolved issues.
10. Do not expand scope into a platform for every possible social event; prioritise a complete, safe, accessible meal-ordering workflow.

## 15. Open decisions

- Final brand and available domain/trademark.
- Confirmed restaurant Christmas/group menu, item availability, dine-in prices, allergies and dietary procedures.
- Event date/time, party limit, booking/order deadlines and organiser contact.
- Whether the club wants individually messaged invitation links or Slack OIDC authentication later.
- Retention duration, any legal basis documentation and organiser access delegation.
- Hosting project ownership and expected usage/operating limits.

**MVP definition of done:** an organiser can create an event, approve a menu, issue private links, collect accurate per-person orders including guests, amend/cancel before deadline and export an intelligible restaurant order; this must be tested, accessible, securely authorised and reusable for another organisation without source-code changes.
