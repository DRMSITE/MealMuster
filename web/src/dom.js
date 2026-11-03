// @ts-check
/**
 * Tiny DOM builder. Text is always added as text nodes, never parsed as HTML,
 * so names, notes and menu descriptions cannot inject markup.
 *
 * @param {string} tag
 * @param {Record<string, any> | null} [attrs]
 * @param {...(Node | string | null | undefined | false)} children
 * @returns {HTMLElement}
 */
export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs ?? {})) {
    if (value === false || value === null || value === undefined) continue;
    if (key.startsWith("on") && typeof value === "function")
      el.addEventListener(key.slice(2), value);
    else if (key === "value" || key === "checked") {
      /** @type {any} */ (el)[key] = value;
      // Option controls also carry the attribute so they can be found (and
      // focus restored) straight after a render, before Web Awesome reflects it.
      if (key === "value" && (tag === "wa-radio" || tag === "wa-checkbox"))
        el.setAttribute("value", String(value));
    } else el.setAttribute(key, value === true ? "" : String(value));
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    el.append(
      typeof child === "string" ? document.createTextNode(child) : child,
    );
  }
  return el;
}

/**
 * Sets a specific page title (WCAG 2.4.2): each view and state has its own, so
 * a person who hears only the title knows where they are.
 * @param {string} part
 */
export function setTitle(part) {
  document.title = `${part} – MealMuster`;
}

/** @param {HTMLElement} el */
export function clear(el) {
  el.replaceChildren();
}
