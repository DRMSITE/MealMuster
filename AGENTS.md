# AGENTS.md

Instructions for AI coding assistants working in this repository (Claude Code, Codex, Cursor, Copilot and others). `CLAUDE.md` imports this file, so there is one set of rules.

MealMuster (DRMSITE LTD, AGPL-3.0-or-later) is a reusable event meal-ordering application. An organiser invites people with private links, guests reply and choose meals for themselves and their guests, and the organiser gets a clear order for the venue. See `README.md` for what it does, `SPEC.md` for the original brief, and `docs/` for the API, security model, accessibility audit and deployment. Keep the docs in step with the code when behaviour changes.

## Project map

```
shared/              pure domain code with no I/O: money, menu import and lifecycle, ordering, exports, retention, readiness, event settings, CSV
functions/src/       Cloud Functions: app.js (guest routes), admin.js (organiser routes), http.js, security.js, repository interface with memory-repo.js (tests) and firestore-repo.js
functions/src/shared/  generated copy of shared/ (git-ignored; scripts/sync-shared.js writes it before tests and deploys)
web/src/             the front end: light-DOM custom elements in elements/, dom.js (the only way text reaches the page), admin/ (sign-in and API client)
seed/                made-up demo data, the worked example (example-event.js), and the production setup planner
scripts/             emulator-run.js, csp-run.js, sync-shared.js, prod-setup.js, replace-draft-menu.js, check-build-env.js
reference/           the sample draft menu (fictitious)
tests/               unit/, integration/, e2e/ (Playwright and axe), csp/
firestore.rules      deny-all: clients never touch the database
```

## Stack and conventions

- Vanilla JavaScript (ES modules) with JSDoc types, checked by `npm run check`. No TypeScript sources, no UI framework.
- Custom elements use the **light DOM**. Only the free Web Awesome Core components already in use. UI text is built with `h()` from text nodes, never as HTML.
- Biome for lint and format (2 spaces, double quotes). Vitest for unit and integration tests, Playwright and axe for e2e.
- UK English in code comments, documentation and user-facing text.

## Rules that must not be broken

- **Never invent** menu prices, dates, deadlines, capacities or a Christmas menu. Unknown means unset.
- **A menu is approved only by a person**, item by item, in the app. Never write code or a test that approves the seeded example menu, and never set an item's `verification` to anything but `needs-manual-review` in the reference file. A printed price is never copied to an orderable price.
- **No real data**: no real venue's menu, no real people, links, keys or `.env` files, in code, tests, fixtures or docs.
- Invitation tokens stay out of URLs, logs and responses after redemption. The server is the security boundary; the browser only mirrors it. A change to links, sessions, organiser access, retention or the headers needs a test and a matching update to `docs/security.md`.
- Money is integer pence. Event times are entered in the event's timezone and stored as UTC.
- Accessibility is a requirement (WCAG 2.2 AA), not a finishing touch.
- Never deploy, write to a real Firebase project, or send an invitation. The maintainer does that, using `docs/deployment.md`.
- The maintainer handles version control. Leave changes in the working tree, and do not run `git commit` or `git push` unless asked. Contributors sign off commits (`git commit -s`, see `CONTRIBUTING.md`).

## Commands

```bash
npm run check           # Biome and the type check
npm test                # unit tests with coverage
npm run test:e2e        # starts the emulators, seeds, runs Playwright and axe
npm run test:csp        # production bundle under the shipped Content Security Policy
npx firebase emulators:exec --only auth,firestore --project demo-mealmuster "npm run test:integration"
```

On Windows the Firestore emulator's Java process can outlive a run, and the next run then reports "port taken". Stop that one process (its command line contains `cloud-firestore-emulator`) and retry.
