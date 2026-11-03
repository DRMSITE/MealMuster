# Changelog

All notable changes are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project aims to follow
[Semantic Versioning](https://semver.org/) once it reaches 1.0. A release that changes
`firestore.rules` or the function's parameters says so, because those must be deployed with it.

## [0.1.0] - Unreleased

The first public release, offered as a pre-release. Give it a date here when the tag is made.

### Added

- **Guests:** a private link per invitee (256 bits, stored only as a keyed hash), exchanged for a short-lived
  session cookie so the token never stays in the address bar, history or logs. A guest can reply, add guests
  of their own with different meals, review the order, save it for later, submit it, and amend it until the
  deadline. Capacity and deadlines are enforced on the server.
- **Organisers:** sign-in with Firebase Authentication, with access taken only from server-written membership
  records. They can create, revoke and reissue links, see replies against people attending, open and close
  orders, check and approve a menu, edit the event's details, download three CSV exports and a printable
  summary, and delete an event's personal data or run the retention purge.
- **Menus:** an import that keeps printed names, tags and prices exactly as supplied, marks every item as
  needing a manual check, and never turns a printed price into an orderable one. Approval is refused while any
  item is unchecked, and is final.
- **Safeguards:** links, opening an event and ordering are all refused until the menu is approved and the date,
  contact and deadlines are set. The restaurant export is the only place dietary notes appear, and CSV cells
  that could run as formulas are neutralised.
- **Hosting:** a strict Content Security Policy and the other security headers in `firebase.json`, a build guard
  that refuses to ship emulator or demo settings, and `scripts/prod-setup.js` for a first deployment (a dry run
  unless told otherwise, and it never overwrites a document that exists).
- **Tests:** 132 unit tests, integration tests against the emulators, 55 browser tests (with axe) on desktop and
  mobile, and a test that runs the production bundle in a real browser under the shipped policy. Scripted checks
  go beyond axe: reflow at 320px, text spacing, target sizes, focus visibility, reduced motion, forced colours,
  page titles and a keyboard-only journey.
- **Documentation:** the API, security model, accessibility audit, deployment runbook and a worked example in
  `docs/`.

### Known limitations

- No real screen reader has been used yet. The script for it is in `docs/accessibility.md`.
- An organiser cannot edit a guest's booking, imported items have no orderable price, there are no screens to
  create an event or a menu from scratch, and nothing triggers the retention purge on a schedule.
- A link works like a key: anyone holding it can edit that booking.
