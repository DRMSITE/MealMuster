# Security notes

What MealMuster protects, how, which test proves it, and what is still open.
Nothing here has been deployed: everything was verified against the emulators.

## What is protected

| Asset | Threat | Control | Evidence |
| --- | --- | --- | --- |
| Invitation links | Guessing, leaking, reuse after revoke | 256-bit random token; only an HMAC hash is stored; token lives in the URL fragment so it is never sent to a server, logged or fetched by a link previewer; revoke and expiry are checked on every request; one generic answer for unknown, revoked and expired links | `api.test.js`, `hardening.test.js` (uniform answers), e2e "no token in URL" |
| Invitee sessions | Theft, CSRF | Signed `__session` cookie: HttpOnly, SameSite=Strict, Secure, 2 hours; Origin check plus `X-CSRF-Token` on every write | `api.test.js` |
| Organiser access | Unauthorised or cross-tenant use | Firebase ID token verified (with revocation) on every route; organisation membership checked against the event; other organisations and unknown events both get 403; owner-only routes; no cookies, so no ambient authority | `admin.test.js` (every route denied cross-tenant), e2e |
| Personal data in Firestore | Direct client access | Rules deny all reads and writes; only the server (Admin SDK) touches data | `firestore.test.js` (anonymous REST reads and writes of every collection return 403) |
| Orders and prices | Tampering | Server validates every booking; prices are computed from the approved menu, never read from the client; optimistic version plus transactional capacity check; submit is idempotent | `ordering.test.js`, `api.test.js`, integration tests |
| Menu integrity | Unreviewed menu goes live | Approval refused while any item is unchecked; approved menus are read-only; ordering and links are blocked until approval | `example-event.test.js`, e2e |
| Page content | XSS | All text is built with text nodes (no `innerHTML`, `eval` or inline handlers: a test fails if one appears); strict CSP with no `unsafe-inline` or `unsafe-eval`; hostile markup in every text field renders literally and nothing runs | `hardening.test.js` (source guard), `xss.spec.js`, `csp.spec.js` |
| Spreadsheets | CSV formula injection | Cells starting `= + - @`, tab or CR are neutralised; dietary notes appear only in the restaurant export | `exports.test.js`, e2e |
| Logs | Personal data in logs | Audit entries hold ids, action names, counts and field names only; error logs hold the error class only | `hardening.test.js` (sentinel strings never reach the audit log across the whole workflow) |
| Availability and cost | Brute force, scraping, floods | Per-address limits on redeem, on all organiser requests and on failed organiser sign-ins (checked before any token is verified); per-person write limits; request size cap; bounded limiter memory; `maxInstances` | `hardening.test.js` |

## Headers

`firebase.json` ships a strict CSP (`default-src 'self'`, `script-src 'self'`,
`style-src 'self'`, `object-src 'none'`, `frame-ancestors 'none'`, and
`connect-src` limited to this site and the two Firebase Auth hosts), plus HSTS,
`nosniff`, `X-Frame-Options`, `Referrer-Policy: no-referrer`,
`Permissions-Policy`, `Cross-Origin-Opener-Policy`, `Cross-Origin-Resource-Policy`
and `X-Robots-Tag`. `npm run test:csp` builds the production bundle, adds exactly
those headers to each page and drives the invitee and organiser journeys in a
real browser, failing on any violation. It also proves the policy blocks an
injected inline script.

## Not proven locally: check on the first deployed preview

1. **Hosting delivers the headers.** The Hosting emulator in use ignores
   `hosting.headers`, so the CSP test applies the shipped set itself. Confirm
   the live response carries them.
2. **Hosting passes the session `Set-Cookie`.** The emulator drops `Set-Cookie`
   from function responses, and Firebase documents only the request side
   (`__session` is the one cookie forwarded). The design uses `__session`, but
   if the deployed site does not keep the cookie, the invitee flow fails.
   Test the redeem flow on a preview channel before any real use.
3. **The `/api` rewrite region.** It is now `europe-west2` (it previously
   defaulted to `us-central1` and would have missed the function). The Hosting
   emulator confirms the rewrite; confirm it once deployed.

## Before real use

- **Disable open sign-up** in Firebase Authentication. With email and password
  enabled, anyone with the public web API key could create an account. An
  account alone grants nothing (access needs a `memberships` document, which
  only the server or console can write), but there is no reason to allow it.
  Create organiser accounts deliberately.
- **Set `MEALMUSTER_SECRET`** in Secret Manager with a long random value.
  Rotating it invalidates every link and session, which is the intended
  emergency lever.
- **Set `ALLOWED_ORIGINS`** to the real site origin only.
- **Consider Firebase App Check and Cloud Armor.** The in-memory rate limits are
  per function instance, so they are a brake, not a global guarantee.
- **Schedule the retention purge** (`POST /api/admin/retention/purge`) and
  decide the retention period; it is unset by default.

## Known limitations

- **Reissuing a link** ends old sessions only when they expire (2 hours).
  Revoke first for an immediate cut-off.
- **A link is a bearer secret.** Anyone who has it can edit that booking. The
  page says so. Treat the Slack channel it is shared in accordingly.
- **Dependency advisories.** `npm audit --omit=dev` is clean for the web app.
  The `functions` package reports 6 moderate advisories in `glob` and
  `minimatch`, pulled in by `firebase-admin` through `google-gax` and `rimraf`.
  They concern glob patterns and filesystem traversal, nothing here passes user
  input to them, and `npm audit fix` cannot resolve them without a forced
  major upgrade, so they are accepted for now. Re-check when `firebase-admin`
  updates. The root package reports 22 advisories in development tooling only.
- **No health-data processing is claimed.** Dietary text is free text, kept
  minimal, shown only to organisers and the restaurant export, and deleted with
  the event. A privacy notice and legal basis are still the club's to supply.
