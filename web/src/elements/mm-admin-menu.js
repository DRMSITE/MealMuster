// @ts-check

import { formatMoney } from "../../../shared/money.js";
import { adminApi } from "../admin/admin-api.js";
import { h, setTitle } from "../dom.js";

/**
 * Menu review (attribute: event-id). An organiser checks every item against
 * what the venue has confirmed, corrects names, marks items that are not
 * offered, then approves. Approval is final: an approved menu is read-only.
 * Printed prices come from the source document and are shown for reference
 * only; they are never used as ordering prices.
 */
export class MmAdminMenu extends HTMLElement {
  /** @type {any} */
  #menu;
  /** @type {Map<string, { name: string, available: boolean, verified: boolean }>} */
  #edits = new Map();
  #message = "";
  #error = "";

  get #base() {
    return `/api/admin/events/${encodeURIComponent(this.getAttribute("event-id") ?? "")}`;
  }

  connectedCallback() {
    this.replaceChildren(h("p", { role: "status" }, "Loading menu…"));
    void this.#load();
  }

  async #load() {
    try {
      const { menu } = await adminApi("GET", `${this.#base}/menu`);
      this.#menu = menu;
      this.#edits = new Map(
        menu.sections
          .flatMap((/** @type {any} */ s) => s.items)
          .map((/** @type {any} */ i) => [
            i.id,
            {
              name: i.name,
              available: i.available,
              verified: i.verification !== "needs-manual-review",
            },
          ]),
      );
      this.#render();
    } catch {
      setTitle("Menu not available");
      this.replaceChildren(
        h("h1", null, "Review menu"),
        h(
          "wa-callout",
          { variant: "danger", role: "alert" },
          "You do not have access to this menu, or it could not be loaded.",
        ),
      );
    }
  }

  get #items() {
    return this.#menu.sections.flatMap((/** @type {any} */ s) => s.items);
  }

  /** Items whose on-screen state differs from what is saved. */
  get #changes() {
    return this.#items.flatMap((/** @type {any} */ item) => {
      const edit = this.#edits.get(item.id);
      if (!edit) return [];
      const verified = item.verification !== "needs-manual-review";
      return edit.name !== item.name ||
        edit.available !== item.available ||
        edit.verified !== verified
        ? [{ id: item.id, ...edit }]
        : [];
    });
  }

  get #approved() {
    return this.#menu.status !== "draft";
  }

  #summaryText() {
    const total = this.#items.length;
    const checked = this.#items.filter(
      (/** @type {any} */ i) => i.verification !== "needs-manual-review",
    ).length;
    return `${checked} of ${total} items saved as checked.`;
  }

  /** @param {() => Promise<string>} action */
  async #act(action) {
    this.#message = "";
    this.#error = "";
    try {
      this.#message = await action();
      await this.#load();
    } catch (error) {
      this.#error =
        error instanceof Error ? error.message : "Something went wrong.";
      this.#render();
    }
    /** @type {HTMLElement | null} */ (
      this.querySelector("#menu-status")
    )?.focus();
  }

  #render() {
    setTitle(`Review menu: ${this.#menu.title}`);
    const id = encodeURIComponent(this.getAttribute("event-id") ?? "");
    const dirty = this.#changes.length > 0;
    const allChecked = this.#items.every(
      (/** @type {any} */ i) => i.verification !== "needs-manual-review",
    );
    const confirm = h("input", {
      id: "confirm-approve",
      type: "checkbox",
      onchange: () => {
        const button = /** @type {HTMLElement} */ (
          this.querySelector("#approve-menu")
        );
        const box = /** @type {HTMLInputElement} */ (confirm);
        if (button)
          button.toggleAttribute(
            "disabled",
            !box.checked || dirty || !allChecked,
          );
      },
    });
    this.replaceChildren(
      h(
        "div",
        { class: "stack" },
        h(
          "p",
          null,
          h(
            "a",
            { class: "nav-link", href: `/admin/events/${id}` },
            "Back to the event",
          ),
        ),
        h("h1", null, `Review menu: ${this.#menu.title}`),
        h(
          "div",
          { id: "menu-status", tabindex: "-1" },
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
        h(
          "wa-callout",
          { variant: this.#approved ? "success" : "warning" },
          h("strong", null, `Status: ${this.#menu.status}. `),
          this.#approved
            ? "This menu is approved and can no longer be edited."
            : "Guests cannot order from a draft menu.",
        ),
        this.#menu.importWarning
          ? h("p", null, `Note from the import: ${this.#menu.importWarning}`)
          : null,
        this.#approved
          ? null
          : h(
              "p",
              null,
              "Check every item against what the venue has confirmed. Printed prices are copied from the source for reference and are not used for ordering. Labels such as (V) or (GF) are what the source printed: they are not a guarantee, so please confirm allergies with the venue.",
            ),
        h("p", { id: "check-summary", role: "status" }, this.#summaryText()),
        ...this.#menu.sections.map((/** @type {any} */ section) =>
          this.#sectionTable(section),
        ),
        this.#approved
          ? null
          : h(
              "div",
              { class: "stack" },
              h(
                "div",
                { class: "actions" },
                h(
                  "wa-button",
                  {
                    id: "save-menu",
                    variant: "brand",
                    disabled: !dirty,
                    onclick: () =>
                      this.#act(async () => {
                        await adminApi("POST", `${this.#base}/menu/review`, {
                          items: this.#changes,
                        });
                        return "Your checks are saved.";
                      }),
                  },
                  "Save checks",
                ),
              ),
              h("h2", null, "Approve this menu"),
              h(
                "p",
                null,
                "Approving makes the menu final. Guests will be able to order from it once the event is open, and you will not be able to change it.",
              ),
              dirty
                ? h(
                    "p",
                    { role: "status" },
                    "Save your checks before approving.",
                  )
                : null,
              !allChecked && !dirty
                ? h(
                    "p",
                    null,
                    "Every item must be checked before the menu can be approved.",
                  )
                : null,
              h(
                "div",
                { class: "field" },
                confirm,
                h(
                  "label",
                  { for: "confirm-approve" },
                  "I have checked every item with the venue",
                ),
              ),
              h(
                "div",
                { class: "actions" },
                h(
                  "wa-button",
                  {
                    id: "approve-menu",
                    variant: "brand",
                    disabled: true,
                    onclick: () =>
                      this.#act(async () => {
                        await adminApi("POST", `${this.#base}/menu/approve`);
                        return "The menu is approved.";
                      }),
                  },
                  "Approve menu",
                ),
              ),
            ),
      ),
    );
  }

  /** @param {any} section */
  #sectionTable(section) {
    const locked = this.#approved;
    return h(
      "div",
      { class: "table-wrap" },
      h(
        "table",
        null,
        h("caption", null, section.name),
        h(
          "thead",
          null,
          h(
            "tr",
            null,
            ...[
              "Checked",
              "Item name",
              "Printed labels",
              "Printed price",
              "Offered",
            ].map((t) => h("th", { scope: "col" }, t)),
          ),
        ),
        h(
          "tbody",
          null,
          ...section.items.map((/** @type {any} */ item) => {
            const edit = this.#edits.get(item.id) ?? {
              name: item.name,
              available: item.available,
              verified: false,
            };
            return h(
              "tr",
              null,
              h(
                "td",
                null,
                h("input", {
                  type: "checkbox",
                  checked: edit.verified,
                  disabled: locked,
                  "aria-label": `Checked against the venue: ${item.name}`,
                  onchange: (/** @type {Event} */ e) => {
                    edit.verified = /** @type {HTMLInputElement} */ (
                      e.target
                    ).checked;
                    this.#edits.set(item.id, edit);
                    this.#render();
                    this.#refocus(
                      `[data-item="${item.id}"][data-kind="checked"]`,
                    );
                  },
                  "data-item": item.id,
                  "data-kind": "checked",
                }),
              ),
              h(
                "th",
                { scope: "row" },
                h("input", {
                  type: "text",
                  value: edit.name,
                  maxlength: "200",
                  disabled: locked,
                  "aria-label": `Name of item: ${item.name}`,
                  oninput: (/** @type {Event} */ e) => {
                    edit.name = /** @type {HTMLInputElement} */ (
                      e.target
                    ).value;
                    this.#edits.set(item.id, edit);
                    this.#syncSave();
                  },
                }),
              ),
              h(
                "td",
                null,
                item.tags.length > 0
                  ? item.tags
                      .map((/** @type {string} */ t) => `(${t})`)
                      .join(" ")
                  : "None printed",
              ),
              h(
                "td",
                null,
                item.printedPriceMinor === undefined
                  ? "Not printed"
                  : formatMoney(item.printedPriceMinor, this.#menu.currency),
              ),
              h(
                "td",
                null,
                h("input", {
                  type: "checkbox",
                  checked: edit.available,
                  disabled: locked,
                  "aria-label": `Offered by the venue: ${item.name}`,
                  "data-item": item.id,
                  "data-kind": "offered",
                  onchange: (/** @type {Event} */ e) => {
                    edit.available = /** @type {HTMLInputElement} */ (
                      e.target
                    ).checked;
                    // Deciding an item is not offered is itself a check.
                    if (!edit.available) edit.verified = true;
                    this.#edits.set(item.id, edit);
                    this.#render();
                    this.#refocus(
                      `[data-item="${item.id}"][data-kind="offered"]`,
                    );
                  },
                }),
              ),
            );
          }),
        ),
      ),
    );
  }

  /** Enables the save button while typing, without re-rendering the text field. */
  #syncSave() {
    this.querySelector("#save-menu")?.toggleAttribute(
      "disabled",
      this.#changes.length === 0,
    );
  }

  /** @param {string} selector */
  #refocus(selector) {
    /** @type {HTMLElement | null} */ (this.querySelector(selector))?.focus();
  }
}

customElements.define("mm-admin-menu", MmAdminMenu);
