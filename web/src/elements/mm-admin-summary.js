// @ts-check
import { adminApi } from "../admin/admin-api.js";
import { h, setTitle } from "../dom.js";

/**
 * Printable, restaurant-facing order summary (attribute: event-id). Grouped by
 * booking and diner, then by item. Dietary requests are shown as supplied and
 * are never presented as allergy-safe instructions.
 */
export class MmAdminSummary extends HTMLElement {
  connectedCallback() {
    this.replaceChildren(h("p", { role: "status" }, "Loading summary…"));
    void this.#load();
  }

  async #load() {
    const id = encodeURIComponent(this.getAttribute("event-id") ?? "");
    try {
      const data = await adminApi("GET", `/api/admin/events/${id}/summary`);
      this.#render(id, data);
    } catch {
      setTitle("Summary not available");
      this.replaceChildren(
        h("h1", null, "Order summary"),
        h(
          "wa-callout",
          { variant: "danger", role: "alert" },
          "You do not have access to this event, or the summary could not be loaded.",
        ),
      );
    }
  }

  /** @param {string} id @param {any} data */
  #render(id, data) {
    setTitle(`Order summary: ${data.event.title}`);
    const { totals } = data;
    this.replaceChildren(
      h(
        "div",
        { class: "stack summary-sheet" },
        h(
          "p",
          { class: "no-print" },
          h(
            "a",
            { class: "nav-link", href: `/admin/events/${id}` },
            "Back to the event",
          ),
        ),
        h("h1", null, `Order summary: ${data.event.title}`),
        h(
          "wa-button",
          {
            class: "no-print",
            variant: "brand",
            onclick: () => window.print(),
          },
          "Print this summary",
        ),
        h(
          "p",
          null,
          `${totals.bookings} ${totals.bookings === 1 ? "booking" : "bookings"}, ${totals.diners} ${totals.diners === 1 ? "person" : "people"}, ${totals.items} items.`,
        ),
        h(
          "p",
          null,
          "Dietary requests are shown as the guest wrote them. They are not confirmed by the venue: please confirm every allergy directly with the venue.",
        ),
        h("h2", null, "Totals by item"),
        data.byItem.length === 0
          ? h("p", null, "No items have been ordered yet.")
          : h(
              "table",
              null,
              h("caption", null, "Quantity of each item"),
              h(
                "thead",
                null,
                h(
                  "tr",
                  null,
                  ...["Item", "Options", "Quantity"].map((t) =>
                    h("th", { scope: "col" }, t),
                  ),
                ),
              ),
              h(
                "tbody",
                null,
                ...data.byItem.map((/** @type {any} */ i) =>
                  h(
                    "tr",
                    null,
                    h(
                      "th",
                      { scope: "row" },
                      i.section ? `${i.section}: ${i.name}` : i.name,
                    ),
                    h("td", null, i.options),
                    h("td", null, String(i.quantity)),
                  ),
                ),
              ),
            ),
        h("h2", null, "By booking and person"),
        ...data.bookings.map((/** @type {any} */ b) =>
          h(
            "section",
            { class: "booking-block" },
            h("h3", null, `${b.confirmationId}: ${b.contactName}`),
            ...b.diners.map((/** @type {any} */ d) =>
              h(
                "div",
                null,
                h("h4", null, d.name || "Unnamed diner"),
                h(
                  "ul",
                  { class: "review-list" },
                  ...d.items.map((/** @type {any} */ i) =>
                    h(
                      "li",
                      null,
                      `${i.quantity} × ${i.name}${i.options ? ` (${i.options})` : ""}${i.notes ? ` – ${i.notes}` : ""}`,
                    ),
                  ),
                ),
                d.dietaryNotes
                  ? h("p", null, `Dietary request: ${d.dietaryNotes}`)
                  : null,
              ),
            ),
          ),
        ),
      ),
    );
  }
}

customElements.define("mm-admin-summary", MmAdminSummary);
