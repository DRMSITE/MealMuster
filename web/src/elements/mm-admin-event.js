// @ts-check

import { isoToZonedLocal, zonedLocalToIso } from "../../../shared/datetime.js";
import { adminApi, downloadCsv } from "../admin/admin-api.js";
import { h, setTitle } from "../dom.js";

const REPLY_LABEL = {
  none: "No reply yet",
  in_progress: "In progress",
  attending: "Attending",
  not_attending: "Not attending",
  revoked: "Link revoked",
};

/**
 * Organiser dashboard for one event (attribute: event-id). Light DOM. Loads
 * everything from /api/admin/...; the server enforces access, so nothing here
 * is a security boundary.
 */
const FIELD_LABEL = {
  title: "Title",
  startAt: "Event start",
  rsvpDeadline: "RSVP deadline",
  orderDeadline: "Order deadline",
  organiserContact: "Organiser contact",
  guestLimit: "Guests per booking",
  capacity: "Total places",
  retentionDays: "Retention period",
};

/** Turns an API error into one readable sentence per problem. @param {unknown} error */
function describeError(error) {
  const details = /** @type {any} */ (error)?.details;
  if (Array.isArray(details) && details.length > 0)
    return details
      .map((/** @type {any} */ d) => {
        const label =
          FIELD_LABEL[/** @type {keyof typeof FIELD_LABEL} */ (d.path)];
        return label ? `${label}: ${d.message}` : d.message;
      })
      .join(" ");
  return error instanceof Error ? error.message : "Something went wrong.";
}

export class MmAdminEvent extends HTMLElement {
  /** @type {any} */
  #data;
  /** @type {any[] | undefined} replies filtered by the search box */
  #rows;
  /** @type {any} */
  #detail;
  #message = "";
  #error = "";
  /** @type {string} a freshly created or reissued link, shown once */
  #newLink = "";

  get #eventId() {
    return this.getAttribute("event-id") ?? "";
  }

  get #base() {
    return `/api/admin/events/${encodeURIComponent(this.#eventId)}`;
  }

  connectedCallback() {
    this.replaceChildren(h("p", { role: "status" }, "Loading event…"));
    void this.#load();
  }

  async #load() {
    try {
      this.#data = await adminApi("GET", `${this.#base}/overview`);
      this.#rows = undefined;
      this.#render();
    } catch {
      setTitle("Event not available");
      this.replaceChildren(
        h("h1", null, "Event"),
        h(
          "wa-callout",
          { variant: "danger", role: "alert" },
          "You do not have access to this event, or it could not be loaded.",
        ),
        h("p", null, h("a", { href: "/admin" }, "Back to your events")),
      );
    }
  }

  /** Runs an action, then reloads and announces the outcome. @param {() => Promise<string>} action */
  async #act(action) {
    this.#error = "";
    this.#message = "";
    try {
      this.#message = await action();
      await this.#load();
    } catch (error) {
      this.#error = describeError(error);
      this.#render();
    }
    this.#focusStatus();
  }

  #focusStatus() {
    /** @type {HTMLElement | null} */ (
      this.querySelector("#status-message")
    )?.focus();
  }

  /** @param {string | undefined} iso */
  #when(iso) {
    if (!iso) return "Not set";
    return new Intl.DateTimeFormat("en-GB", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: this.#data.event.timezone ?? "Europe/London",
    }).format(new Date(iso));
  }

  #render() {
    const { event } = this.#data;
    setTitle(`${event.title}: event dashboard`);
    this.replaceChildren(
      h(
        "div",
        { class: "stack" },
        h(
          "p",
          null,
          h("a", { class: "nav-link", href: "/admin" }, "All events"),
        ),
        h("h1", null, event.title),
        h(
          "div",
          { id: "status-message", tabindex: "-1" },
          this.#error
            ? h("wa-callout", { variant: "danger", role: "alert" }, this.#error)
            : this.#message
              ? h(
                  "wa-callout",
                  { variant: "success", role: "status" },
                  this.#message,
                )
              : null,
        ),
        this.#statusSection(),
        this.#readinessSection(),
        this.#settingsSection(),
        this.#countsSection(),
        this.#linksSection(),
        this.#repliesSection(),
        this.#detail ? this.#detailSection() : null,
        this.#exportsSection(),
        this.#retentionSection(),
      ),
    );
  }

  #statusSection() {
    const { event } = this.#data;
    const closed = event.status === "closed";
    const deadline = h("input", {
      id: "new-deadline",
      type: "datetime-local",
    });
    return h(
      "section",
      { class: "stack", "aria-labelledby": "status-h" },
      h("h2", { id: "status-h" }, "Event status"),
      h(
        "dl",
        { class: "summary" },
        h("dt", null, "Status"),
        h("dd", null, event.status),
        h("dt", null, "Menu"),
        h(
          "dd",
          null,
          this.#data.menu
            ? `${this.#data.menu.title} (${this.#data.menu.status})`
            : "None",
        ),
        h("dt", null, "RSVP deadline"),
        h("dd", null, this.#when(event.rsvpDeadline)),
        h("dt", null, "Order deadline"),
        h("dd", null, this.#when(event.orderDeadline)),
      ),
      event.status === "draft"
        ? h(
            "div",
            { class: "actions" },
            h(
              "wa-button",
              {
                id: "open-orders",
                variant: "brand",
                disabled: this.#data.invitationBlockers.length > 0,
                onclick: () =>
                  this.#act(async () => {
                    await adminApi("POST", `${this.#base}/reopen`, {});
                    return "Orders are open.";
                  }),
              },
              "Open orders",
            ),
          )
        : closed
          ? h(
              "div",
              { class: "stack" },
              h(
                "label",
                { for: "new-deadline" },
                `New order deadline (optional, ${event.timezone ?? "Europe/London"} time)`,
              ),
              deadline,
              h(
                "div",
                { class: "actions" },
                h(
                  "wa-button",
                  {
                    onclick: () =>
                      this.#act(async () => {
                        const value = /** @type {HTMLInputElement} */ (deadline)
                          .value;
                        await adminApi("POST", `${this.#base}/reopen`, {
                          ...(value
                            ? {
                                orderDeadline: zonedLocalToIso(
                                  value,
                                  event.timezone ?? "Europe/London",
                                ),
                              }
                            : {}),
                        });
                        return "Orders are open again.";
                      }),
                  },
                  "Reopen orders",
                ),
              ),
            )
          : h(
              "div",
              { class: "actions" },
              h(
                "wa-button",
                {
                  onclick: () =>
                    this.#act(async () => {
                      await adminApi("POST", `${this.#base}/close`);
                      return "Orders are closed.";
                    }),
                },
                "Close orders now",
              ),
            ),
    );
  }

  #readinessSection() {
    const { readiness, event } = this.#data;
    const outstanding = readiness.filter(
      (/** @type {any} */ r) => r.required && !r.done,
    ).length;
    return h(
      "section",
      { class: "stack", "aria-labelledby": "ready-h" },
      h("h2", { id: "ready-h" }, "Before you can invite people"),
      h(
        "p",
        { id: "ready-summary" },
        outstanding === 0
          ? "Everything required has been supplied."
          : `${outstanding} required ${outstanding === 1 ? "item needs" : "items need"} your input. MealMuster does not guess these.`,
      ),
      h(
        "ul",
        { class: "plain-list checklist" },
        ...readiness.map((/** @type {any} */ r) =>
          h(
            "li",
            null,
            h("strong", null, r.done ? "Done: " : "To do: "),
            r.label,
            r.required ? "" : " (optional)",
            r.detail && !r.done ? `. ${r.detail}` : "",
          ),
        ),
      ),
      event.orderingMode === "rsvp_only"
        ? null
        : h(
            "p",
            null,
            h(
              "a",
              {
                class: "nav-link",
                href: `/admin/events/${encodeURIComponent(event.id)}/menu`,
              },
              "Review and approve the menu",
            ),
          ),
    );
  }

  #settingsSection() {
    const { event } = this.#data;
    const zone = event.timezone ?? "Europe/London";
    /** @param {string} id @param {string} label @param {string | undefined} iso */
    const when = (id, label, iso) => {
      const input = h("input", {
        id,
        type: "datetime-local",
        value: iso ? isoToZonedLocal(iso, zone) : "",
      });
      return {
        input,
        row: h(
          "div",
          { class: "field" },
          h("label", { for: id }, `${label} (${zone} time)`),
          input,
        ),
      };
    };
    const start = when("set-start", "Event starts", event.startAt);
    const rsvp = when("set-rsvp", "RSVP deadline", event.rsvpDeadline);
    const order = when("set-order", "Order deadline", event.orderDeadline);
    /** @param {string} id @param {string} label @param {string | undefined} value @param {string} [hint] */
    const text = (id, label, value, hint = "") =>
      h("wa-input", { id, label, hint, value: value ?? "" });
    /** @param {string} id @param {string} label @param {number | undefined} value @param {string} [hint] */
    const number = (id, label, value, hint = "") =>
      h("wa-input", {
        id,
        label,
        hint,
        type: "number",
        value: value === undefined ? "" : String(value),
      });
    const title = text("set-title", "Event title", event.title);
    const contact = text(
      "set-contact",
      "Organiser contact",
      event.organiserContact,
      "How guests can reach you, for example an email address.",
    );
    const guests = number(
      "set-guests",
      "Guests allowed per booking",
      event.guestLimit,
      "Not counting the person invited.",
    );
    const capacity = number(
      "set-capacity",
      "Total places at the venue",
      event.capacity,
    );
    const retention = number(
      "set-retention",
      "Days to keep personal data after the event",
      event.retentionDays,
    );
    const value = (/** @type {HTMLElement} */ el) =>
      /** @type {HTMLInputElement} */ (el).value.trim();
    const stop = (/** @type {string} */ message) => {
      this.#message = "";
      this.#error = message;
      this.#render();
      this.#focusStatus();
    };
    return h(
      "section",
      { class: "stack", "aria-labelledby": "settings-h" },
      h("h2", { id: "settings-h" }, "Event details"),
      h(
        "form",
        {
          class: "stack",
          novalidate: true,
          onsubmit: (/** @type {SubmitEvent} */ e) => {
            e.preventDefault();
            /** @type {Record<string, any>} */
            const changes = {};
            if (value(title) !== event.title) changes.title = value(title);
            if (value(contact) !== (event.organiserContact ?? ""))
              changes.organiserContact = value(contact);
            /** @type {[string, HTMLElement, string | undefined][]} */
            const dates = [
              ["startAt", start.input, event.startAt],
              ["rsvpDeadline", rsvp.input, event.rsvpDeadline],
              ["orderDeadline", order.input, event.orderDeadline],
            ];
            for (const [key, input, current] of dates) {
              const typed = value(input);
              const before = current ? isoToZonedLocal(current, zone) : "";
              if (!typed || typed === before) continue;
              const iso = zonedLocalToIso(typed, zone);
              if (!iso)
                return stop(
                  `${FIELD_LABEL[/** @type {keyof typeof FIELD_LABEL} */ (key)]}: that date and time does not exist in ${zone}.`,
                );
              changes[key] = iso;
            }
            /** @type {[string, HTMLElement, number | undefined][]} */
            const numbers = [
              ["guestLimit", guests, event.guestLimit],
              ["capacity", capacity, event.capacity],
              ["retentionDays", retention, event.retentionDays],
            ];
            for (const [key, input, current] of numbers) {
              const typed = value(input);
              if (typed !== "" && Number(typed) !== current)
                changes[key] = Number(typed);
            }
            if (Object.keys(changes).length === 0)
              return stop("You have not changed anything.");
            void this.#act(async () => {
              await adminApi("PATCH", this.#base, changes);
              return "Event details saved.";
            });
          },
        },
        title,
        start.row,
        rsvp.row,
        order.row,
        contact,
        guests,
        capacity,
        retention,
        h(
          "wa-button",
          { type: "submit", variant: "brand" },
          "Save event details",
        ),
      ),
    );
  }

  #countsSection() {
    const c = this.#data.counts;
    /** @type {[string, number][]} */
    const rows = [
      ["Links issued", c.invitations],
      ["Waiting for a reply", c.awaitingReply],
      ["Order in progress", c.inProgress],
      ["Replies attending", c.attendingBookings],
      ["People attending", c.attendingDiners],
      ["Replies not attending", c.declined],
      ["Links revoked", c.revoked],
    ];
    return h(
      "section",
      { class: "stack", "aria-labelledby": "counts-h" },
      h("h2", { id: "counts-h" }, "Attendance"),
      h(
        "dl",
        { class: "summary" },
        ...rows.flatMap(([k, v]) => [
          h("dt", null, k),
          h("dd", null, String(v)),
        ]),
      ),
      h(
        "p",
        null,
        "A reply is one invitation’s answer; people are everyone it covers, including guests.",
      ),
    );
  }

  #linksSection() {
    const blockers = this.#data.invitationBlockers;
    const name = h("wa-input", {
      id: "link-name",
      label: "Name for this link",
      hint: "Shown only to you, for example the person or household you are inviting.",
      maxlength: "80",
    });
    return h(
      "section",
      { class: "stack", "aria-labelledby": "links-h" },
      h("h2", { id: "links-h" }, "Private links"),
      blockers.length > 0
        ? h(
            "wa-callout",
            { variant: "warning", role: "status" },
            h("strong", null, "Links cannot be created yet."),
            h(
              "ul",
              null,
              ...blockers.map((/** @type {string} */ b) => h("li", null, b)),
            ),
          )
        : null,
      this.#newLink ? this.#linkBox() : null,
      h(
        "form",
        {
          class: "stack",
          novalidate: true,
          onsubmit: (/** @type {SubmitEvent} */ event) => {
            event.preventDefault();
            void this.#act(async () => {
              const result = await adminApi(
                "POST",
                `${this.#base}/invitations`,
                { displayName: /** @type {HTMLInputElement} */ (name).value },
              );
              this.#newLink = `${location.origin}${result.path}`;
              return "Link created. Copy it now: it will not be shown again.";
            });
          },
        },
        name,
        h(
          "wa-button",
          { type: "submit", variant: "brand", disabled: blockers.length > 0 },
          "Create link",
        ),
      ),
      h(
        "p",
        null,
        "MealMuster never sends these links. Copy each one and share it yourself, for example in Slack. Anyone with a link can edit that booking.",
      ),
    );
  }

  #linkBox() {
    return h(
      "div",
      { class: "stack link-box" },
      h("label", { for: "new-link" }, "New link (shown once)"),
      h("input", {
        id: "new-link",
        type: "text",
        readonly: true,
        value: this.#newLink,
        onfocus: (/** @type {FocusEvent} */ e) =>
          /** @type {HTMLInputElement} */ (e.target).select(),
      }),
      h(
        "div",
        { class: "actions" },
        h(
          "wa-button",
          {
            id: "copy-link",
            onclick: async () => {
              await navigator.clipboard?.writeText(this.#newLink);
              this.#message = "Link copied.";
              this.#render();
              this.#focusStatus();
            },
          },
          "Copy link",
        ),
        h(
          "wa-button",
          {
            onclick: () => {
              this.#newLink = "";
              this.#render();
            },
          },
          "Hide link",
        ),
      ),
    );
  }

  #repliesSection() {
    const rows = this.#rows ?? this.#data.invitations;
    const search = h("wa-input", {
      id: "search",
      label: "Search replies",
      hint: "By link name, contact, diner name or confirmation number.",
      type: "search",
    });
    return h(
      "section",
      { class: "stack", "aria-labelledby": "replies-h" },
      h("h2", { id: "replies-h" }, "Replies"),
      h(
        "form",
        {
          class: "stack",
          novalidate: true,
          onsubmit: async (/** @type {SubmitEvent} */ event) => {
            event.preventDefault();
            const q = /** @type {HTMLInputElement} */ (search).value;
            const result = await adminApi(
              "GET",
              `${this.#base}/bookings?q=${encodeURIComponent(q)}`,
            );
            this.#rows = result.bookings;
            this.#render();
            /** @type {HTMLElement | null} */ (
              this.querySelector("#replies-count")
            )?.focus();
          },
        },
        search,
        h("wa-button", { type: "submit" }, "Search"),
      ),
      h(
        "p",
        { id: "replies-count", tabindex: "-1", role: "status" },
        `${rows.length} ${rows.length === 1 ? "reply" : "replies"} shown`,
      ),
      rows.length === 0
        ? null
        : h(
            "div",
            { class: "table-wrap" },
            h(
              "table",
              null,
              h("caption", null, "Invitations and their replies"),
              h(
                "thead",
                null,
                h(
                  "tr",
                  null,
                  ...["Name", "Reply", "People", "Confirmation", "Actions"].map(
                    (t) => h("th", { scope: "col" }, t),
                  ),
                ),
              ),
              h(
                "tbody",
                null,
                ...rows.map((/** @type {any} */ r) => this.#row(r)),
              ),
            ),
          ),
    );
  }

  /** @param {any} r */
  #row(r) {
    const name = r.displayName ?? r.id;
    /** @param {string} text @param {() => void} onclick */
    const action = (text, onclick) =>
      h(
        "button",
        {
          type: "button",
          class: "link-button",
          "aria-label": `${text} for ${name}`,
          onclick,
        },
        text,
      );
    return h(
      "tr",
      null,
      h("th", { scope: "row" }, name),
      h(
        "td",
        null,
        REPLY_LABEL[/** @type {keyof typeof REPLY_LABEL} */ (r.reply)],
      ),
      h("td", null, String(r.dinerCount)),
      h("td", null, r.confirmationId ?? ""),
      h(
        "td",
        null,
        action("View", () => void this.#view(r.id)),
        r.revoked
          ? null
          : action("Revoke", () =>
              this.#act(async () => {
                await adminApi(
                  "POST",
                  `${this.#base}/invitations/${encodeURIComponent(r.id)}/revoke`,
                );
                return `The link for ${name} no longer works.`;
              }),
            ),
        action("New link", () =>
          this.#act(async () => {
            const result = await adminApi(
              "POST",
              `${this.#base}/invitations/${encodeURIComponent(r.id)}/reissue`,
            );
            this.#newLink = `${location.origin}${result.path}`;
            return `A new link was made for ${name}. The old link no longer works.`;
          }),
        ),
      ),
    );
  }

  /** @param {string} invitationId */
  async #view(invitationId) {
    try {
      this.#detail = await adminApi(
        "GET",
        `${this.#base}/bookings/${encodeURIComponent(invitationId)}`,
      );
      this.#render();
      /** @type {HTMLElement | null} */ (
        this.querySelector("#detail-h")
      )?.focus();
    } catch {
      this.#error = "That reply could not be loaded.";
      this.#render();
      this.#focusStatus();
    }
  }

  #detailSection() {
    const { invitation, booking, history } = this.#detail;
    return h(
      "section",
      { class: "stack", "aria-labelledby": "detail-h" },
      h(
        "h2",
        { id: "detail-h", tabindex: "-1" },
        `Reply from ${invitation.displayName ?? invitation.id}`,
      ),
      !booking
        ? h("p", null, "They have not replied yet.")
        : h(
            "div",
            { class: "stack" },
            h(
              "dl",
              { class: "summary" },
              h("dt", null, "Contact"),
              h("dd", null, booking.contactName || "Not given"),
              h("dt", null, "Reply"),
              h(
                "dd",
                null,
                REPLY_LABEL[
                  /** @type {keyof typeof REPLY_LABEL} */ (invitation.reply)
                ],
              ),
              h("dt", null, "Confirmation"),
              h("dd", null, booking.confirmationId ?? "Not submitted"),
            ),
            ...booking.diners.map((/** @type {any} */ d) =>
              h(
                "div",
                null,
                h("h3", null, d.name || "Unnamed diner"),
                h(
                  "ul",
                  { class: "review-list" },
                  ...(d.selections ?? []).map((/** @type {any} */ s) =>
                    h(
                      "li",
                      null,
                      `${s.quantity} × ${s.nameSnapshot ?? s.menuItemId}`,
                    ),
                  ),
                ),
                d.dietaryNotes
                  ? h("p", null, `Dietary request: ${d.dietaryNotes}`)
                  : null,
              ),
            ),
          ),
      h("h3", null, "History"),
      history.length === 0
        ? h("p", null, "No changes recorded.")
        : h(
            "ul",
            { class: "review-list" },
            ...history.map((/** @type {any} */ e) =>
              h(
                "li",
                null,
                `${this.#when(e.timestamp)}: ${e.actor} – ${e.action.replace(".", " ")}`,
              ),
            ),
          ),
      h(
        "div",
        { class: "actions" },
        h(
          "wa-button",
          {
            onclick: () => {
              this.#detail = undefined;
              this.#render();
            },
          },
          "Close details",
        ),
      ),
    );
  }

  #exportsSection() {
    const id = this.#eventId;
    /** @param {string} kind @param {string} label @param {string} [hint] */
    const exportButton = (kind, label, hint) =>
      h(
        "li",
        null,
        h(
          "wa-button",
          {
            onclick: () =>
              this.#act(async () => {
                await downloadCsv(
                  `${this.#base}/exports/${kind}`,
                  `${id}-${kind}.csv`,
                );
                return `${label} downloaded.`;
              }),
          },
          label,
        ),
        hint ? h("p", null, hint) : null,
      );
    return h(
      "section",
      { class: "stack", "aria-labelledby": "exports-h" },
      h("h2", { id: "exports-h" }, "Exports"),
      h(
        "ul",
        { class: "plain-list" },
        exportButton(
          "attendance",
          "Attendance CSV",
          "Who replied and who is coming. No dietary requests.",
        ),
        exportButton(
          "restaurant",
          "Restaurant order CSV",
          "One row per person and item. Includes dietary requests: send only to the venue.",
        ),
        exportButton(
          "aggregate",
          "Item totals CSV",
          "How many of each item to order.",
        ),
      ),
      h(
        "p",
        null,
        h(
          "a",
          {
            class: "nav-link",
            href: `/admin/events/${encodeURIComponent(id)}/summary`,
          },
          "Open printable summary",
        ),
      ),
    );
  }

  #retentionSection() {
    const { retention, event, role } = this.#data;
    const canDelete =
      role === "owner" &&
      event.status === "closed" &&
      !retention.privateDataDeletedAt;
    const confirm = h("wa-input", {
      id: "confirm-title",
      label: `Type “${event.title}” to confirm`,
    });
    return h(
      "section",
      { class: "stack", "aria-labelledby": "retention-h" },
      h("h2", { id: "retention-h" }, "Personal data and retention"),
      h(
        "dl",
        { class: "summary" },
        h("dt", null, "Retention period"),
        h(
          "dd",
          null,
          retention.days ? `${retention.days} days after the event` : "Not set",
        ),
        h("dt", null, "Delete after"),
        h(
          "dd",
          null,
          retention.deleteAfter
            ? this.#when(retention.deleteAfter)
            : "Not scheduled",
        ),
        h("dt", null, "Personal data"),
        h(
          "dd",
          null,
          retention.privateDataDeletedAt
            ? `Deleted ${this.#when(retention.privateDataDeletedAt)}`
            : "Held",
        ),
      ),
      canDelete
        ? h(
            "form",
            {
              class: "stack",
              novalidate: true,
              onsubmit: (/** @type {SubmitEvent} */ e) => {
                e.preventDefault();
                void this.#act(async () => {
                  await adminApi("DELETE", `${this.#base}/data`, {
                    confirmTitle: /** @type {HTMLInputElement} */ (confirm)
                      .value,
                  });
                  return "Names, orders and links for this event have been deleted.";
                });
              },
            },
            h(
              "p",
              null,
              "This permanently deletes every link and reply for this event. It cannot be undone.",
            ),
            confirm,
            h(
              "wa-button",
              { type: "submit", variant: "danger" },
              "Delete personal data",
            ),
          )
        : h(
            "p",
            null,
            role === "owner"
              ? "Close the event before deleting its personal data."
              : "Only an organisation owner can delete personal data.",
          ),
    );
  }
}

customElements.define("mm-admin-event", MmAdminEvent);
