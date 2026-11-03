// @ts-check
import { adminApi } from "../admin/admin-api.js";
import { onUser, signIn, signOut } from "../admin/auth.js";
import { h, setTitle } from "../dom.js";
import "./mm-admin-event.js";
import "./mm-admin-menu.js";
import "./mm-admin-summary.js";

/**
 * Organiser area shell: sign-in, event list, and the routes
 * /admin, /admin/events/:id, /admin/events/:id/summary and /admin/events/:id/menu.
 * Light DOM; each route is a full page load so the URL always matches the view.
 */
export class MmAdmin extends HTMLElement {
  /** @type {{ email: string | null } | null | undefined} */
  #user;

  connectedCallback() {
    setTitle("Organiser area");
    this.replaceChildren(
      h("h1", null, "Organiser area"),
      h("p", { role: "status" }, "Checking your sign-in…"),
    );
    onUser((user) => {
      this.#user = user;
      void this.#render();
    });
  }

  async #render() {
    if (!this.#user) return this.#signInView();
    const match = /^\/admin\/events\/([^/]+)(\/summary|\/menu)?\/?$/.exec(
      location.pathname,
    );
    const bar = h(
      "div",
      { class: "admin-bar" },
      h("p", null, `Signed in as ${this.#user.email ?? "an organiser"}`),
      h(
        "wa-button",
        {
          size: "small",
          onclick: () => void signOut(),
        },
        "Sign out",
      ),
    );
    if (!match) {
      this.replaceChildren(bar, await this.#eventList());
      return;
    }
    const tag =
      match[2] === "/summary"
        ? "mm-admin-summary"
        : match[2] === "/menu"
          ? "mm-admin-menu"
          : "mm-admin-event";
    const element = h(tag, {
      "event-id": decodeURIComponent(match[1] ?? ""),
    });
    this.replaceChildren(bar, element);
  }

  #signInView(error = "") {
    setTitle(error ? "Sign-in problem" : "Organiser sign-in");
    const email = h("wa-input", {
      id: "email",
      name: "email",
      label: "Email address",
      type: "email",
      autocomplete: "username",
      required: true,
    });
    const password = h("wa-input", {
      id: "password",
      name: "password",
      label: "Password",
      type: "password",
      autocomplete: "current-password",
      required: true,
    });
    const form = h(
      "form",
      {
        class: "stack",
        novalidate: true,
        onsubmit: async (/** @type {SubmitEvent} */ event) => {
          event.preventDefault();
          try {
            await signIn(
              /** @type {HTMLInputElement} */ (email).value,
              /** @type {HTMLInputElement} */ (password).value,
            );
          } catch {
            // One message for every failure, so it cannot be used to probe accounts.
            this.#signInView(
              "Your email address or password was not recognised.",
            );
            this.querySelector("#sign-in-error")?.setAttribute(
              "tabindex",
              "-1",
            );
            /** @type {HTMLElement | null} */ (
              this.querySelector("#sign-in-error")
            )?.focus();
          }
        },
      },
      email,
      password,
      h("wa-button", { type: "submit", variant: "brand" }, "Sign in"),
    );
    this.replaceChildren(
      h("h1", null, "Organiser sign-in"),
      error
        ? h(
            "wa-callout",
            { variant: "danger", role: "alert", id: "sign-in-error" },
            error,
          )
        : "",
      form,
    );
  }

  async #eventList() {
    setTitle("Your events");
    try {
      const { events } = await adminApi("GET", "/api/admin/events");
      return h(
        "div",
        { class: "stack" },
        h("h1", null, "Your events"),
        events.length === 0
          ? h("p", null, "No events are set up for your organisation yet.")
          : h(
              "ul",
              { class: "plain-list" },
              ...events.map((/** @type {any} */ e) =>
                h(
                  "li",
                  null,
                  h(
                    "a",
                    { href: `/admin/events/${encodeURIComponent(e.id)}` },
                    e.title,
                  ),
                  ` (${e.status})`,
                ),
              ),
            ),
      );
    } catch {
      return h(
        "div",
        { class: "stack" },
        h("h1", null, "Your events"),
        h(
          "wa-callout",
          { variant: "danger", role: "alert" },
          "We could not load your events. Please reload the page or sign in again.",
        ),
      );
    }
  }
}

customElements.define("mm-admin", MmAdmin);
