# API contract

All bodies are JSON. Errors: `{ "error": { "code": "<machine_code>", "message": "<safe text>", "details"?: [...] } }`.

| Status | Meaning                                                                            |
| ------ | ---------------------------------------------------------------------------------- |
| 400    | Malformed request                                                                  |
| 401    | No or invalid session / ID token                                                   |
| 403    | Authenticated but not permitted (wrong organisation, closed gate, bad Origin/CSRF) |
| 404    | Not found (also used where existence must not leak)                                |
| 409    | Version conflict or capacity reached                                               |
| 422    | Valid JSON that fails domain validation (`details` lists field paths)              |
| 429    | Rate limited (`Retry-After` header)                                                |

## Invitee endpoints

- `POST /api/invitations/redeem` `{token}` → 204, sets `__session` cookie; client then navigates to a token-free URL.
- `GET /api/session` → `{event, invitation: {displayName}, permissions: {canEdit}}`
- `GET /api/events/:id/menu` → approved menu snapshot; 403 if the menu is not approved or the id is not the session's event.
- `GET /api/booking` → `{booking, diners}`
- `PUT /api/booking` `{version, attendance, contactName, partyNotes?, diners[]}` → updated booking; 409 on stale `version`.
- `POST /api/booking/submit` → `{confirmationId}`; idempotent.
- `POST /api/session/logout` → 204.

State-changing calls require an `Origin` matching the site and an `X-CSRF-Token` header.

## Organiser endpoints

All routes are under `/api/admin` and need `Authorization: Bearer <Firebase ID token>`. The token is verified (including revocation) and the caller must belong to the organisation that owns the event. Unknown events and other organisations' events both return **403**, so event ids cannot be probed. There are no cookies on these routes, so there is no ambient authority to forge. Writes are rate limited per organiser.

| Method and path | Purpose |
| --- | --- |
| `GET /api/admin/events` | Events in the caller's organisations. |
| `GET /api/admin/events/:id/overview` | Event, menu status, link blockers, counts (replies and people), invitations with reply state, retention. |
| `POST /api/admin/events/:id/invitations` `{displayName}` | Creates a private link. Returns `{path: "/i#<token>"}` **once**; only a hash is stored. 409 `invitations_blocked` (with reasons) until the menu is approved and deadlines are set. |
| `POST /api/admin/events/:id/invitations/:inv/revoke` | Link stops working immediately. |
| `POST /api/admin/events/:id/invitations/:inv/reissue` | New token replaces the old one and clears revocation. Existing sessions end within their short lifetime; revoke first for an immediate cut-off. |
| `GET /api/admin/events/:id/bookings?q=` | Replies, optionally searched by link name, contact, diner name or confirmation number. No dietary notes. |
| `GET /api/admin/events/:id/bookings/:inv` | One booking in full (including dietary notes) with attributed history. |
| `POST /api/admin/events/:id/close` | Closes orders now (audited). |
| `POST /api/admin/events/:id/reopen` `{orderDeadline?}` | Opens a draft event or reopens a closed one; an optional new deadline must be in the future. 409 `event_not_ready` (with reasons) while the menu is unapproved or the date, contact or deadlines are missing. Audited. |
| `GET /api/admin/events/:id/summary` | Restaurant summary grouped by booking and by item. |
| `GET /api/admin/events/:id/exports/{attendance,restaurant,aggregate}` | CSV download. Only the restaurant export contains dietary notes. Cells beginning with `= + - @`, tab or CR are neutralised. Each export is audited by kind only. |
| `PATCH /api/admin/events/:id` | Edits event details: title, description, instructions, organiser contact, timezone, start, RSVP and order deadlines, guests per booking, total places, retention days, price display. Dates must be in the future and ordered (RSVP ≤ order ≤ start). Status, menu, ordering mode and organisation cannot be changed here. Audited by field name only. |
| `GET /api/admin/events/:id/menu` | The event's full menu with verification state. A menu belonging to another organisation is treated as absent. |
| `POST /api/admin/events/:id/menu/review` `{items: [{id, name?, available?, verified?}]}` | Draft menus only. Rename, mark as not offered, or confirm/un-confirm items. Nothing is deleted; printed names, tags and prices stay on the item. |
| `POST /api/admin/events/:id/menu/approve` | Draft menus only. 409 `menu_has_unverified_items` until every item is confirmed, 409 `menu_empty` if nothing is offered. Final: an approved menu cannot be edited. |
| `DELETE /api/admin/events/:id/data` `{confirmTitle}` | **Owner only.** Deletes all links and replies for a *closed* event. 422 unless the title matches exactly. |
| `POST /api/admin/retention/purge` | **Owner only.** Deletes personal data for closed events in the owner's organisations whose retention period (event start plus `retentionDays`) has passed. |

Errors use the same `{error: {code, message, details?}}` shape as the invitee API: 401 not signed in, 403 no access, 404 unknown invitation or export, 409 blocked, 422 invalid input, 429 rate limited.

Link creation and opening an event are blocked until: the menu is approved (non-RSVP-only events), and the start time, organiser contact, RSVP deadline and order deadline are set. The overview's `readiness` list shows what is still outstanding.

Not yet built: organiser editing of an individual booking, orderable prices on imported items, and creating events or menus from scratch (menus arrive by import; events are seeded). A scheduled trigger for the retention purge is a deployment step; the route above is what it would call.
