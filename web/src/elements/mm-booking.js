// @ts-check
import { formatMoney } from "../../../shared/money.js";
import { validateBooking } from "../../../shared/ordering.js";
import { ApiError, api, setCsrfToken } from "../api.js";
import { h, setTitle } from "../dom.js";

/**
 * Invitee booking flow: RSVP, diners, per-diner menu choices, review, submit.
 * Light DOM so it can be styled externally. No attributes or custom events.
 * All user text is rendered as text, never HTML.
 *
 * @typedef {{ menuItemId: string, quantity: number, optionIds?: string[] }} Sel
 * @typedef {{ id: string, name: string, isContact: boolean, dietaryNotes?: string, selections: Sel[] }} DinerState
 */

/** @type {Record<string, string>} */
const CLOSED_REASONS = {
  deadline_passed:
    "The deadline for this event has passed, so bookings can no longer be changed. Please contact the organiser.",
  menu_not_approved:
    "The menu for this event has not been confirmed yet. Please check back later.",
  event_not_open: "This event is not open for bookings yet.",
  deadline_not_set: "This event is not open for bookings yet.",
};

export class MmBooking extends HTMLElement {
  /** @type {any} */ #session;
  /** @type {any} */ #menu;
  /** @type {any} */ #stored;
  /** @type {{ attendance: string, contactName: string, partyNotes?: string, diners: DinerState[], version: number }} */
  #draft = { attendance: "", contactName: "", diners: [], version: 0 };
  #contactEats = true;
  #dirty = false;
  #reviewing = false;
  /** @type {any[]} */ #issues = [];
  #notice = "";
  #nextId = 1;
  #error = "";

  connectedCallback() {
    window.addEventListener("beforeunload", (event) => {
      if (this.#dirty) event.preventDefault();
    });
    void this.#load();
  }

  async #load() {
    this.replaceChildren(
      h("p", { role: "status" }, "Loading your invitation…"),
    );
    try {
      this.#session = await api("GET", "/api/session");
      setCsrfToken(this.#session.csrfToken);
      if (this.#session.event.orderingMode !== "rsvp_only") {
        try {
          this.#menu = (
            await api(
              "GET",
              `/api/events/${encodeURIComponent(this.#session.event.id)}/menu`,
            )
          ).menu;
        } catch (error) {
          if (
            !(error instanceof ApiError && error.code === "menu_not_approved")
          )
            throw error;
        }
      }
      this.#stored = (await api("GET", "/api/booking")).booking;
      this.#adoptStored();
      this.#render();
    } catch (error) {
      this.#renderFatal(error);
    }
  }

  #adoptStored() {
    const b = this.#stored;
    this.#draft = b
      ? {
          attendance: b.attendance,
          contactName: b.contactName,
          partyNotes: b.partyNotes,
          diners: structuredClone(b.diners),
          version: b.version,
        }
      : {
          attendance: "",
          contactName: this.#session.invitation.displayName ?? "",
          diners: [],
          version: 0,
        };
    this.#contactEats =
      this.#draft.diners.length === 0 ||
      this.#draft.diners.some((d) => d.isContact);
    this.#dirty = false;
  }

  /** @param {unknown} error */
  #renderFatal(error) {
    setTitle("Booking unavailable");
    const unauth = error instanceof ApiError && error.status === 401;
    this.replaceChildren(
      h("h1", null, "We could not open your booking"),
      h(
        "wa-callout",
        { variant: "danger", role: "alert" },
        unauth
          ? "Your session has ended. Please open your invitation link again."
          : "Something went wrong. Please reload the page.",
      ),
    );
  }

  get #canEdit() {
    return this.#session.permissions.canEdit;
  }

  get #event() {
    return this.#session.event;
  }

  #focusSeq = 0;

  /** @param {string} selector */
  #focus(selector) {
    this.#focusSeq += 1;
    void this.#focusWhenReady(selector, this.#focusSeq);
  }

  /** @param {string} selector @param {number} seq */
  async #focusWhenReady(selector, seq) {
    const el =
      /** @type {(HTMLElement & {updateComplete?: Promise<unknown>}) | null} */ (
        this.querySelector(selector)
      );
    // Web Awesome elements finish rendering asynchronously; focusing earlier is lost.
    await el?.updateComplete;
    // A later request (for example the error summary) wins over a restore.
    if (seq !== this.#focusSeq || !el) return;
    el.focus();
    // Radios get their tabindex from the group after their own update, so keep
    // trying for a few frames until the browser accepts focus.
    for (
      let frame = 0;
      frame < 10 && document.activeElement !== el;
      frame += 1
    ) {
      await new Promise(requestAnimationFrame);
      if (seq !== this.#focusSeq) return;
      el.focus();
    }
  }

  /**
   * Re-render after the current event has finished. Web Awesome controls are
   * still using their own DOM while their `change` event is dispatched.
   */
  #renderSoon() {
    setTimeout(() => this.#render(), 0);
  }

  /** Re-renders while keeping keyboard focus on the same control. */
  #render() {
    const focusSelector = this.#focusedSelector();
    const scrollY = window.scrollY;
    this.replaceChildren(
      ...(this.#submittedView() ?? [
        this.#reviewing ? this.#reviewView() : this.#formView(),
      ]),
    );
    window.scrollTo(0, scrollY);
    this.#updateTitle();
    if (focusSelector) this.#focus(focusSelector);
  }

  /** One distinct title per state of the page. */
  #updateTitle() {
    const state = this.querySelector("#confirmation")
      ? "Booking confirmed"
      : this.querySelector("#review-title")
        ? "Check your order"
        : this.querySelector("#error-summary")
          ? "Please correct your booking"
          : this.querySelector("#review")
            ? "Your booking"
            : "Not open for orders";
    setTitle(`${state}: ${this.#event.title}`);
  }

  /** Selector that finds the focused control again after a re-render. */
  #focusedSelector() {
    const active = document.activeElement;
    if (!(active instanceof HTMLElement) || !this.contains(active)) return "";
    if (active.id) return `#${CSS.escape(active.id)}`;
    // Radios and checkboxes have no id of their own: use their group and value.
    const value = active.getAttribute("value");
    const group = active.parentElement?.closest("[id]");
    return group?.id && value
      ? `#${CSS.escape(group.id)} ${active.localName}[value="${CSS.escape(value)}"]`
      : "";
  }

  #submittedView() {
    const b = this.#stored;
    if (
      !(b?.status === "submitted") ||
      this.#dirty ||
      this.#reviewing ||
      this.#editing
    )
      return null;
    // A native wrapper takes focus: custom elements are not reliably focusable.
    const confirmation = h(
      "div",
      { role: "status", tabindex: "-1", id: "confirmation" },
      h(
        "wa-callout",
        { variant: "success" },
        h(
          "strong",
          null,
          b.attendance === "yes"
            ? "Your booking is submitted."
            : "Your reply is recorded.",
        ),
        " Your confirmation number is ",
        h("strong", null, b.confirmationId ?? ""),
        ".",
      ),
    );
    const edit = this.#canEdit
      ? h(
          "wa-button",
          {
            id: "edit-booking",
            onclick: () => {
              this.#editing = true;
              this.#render();
            },
          },
          "Change my booking",
        )
      : h(
          "p",
          null,
          CLOSED_REASONS[this.#session.permissions.closedReason] ??
            "Bookings are closed.",
        );
    return [
      h("h1", { tabindex: "-1", id: "page-title" }, this.#event.title),
      confirmation,
      this.#summary(b),
      edit,
    ];
  }

  #editing = false;

  #formView() {
    /** @type {(HTMLElement | null)[]} */
    const parts = [
      h("h1", { tabindex: "-1", id: "page-title" }, this.#event.title),
      this.#eventDetails(),
    ];
    if (!this.#canEdit) {
      parts.push(
        h(
          "wa-callout",
          { variant: "warning", role: "status" },
          CLOSED_REASONS[this.#session.permissions.closedReason] ??
            "Bookings are closed.",
        ),
      );
      return h(
        "div",
        { class: "stack" },
        ...parts,
        ...(this.#stored ? [this.#summary(this.#stored)] : []),
      );
    }
    if (this.#notice)
      parts.push(
        h(
          "wa-callout",
          { variant: "success", role: "status", id: "notice" },
          this.#notice,
        ),
      );
    if (this.#error)
      parts.push(
        h(
          "wa-callout",
          { variant: "danger", role: "alert", id: "error" },
          this.#error,
        ),
      );
    if (this.#issues.length) parts.push(this.#errorSummary());
    parts.push(this.#rsvpFields());
    if (this.#draft.attendance === "yes") parts.push(...this.#dinerSection());
    parts.push(this.#actions());
    return h(
      "form",
      {
        class: "stack",
        novalidate: true,
        onsubmit: (/** @type {Event} */ e) => e.preventDefault(),
      },
      ...parts,
    );
  }

  #eventDetails() {
    const e = this.#event;
    const when = e.startAt
      ? new Intl.DateTimeFormat("en-GB", {
          dateStyle: "full",
          timeStyle: "short",
          timeZone: e.timezone || undefined,
        }).format(new Date(e.startAt))
      : "To be confirmed";
    const deadline = e.orderDeadline ?? e.rsvpDeadline;
    const rows = [
      ["When", when],
      [
        "Where",
        e.venue
          ? [e.venue.name, e.venue.address].filter(Boolean).join(", ")
          : "To be confirmed",
      ],
      [
        "Reply by",
        deadline
          ? new Intl.DateTimeFormat("en-GB", {
              dateStyle: "long",
              timeStyle: "short",
              timeZone: e.timezone || undefined,
            }).format(new Date(deadline))
          : "To be confirmed",
      ],
      ...(e.organiserContact ? [["Organiser", e.organiserContact]] : []),
    ];
    return h(
      "section",
      { "aria-labelledby": "details-h" },
      h("h2", { id: "details-h" }, "Event details"),
      e.description ? h("p", null, e.description) : null,
      h(
        "dl",
        { class: "summary" },
        ...rows.flatMap(([k, v]) => [h("dt", null, k), h("dd", null, v)]),
      ),
      e.instructions ? h("p", null, e.instructions) : null,
      h(
        "p",
        null,
        "We only keep the names and choices needed to place this order, and the organiser will delete them after the event.",
      ),
    );
  }

  #errorSummary() {
    // A native wrapper takes focus; custom elements may not be focusable yet.
    return h(
      "div",
      { role: "alert", tabindex: "-1", id: "error-summary" },
      h(
        "wa-callout",
        { variant: "danger" },
        h("strong", null, "Please fix the following:"),
        h(
          "ul",
          null,
          ...this.#issues.map((issue) => {
            const target = this.#issueTarget(issue);
            return h(
              "li",
              null,
              h(
                "a",
                {
                  class: "error-link",
                  href: target,
                  onclick: (/** @type {MouseEvent} */ e) => {
                    e.preventDefault();
                    this.#focus(target);
                  },
                },
                this.#issueLabel(issue),
              ),
            );
          }),
        ),
      ),
    );
  }

  /**
   * Where an error's link should send focus: the field itself when there is
   * one, otherwise the heading of the diner whose choices are wrong.
   * @param {{ path: string }} issue
   */
  #issueTarget(issue) {
    const match = /^diners\[(\d+)\]\.(\w+)/.exec(issue.path);
    if (match) {
      const diner = this.#draft.diners[Number(match[1])];
      if (diner)
        return match[2] === "name"
          ? `#name-${diner.id}`
          : match[2] === "dietaryNotes"
            ? `#diet-${diner.id}`
            : `#title-${diner.id}`;
    }
    if (issue.path === "contactName") return "#contactName";
    if (issue.path === "attendance") return "#attendance";
    return "#page-title";
  }

  /** @param {{ path: string, message: string }} issue */
  #issueLabel(issue) {
    const match = /^diners\[(\d+)\]/.exec(issue.path);
    if (!match) return issue.message;
    const diner = this.#draft.diners[Number(match[1])];
    return `${diner?.name?.trim() || `Diner ${Number(match[1]) + 1}`}: ${issue.message}`;
  }

  #rsvpFields() {
    const group = h(
      "wa-radio-group",
      {
        id: "attendance",
        label: "Will you be attending?",
        name: "attendance",
        required: true,
        value: this.#draft.attendance,
        orientation: "vertical",
      },
      h("wa-radio", { value: "yes" }, "Attending"),
      h("wa-radio", { value: "no" }, "Not attending"),
    );
    group.addEventListener("change", () => {
      this.#draft.attendance = /** @type {any} */ (group).value;
      if (this.#draft.attendance === "yes") this.#syncContactDiner();
      this.#touch();
      this.#renderSoon();
    });
    const name = this.#input(
      "contactName",
      "Your name",
      this.#draft.contactName,
      (v) => {
        this.#draft.contactName = v;
        const contact = this.#draft.diners.find((d) => d.isContact);
        if (contact && !contact.name.trim()) contact.name = v;
      },
      { autocomplete: "name", required: true },
    );
    return h(
      "div",
      { class: "stack" },
      h("h2", null, "Your reply"),
      group,
      name,
    );
  }

  #syncContactDiner() {
    const hasContact = this.#draft.diners.some((d) => d.isContact);
    if (this.#contactEats && !hasContact)
      this.#draft.diners.unshift(this.#newDiner(this.#draft.contactName, true));
    if (!this.#contactEats && hasContact)
      this.#draft.diners = this.#draft.diners.filter((d) => !d.isContact);
  }

  /** @param {string} name @param {boolean} isContact @returns {DinerState} */
  #newDiner(name, isContact) {
    return {
      id: `d${Date.now().toString(36)}${this.#nextId++}`,
      name,
      isContact,
      selections: [],
    };
  }

  /** @param {string} id @param {string} label @param {string} value @param {(v: string) => void} onInput @param {Record<string, any>} [extra] */
  #input(id, label, value, onInput, extra = {}) {
    const el = h("wa-input", { id, label, value, name: id, ...extra });
    el.addEventListener("input", () => {
      onInput(/** @type {any} */ (el).value);
      this.#touch();
    });
    return el;
  }

  #touch() {
    this.#dirty = true;
    this.#notice = "";
  }

  #dinerSection() {
    const e = this.#event;
    const guests = this.#draft.diners.filter((d) => !d.isContact).length;
    const atLimit = e.guestLimit !== undefined && guests >= e.guestLimit;
    /** @type {(HTMLElement | null)[]} */
    const parts = [h("h2", null, "Who is eating?")];
    if (e.allowContactNotAttending) {
      const eats = h(
        "wa-checkbox",
        { id: "contact-eats", checked: this.#contactEats },
        "I will be eating myself",
      );
      eats.addEventListener("change", () => {
        this.#contactEats = /** @type {any} */ (eats).checked;
        this.#syncContactDiner();
        this.#touch();
        this.#renderSoon();
      });
      parts.push(eats);
    }
    if (this.#menu)
      parts.push(
        h(
          "wa-callout",
          { variant: "warning" },
          "Labels such as (V) or (GF) are printed by the venue. They are not a guarantee that a dish is safe for an allergy. Please confirm allergies directly with the venue.",
        ),
      );
    for (const [i, d] of this.#draft.diners.entries())
      parts.push(this.#dinerCard(d, i));
    parts.push(
      h(
        "div",
        { class: "actions" },
        h(
          "wa-button",
          {
            id: "add-guest",
            disabled: atLimit,
            onclick: () => this.#addGuest(),
          },
          "Add a guest",
        ),
      ),
      atLimit
        ? h(
            "p",
            null,
            `The limit is ${e.guestLimit} guest${e.guestLimit === 1 ? "" : "s"}.`,
          )
        : null,
    );
    return parts;
  }

  #addGuest() {
    const guest = this.#newDiner("", false);
    this.#draft.diners.push(guest);
    this.#touch();
    this.#render();
    this.#focus(`#name-${guest.id}`);
  }

  /** @param {DinerState} d @param {number} i */
  #dinerCard(d, i) {
    const title = d.name.trim()
      ? `Diner ${i + 1}: ${d.name.trim()}`
      : `Diner ${i + 1}`;
    const remove = d.isContact
      ? null
      : h(
          "wa-button",
          {
            id: `remove-${d.id}`,
            variant: "danger",
            appearance: "outlined",
            onclick: () => this.#removeDiner(d),
          },
          `Remove ${d.name.trim() || `diner ${i + 1}`}`,
        );
    const heading = h("h3", { id: `title-${d.id}`, tabindex: "-1" }, title);
    const nameInput = this.#input(
      `name-${d.id}`,
      d.isContact ? "Name (you)" : "Guest name",
      d.name,
      (v) => {
        d.name = v;
        heading.textContent = v.trim()
          ? `Diner ${i + 1}: ${v.trim()}`
          : `Diner ${i + 1}`;
      },
      { required: true },
    );
    const notes = h("wa-textarea", {
      id: `diet-${d.id}`,
      label: "Dietary requests (optional)",
      hint: "Only include what the venue needs. The organiser must confirm allergies with the venue directly.",
      value: d.dietaryNotes ?? "",
      rows: 2,
      maxlength: 300,
    });
    notes.addEventListener("input", () => {
      d.dietaryNotes = /** @type {any} */ (notes).value;
      this.#touch();
    });
    return h(
      "wa-card",
      { "aria-labelledby": `title-${d.id}` },
      h(
        "div",
        { class: "stack" },
        heading,
        nameInput,
        notes,
        ...this.#menuFor(d),
        h("div", { class: "diner-actions" }, remove),
      ),
    );
  }

  /** @param {DinerState} d */
  #removeDiner(d) {
    this.#draft.diners = this.#draft.diners.filter((x) => x !== d);
    this.#touch();
    this.#render();
    this.#focus("#add-guest");
  }

  /** @param {DinerState} d */
  #menuFor(d) {
    if (!this.#menu)
      return this.#event.orderingMode === "rsvp_only"
        ? []
        : [h("p", null, "The menu is not available yet.")];
    const rules = this.#event.rules ?? [];
    return this.#menu.sections.map((/** @type {any} */ section) => {
      const single = rules.some(
        (/** @type {any} */ r) =>
          r.sectionId === section.id && r.perDiner && r.maxSelections === 1,
      );
      const rows = single
        ? this.#singleChoice(d, section)
        : section.items.map((/** @type {any} */ item) =>
            this.#itemRow(d, item),
          );
      return h(
        "fieldset",
        { class: "menu-section" },
        h("legend", null, section.name),
        ...(Array.isArray(rows) ? rows : [rows]),
      );
    });
  }

  /** @param {any} item */
  #label(item) {
    const price =
      this.#event.showPrices &&
      Number.isInteger(item.priceMinor) &&
      item.priceMinor > 0
        ? ` — ${formatMoney(item.priceMinor, this.#menu.currency)}`
        : "";
    const tags = item.tags?.length ? ` (printed: ${item.tags.join(", ")})` : "";
    return `${item.name}${price}${tags}${item.available ? "" : " — not available"}`;
  }

  /** @param {DinerState} d @param {any} section */
  #singleChoice(d, section) {
    const current = d.selections.find((s) =>
      section.items.some((/** @type {any} */ i) => i.id === s.menuItemId),
    );
    const group = h(
      "wa-radio-group",
      {
        id: `choice-${d.id}-${section.id}`,
        label: `${section.name} for ${d.name.trim() || "this diner"}`,
        "with-label": true,
        value: current?.menuItemId ?? "",
        orientation: "vertical",
      },
      ...section.items.map((/** @type {any} */ item) =>
        h(
          "wa-radio",
          { value: item.id, disabled: !item.available },
          this.#label(item),
        ),
      ),
    );
    group.addEventListener("change", () => {
      const ids = new Set(section.items.map((/** @type {any} */ i) => i.id));
      d.selections = d.selections.filter((s) => !ids.has(s.menuItemId));
      d.selections.push({
        menuItemId: /** @type {any} */ (group).value,
        quantity: 1,
      });
      this.#touch();
      this.#renderSoon();
    });
    return [
      group,
      ...(current
        ? this.#optionControls(
            d,
            current,
            section.items.find(
              (/** @type {any} */ i) => i.id === current.menuItemId,
            ),
          )
        : []),
    ];
  }

  /** @param {DinerState} d @param {any} item */
  #itemRow(d, item) {
    const sel = d.selections.find((s) => s.menuItemId === item.id);
    const box = h(
      "wa-checkbox",
      {
        id: `item-${d.id}-${item.id}`,
        checked: !!sel,
        disabled: !item.available,
      },
      this.#label(item),
    );
    box.addEventListener("change", () => {
      if (/** @type {any} */ (box).checked)
        d.selections.push({ menuItemId: item.id, quantity: 1 });
      else d.selections = d.selections.filter((s) => s.menuItemId !== item.id);
      this.#touch();
      this.#renderSoon();
    });
    const extras = sel
      ? [
          this.#input(
            `qty-${d.id}-${item.id}`,
            `Quantity of ${item.name} for ${d.name.trim() || "this diner"}`,
            String(sel.quantity),
            (v) => {
              sel.quantity = Number(v);
            },
            { type: "number", min: 1, max: 20 },
          ),
          ...this.#optionControls(d, sel, item),
        ]
      : [];
    return h("div", { class: "item-row" }, box, ...extras);
  }

  /** @param {DinerState} d @param {Sel} sel @param {any} item */
  #optionControls(d, sel, item) {
    return (item?.optionGroups ?? []).map((/** @type {any} */ group) => {
      const chosen = sel.optionIds ?? [];
      const radios = h(
        "wa-radio-group",
        {
          id: `opt-${d.id}-${item.id}-${group.id}`,
          label: `${group.title} for ${item.name}`,
          "with-label": true,
          value:
            group.choices.find((/** @type {any} */ c) => chosen.includes(c.id))
              ?.id ?? "",
        },
        ...group.choices.map((/** @type {any} */ c) =>
          h("wa-radio", { value: c.id }, c.title),
        ),
      );
      radios.addEventListener("change", () => {
        const others = chosen.filter(
          (/** @type {string} */ id) =>
            !group.choices.some((/** @type {any} */ c) => c.id === id),
        );
        sel.optionIds = [...others, /** @type {any} */ (radios).value];
        this.#touch();
      });
      return radios;
    });
  }

  #actions() {
    const attending = this.#draft.attendance === "yes";
    return h(
      "div",
      { class: "actions" },
      h(
        "wa-button",
        {
          id: "save-draft",
          appearance: "outlined",
          onclick: () => void this.#save(false),
        },
        "Save for later",
      ),
      h(
        "wa-button",
        {
          id: "review",
          variant: "brand",
          onclick: () => void this.#save(true),
        },
        attending ? "Review my order" : "Send my reply",
      ),
    );
  }

  /** Saves the draft; optionally continues to review (or submits a decline). @param {boolean} next */
  async #save(next) {
    this.#issues = [];
    this.#error = "";
    try {
      const { attendance, contactName, partyNotes, diners, version } =
        this.#draft;
      const result = await api("PUT", "/api/booking", {
        attendance: attendance || "undecided",
        contactName,
        partyNotes,
        diners,
        version,
      });
      this.#stored = result.booking;
      this.#adoptStored();
      this.#editing = true;
      if (next && this.#draft.attendance === "yes") {
        // Early feedback only; the server validates again and is authoritative.
        this.#issues = validateBooking(
          /** @type {any} */ (this.#draft),
          this.#event,
          this.#menu,
        );
        if (this.#issues.length > 0) {
          this.#render();
          this.#focus("#error-summary");
          return;
        }
        this.#reviewing = true;
      } else if (next) {
        await this.#submit();
        return;
      } else {
        this.#notice = "Saved. You can come back to this link to finish later.";
      }
      this.#render();
      this.#focus(next ? "#review-title" : "#notice");
    } catch (error) {
      this.#handleError(error);
    }
  }

  async #submit() {
    try {
      const result = await api("POST", "/api/booking/submit");
      this.#stored = result.booking;
      this.#adoptStored();
      this.#reviewing = false;
      this.#editing = false;
      this.#render();
      this.#focus("#confirmation");
    } catch (error) {
      this.#reviewing = false;
      this.#handleError(error);
    }
  }

  /** @param {unknown} error */
  #handleError(error) {
    if (error instanceof ApiError && error.status === 422) {
      this.#issues = error.details;
      this.#render();
      this.#focus("#error-summary");
      return;
    }
    this.#error =
      error instanceof ApiError
        ? error.message
        : "Something went wrong. Your changes are still on this page; please try again.";
    this.#render();
    this.#focus("#error");
  }

  #reviewView() {
    const total = this.#total();
    return h(
      "div",
      { class: "stack" },
      h("h1", { id: "review-title", tabindex: "-1" }, "Check your order"),
      this.#summary(this.#stored),
      total === undefined
        ? null
        : h(
            "p",
            null,
            h("strong", null, `Estimated total: ${total}`),
            " (an estimate from the printed prices; the venue's bill may differ)",
          ),
      h(
        "div",
        { class: "actions" },
        h(
          "wa-button",
          {
            id: "back-to-edit",
            appearance: "outlined",
            onclick: () => {
              this.#reviewing = false;
              this.#render();
            },
          },
          "Back to editing",
        ),
        h(
          "wa-button",
          {
            id: "submit-order",
            variant: "brand",
            onclick: () => void this.#submit(),
          },
          "Submit my order",
        ),
      ),
    );
  }

  #total() {
    if (!this.#event.showPrices || !this.#menu) return undefined;
    let minor = 0;
    for (const d of this.#stored.diners) {
      for (const s of d.selections) {
        const item = this.#menu.sections
          .flatMap((/** @type {any} */ x) => x.items)
          .find((/** @type {any} */ i) => i.id === s.menuItemId);
        const mods = (item?.optionGroups ?? [])
          .flatMap((/** @type {any} */ g) => g.choices)
          .filter((/** @type {any} */ c) => s.optionIds?.includes(c.id))
          .reduce(
            (/** @type {number} */ t, /** @type {any} */ c) =>
              t + (c.priceModifierMinor ?? 0),
            0,
          );
        minor += ((item?.priceMinor ?? 0) + mods) * s.quantity;
      }
    }
    return formatMoney(minor, this.#menu.currency);
  }

  /** Per-diner summary, with each diner under their own heading. @param {any} booking */
  #summary(booking) {
    if (booking.attendance !== "yes")
      return h("p", null, `${booking.contactName}: not attending.`);
    const names = new Map(
      this.#menu?.sections.flatMap((/** @type {any} */ s) =>
        s.items.map((/** @type {any} */ i) => [i.id, i.name]),
      ) ?? [],
    );
    // Chosen options (such as a sauce) must be visible before submitting.
    const choices = new Map(
      this.#menu?.sections
        .flatMap((/** @type {any} */ s) => s.items)
        .flatMap((/** @type {any} */ i) => i.optionGroups ?? [])
        .flatMap((/** @type {any} */ g) => g.choices)
        .map((/** @type {any} */ c) => [c.id, c.title]) ?? [],
    );
    /** @param {any} s */
    const options = (s) =>
      (s.optionIds ?? [])
        .map((/** @type {string} */ id) => choices.get(id) ?? id)
        .join(", ");
    return h(
      "section",
      { "aria-label": "Order summary" },
      ...booking.diners.map((/** @type {any} */ d, /** @type {number} */ i) =>
        h(
          "div",
          null,
          h("h2", null, `Diner ${i + 1}: ${d.name}`),
          d.selections.length
            ? h(
                "ul",
                { class: "review-list" },
                ...d.selections.map((/** @type {any} */ s) =>
                  h(
                    "li",
                    null,
                    `${s.quantity} × ${s.nameSnapshot ?? names.get(s.menuItemId) ?? "Unknown item"}${options(s) ? ` (${options(s)})` : ""}`,
                  ),
                ),
              )
            : h("p", null, "No dishes chosen."),
          d.dietaryNotes
            ? h("p", null, `Dietary request: ${d.dietaryNotes}`)
            : null,
        ),
      ),
    );
  }
}

customElements.define("mm-booking", MmBooking);
