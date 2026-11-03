// @ts-check
import { api } from "../api.js";
import { h, setTitle } from "../dom.js";

/**
 * Redeems an invitation token from the URL fragment, then replaces the URL with
 * a token-free one. Light DOM, no attributes or events.
 */
export class MmRedeem extends HTMLElement {
  connectedCallback() {
    void this.#redeem();
  }

  async #redeem() {
    const token = location.hash.slice(1);
    // Remove the token from the address bar and history immediately.
    history.replaceState(null, "", "/i");
    setTitle("Opening your invitation");
    this.replaceChildren(
      h("h1", null, "Opening your invitation"),
      h("p", { role: "status" }, "One moment…"),
    );
    if (!token)
      return this.#fail(
        "This link is incomplete. Please use the full link you were sent.",
      );
    try {
      await api("POST", "/api/invitations/redeem", { token });
      location.replace("/invitation");
    } catch (error) {
      this.#fail(
        error instanceof Error ? error.message : "Something went wrong.",
      );
    }
  }

  /** @param {string} message */
  #fail(message) {
    setTitle("Invitation not valid");
    const callout = h(
      "wa-callout",
      { variant: "danger", role: "alert" },
      message,
    );
    this.replaceChildren(
      h("h1", null, "We could not open your invitation"),
      callout,
    );
  }
}

customElements.define("mm-redeem", MmRedeem);
