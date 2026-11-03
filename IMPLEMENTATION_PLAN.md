# Implementation plan

Maps `SPEC.md` milestones to work. Domain logic is pure JavaScript in `shared/` and is reused by Functions, the UI and tests.

| Step | Milestone | Outcome                                                                                                     |
| ---- | --------- | ----------------------------------------------------------------------------------------------------------- |
| 1    | M0        | Tooling, CI, emulator config, docs, API contract                                                            |
| 2    | M1        | Money, entities, menu rules, import validation, approval lifecycle, ordering validation, totals, CSV export |
| 3    | M2        | Token redemption, sessions, booking API, invitee UI                                                         |
| 4    | M3        | Organiser API/UI, counts, exports, retention                                                                |
| 5    | –         | Security hardening                                                                                          |
| 6    | M4        | Sample Kitchen draft seed (unapproved), gates tested                                                       |
| 7    | –         | Accessibility pass                                                                                          |
| 8    | –         | Final docs and full test run                                                                                |

## Security boundaries

- Firestore is closed to clients (`firestore.rules` denies all); only Cloud Functions (Admin SDK) read and write.
- Invitees: bearer token, hashed (HMAC-SHA-256) at rest, exchanged for a scoped `__session` cookie. Organisers: Firebase Auth ID token plus server-side membership check.
- Every handler scopes by organisation/event derived from the session or membership, never from client-supplied IDs alone.

## Risks

Web Awesome API drift; Hosting only forwards the `__session` cookie; menu data is unverified and stays draft until an organiser approves it; link access proves possession, not identity.

## Hard rules

No deployment, no live Firebase project, no real invitations, no invented menu data or prices.
