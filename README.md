# MealMuster

Reusable event meal ordering. Someone organising a meal sends each guest a private link, the guest says whether they are coming and chooses food for themselves and any guests they bring, and the organiser gets a clear order to hand the venue. _MealMuster by DRMSITE._ The name is provisional, and I have not checked its availability as a trademark.

Status: version 0.1.0, offered as a pre-release. It was built from a product brief ([SPEC.md](SPEC.md)) for one real group meal, and the names, address and menu from that event are replaced here with made-up ones, because a venue's menu is the venue's to publish. The plan it was built to is in [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md).

## Licence

MealMuster is free software under the GNU Affero General Public Licence, version 3 or (at your option) any later version, copyright DRMSITE LTD. I chose it, as for ParishMap, because MealMuster is a web service, and the AGPL keeps modified copies that are run over a network open to the people who use them. If you modify or deploy it, please keep the "MealMuster by DRMSITE" credit in the footer (see [NOTICE](NOTICE)). Contributions are made under the same licence with a sign-off ([CONTRIBUTING.md](CONTRIBUTING.md)), security problems go to [SECURITY.md](SECURITY.md) and not to a public issue, and third-party software is listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Known limitations

Four things are worth knowing before you rely on it.

- A private link works like a key: anyone holding it can edit that booking. That protects against casual misuse and not against a determined attacker, and the application tells guests so.
- The accessibility checks are automated and scripted, and no real screen reader has been used yet. The script for that is in [docs/accessibility.md](docs/accessibility.md), and a person still needs to run it.
- The documentation describes one kind of deployment (Firebase, in one region). You need your own Firebase project, organiser accounts and a privacy notice, and you are the data controller for what guests tell you.
- Not built yet: editing a guest's booking as an organiser, orderable prices on imported items, screens to create an event or a menu from scratch, and a scheduled retention purge.

## Requirements

Node 22+, Java 21+ (Firebase emulators).

## Commands

| Command                    | Purpose                                               |
| -------------------------- | ----------------------------------------------------- |
| `npm run check`            | Biome lint/format check and JSDoc type check          |
| `npm test`                 | Unit tests with coverage                              |
| `npm run test:integration` | Integration tests (run inside the emulators)          |
| `npm run test:e2e`         | Playwright end-to-end and accessibility tests         |
| `npm run test:csp`         | Production bundle in a real browser under the shipped CSP |
| `npm run emulators`        | Firebase emulators (never connects to a live project) |
| `npm run sonar`            | SonarQube scan (needs `SONAR_TOKEN`)                  |

## Safety

Nothing here deploys or sends invitations. The sample menu in `reference/` is fictitious and an unapproved draft.

## Running the invitee flow locally

Everything runs against the Firebase emulators with fictitious data. Nothing is
deployed and no invitations are sent.

- `npm run test:e2e` starts the Firestore and Functions emulators, seeds demo
  data and runs the Playwright tests (with axe checks) on desktop and mobile.
- Firestore uses port 8085 and Functions port 5001. On Windows the Firestore
  emulator's Java process can outlive a run; if the next run reports
  "port taken", stop that process before retrying.
- `npm run seed:emulator` writes the demo data to a running emulator. It refuses
  to run unless `FIRESTORE_EMULATOR_HOST` is set.
- Invitation links look like `/i#<token>`. The token is in the URL fragment, so
  it is not sent in the request or written to server logs. The page exchanges it
  for a short-lived session cookie and replaces the URL with `/invitation`.

### Configuration

| Name | Purpose |
| --- | --- |
| `MEALMUSTER_SECRET` (secret) | Key for hashing invitation tokens and signing sessions. Use a long random value; never commit it. |
| `ALLOWED_ORIGINS` | Comma-separated origins allowed to make write requests. |
| `REDEEM_LIMIT` | Redemption attempts per minute per client (default 10). The emulator wrapper script raises it; production keeps the default. |

## Organiser area

Organisers sign in at `/admin` with Firebase Authentication. Locally this is the
Auth emulator (port 9099) with a demo project; the seed script creates three
fictitious accounts (`owner@example.test`, `helper@example.test` and
`outsider@example.test`, in a different organisation) with the emulator-only
password printed by `npm run seed:emulator`.

From the dashboard an organiser can:

- see replies versus people attending, and who has not answered;
- create, revoke and reissue private links (copy and share them yourself:
  MealMuster never sends anything, and a link is shown once);
- search replies and open one with its attributed history;
- close and reopen orders;
- download the attendance, restaurant order and item-totals CSV files, or open a
  printable summary;
- delete an event's personal data (owner only, closed events, title typed to
  confirm) or run the retention purge.

Links cannot be created until the menu is approved and the event's start time,
contact and deadlines are set. The dashboard lists what is still outstanding, and
there are screens to check and approve a menu and to save the event details.
A fictitious Example Social Club / Sample Kitchen draft is seeded unapproved: see
[docs/example-event.md](docs/example-event.md). For a real deployment, set `VITE_FIREBASE_API_KEY`,
`VITE_FIREBASE_AUTH_DOMAIN` and `VITE_FIREBASE_PROJECT_ID` when building, and
create organisers and their `memberships` documents deliberately.

## Deploying

[docs/deployment.md](docs/deployment.md) is a staged runbook: create the Firebase project, deploy to a preview channel, prove the headers and session cookie there, then go live. The deploy refuses to build with emulator or demo settings.

## Security and accessibility

- [docs/security.md](docs/security.md): threat model, controls, the tests that prove them, and what to verify on the first deployed preview.
- [docs/accessibility.md](docs/accessibility.md): what is checked automatically, what the audit found and fixed, and the manual screen-reader script a person still needs to run.

## Web Awesome

Only components from the free, MIT-licensed `@awesome.me/webawesome` package
are used: button, callout, card, checkbox, input, radio, radio-group and
textarea. The spec's `wa-alert` is `wa-callout` in version 3.
