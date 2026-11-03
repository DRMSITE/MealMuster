import AxeBuilder from "@axe-core/playwright";

/**
 * Checks beyond what axe can judge, for the parts of WCAG 2.2 AA that need
 * layout, interaction or a person's eye. Each returns a list of problems
 * (empty is good) so one run reports everything that is wrong.
 */

const TEXT_SPACING_CSS = `
  * {
    line-height: 1.5 !important;
    letter-spacing: 0.12em !important;
    word-spacing: 0.16em !important;
  }
  p { margin-bottom: 2em !important; }
`;

/** WCAG 2.4.2: every view needs a descriptive, specific title. @param {import("@playwright/test").Page} page */
export async function titleProblems(page) {
  const title = await page.title();
  return title.trim() === "" || title === "MealMuster"
    ? [`generic or empty page title: "${title}"`]
    : [];
}

/** WCAG 1.3.1 / 2.4.6: one h1, no skipped levels, landmarks present. @param {import("@playwright/test").Page} page */
export async function structureProblems(page) {
  return page.evaluate(() => {
    /** @type {string[]} */
    const problems = [];
    const headings = [...document.querySelectorAll("h1,h2,h3,h4,h5,h6")];
    const levels = headings.map((h) => Number(h.tagName[1]));
    if (levels.filter((l) => l === 1).length !== 1)
      problems.push(
        `expected one h1, found ${levels.filter((l) => l === 1).length}`,
      );
    levels.forEach((level, i) => {
      if (i > 0 && level > levels[i - 1] + 1)
        problems.push(
          `heading level jumps from h${levels[i - 1]} to h${level} ("${headings[i].textContent?.slice(0, 40)}")`,
        );
    });
    for (const [selector, name] of [
      ["main", "main"],
      ["header, [role=banner]", "banner"],
      ["footer, [role=contentinfo]", "contentinfo"],
    ])
      if (!document.querySelector(selector))
        problems.push(`no ${name} landmark`);
    if (document.documentElement.lang !== "en-GB")
      problems.push(`html lang is "${document.documentElement.lang}"`);
    return problems;
  });
}

/**
 * WCAG 1.4.10 reflow: at 320 CSS px wide (400% zoom) content must not need
 * sideways scrolling. Data tables may scroll inside their own wrapper.
 * @param {import("@playwright/test").Page} page
 */
export async function reflowProblems(page) {
  const original = page.viewportSize();
  await page.setViewportSize({ width: 320, height: 640 });
  const problems = await page.evaluate(() => {
    /** @type {string[]} */
    const out = [];
    const overflow = document.documentElement.scrollWidth - window.innerWidth;
    if (overflow > 0) {
      const culprits = [...document.querySelectorAll("main *")]
        .filter(
          (el) => el.getBoundingClientRect().right > window.innerWidth + 1,
        )
        .filter((el) => !el.closest(".table-wrap"))
        .slice(0, 3)
        .map((el) => `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ""}`);
      out.push(
        `page scrolls sideways by ${overflow}px at 320px (${culprits.join(", ")})`,
      );
    }
    return out;
  });
  if (original) await page.setViewportSize(original);
  return problems;
}

/**
 * WCAG 1.4.12 text spacing: with the required spacing applied nothing may be
 * cut off or force sideways scrolling. @param {import("@playwright/test").Page} page
 */
export async function textSpacingProblems(page) {
  const handle = await page.addStyleTag({ content: TEXT_SPACING_CSS });
  const problems = await page.evaluate(() => {
    /** @type {string[]} */
    const out = [];
    const clipped = [...document.querySelectorAll("main *")].filter((el) => {
      const style = getComputedStyle(el);
      return (
        ["hidden", "clip"].includes(style.overflowY) &&
        el.scrollHeight > el.clientHeight + 2 &&
        !el.closest(".table-wrap")
      );
    });
    for (const el of clipped.slice(0, 3))
      out.push(
        `content is clipped in ${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ""}`,
      );
    return out;
  });
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  if (overflow > 0)
    problems.push(`sideways scroll of ${overflow}px with text spacing`);
  await handle.evaluate((node) => node.remove());
  return problems;
}

/**
 * WCAG 2.5.8 target size (AA): pointer targets must be at least 24 by 24 CSS
 * px. Inline links inside a sentence are exempt. @param {import("@playwright/test").Page} page
 */
export async function targetSizeProblems(page) {
  return page.evaluate(() => {
    const MIN = 24;
    /** @type {string[]} */
    const out = [];
    const candidates = document.querySelectorAll(
      "a[href], button, input:not([type=hidden]), select, textarea, wa-button, wa-radio, wa-checkbox, wa-input, wa-textarea, summary",
    );
    for (const el of candidates) {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      if (el.closest("[disabled], [hidden]")) continue;
      if (el.tagName === "A") {
        const parent = el.parentElement;
        const sentence =
          parent &&
          (parent.textContent ?? "").trim().length >
            (el.textContent ?? "").trim().length + 2;
        if (sentence) continue;
      }
      if (rect.width < MIN || rect.height < MIN)
        out.push(
          `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ""} is ${Math.round(rect.width)}x${Math.round(rect.height)}px ("${(el.textContent ?? el.getAttribute("aria-label") ?? "").trim().slice(0, 30)}")`,
        );
    }
    return out;
  });
}

/**
 * WCAG 2.3.3 / user preference: with reduced motion requested, nothing may be
 * animating. @param {import("@playwright/test").Page} page
 */
export async function reducedMotionProblems(page) {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.waitForTimeout(300);
  const problems = await page.evaluate(() =>
    document
      .getAnimations()
      .filter((a) => a.playState === "running")
      .filter((a) => {
        const t = a.effect?.getComputedTiming();
        return t && Number(t.duration) > 50;
      })
      .slice(0, 3)
      .map(
        (a) =>
          `animation still running: ${a.effect?.target?.tagName?.toLowerCase()}`,
      ),
  );
  await page.emulateMedia({ reducedMotion: "no-preference" });
  return problems;
}

/** The element that has focus, looking through shadow roots. @param {import("@playwright/test").Page} page */
const activeRect = (page) =>
  page.evaluate(() => {
    const el = document.activeElement;
    if (!el || el === document.body) return null;
    const r = el.getBoundingClientRect();
    return {
      x: r.x,
      y: r.y,
      width: r.width,
      height: r.height,
      label: `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ""}`,
    };
  });

/**
 * WCAG 2.4.7 / 2.4.13 focus visible: every keyboard stop must look different
 * when focused. Compares pixels around the element with and without focus.
 * @param {import("@playwright/test").Page} page @param {number} [maxStops]
 */
export async function focusVisibleProblems(page, maxStops = 40) {
  /** @type {string[]} */
  const problems = [];
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement)
      document.activeElement.blur();
    window.scrollTo(0, 0);
    // Reset the sequential-focus starting point to the top of the page, so the
    // first Tab reaches the first stop instead of continuing from the last one.
    document.getSelection()?.collapse(document.body, 0);
  });
  const seen = new Set();
  for (let stop = 0; stop < maxStops; stop += 1) {
    await page.keyboard.press("Tab");
    const rect = await activeRect(page);
    if (!rect) break;
    const key = `${rect.label}@${Math.round(rect.x)},${Math.round(rect.y)}`;
    if (seen.has(key)) break;
    seen.add(key);
    const viewport = page.viewportSize() ?? { width: 1280, height: 720 };
    // Wide enough for a focus ring, narrow enough not to capture a neighbour's.
    const pad = 5;
    const clip = {
      x: Math.max(0, rect.x - pad),
      y: Math.max(0, rect.y - pad),
      width: Math.min(viewport.width, rect.width + pad * 2),
      height: Math.min(viewport.height, rect.height + pad * 2),
    };
    if (
      clip.width <= 0 ||
      clip.height <= 0 ||
      rect.y < 0 ||
      rect.y > viewport.height
    )
      continue;
    const focused = await page.screenshot({ clip });
    await page.evaluate(() => {
      const el = document.activeElement;
      if (el instanceof HTMLElement) el.blur();
    });
    const plain = await page.screenshot({ clip });
    if (focused.equals(plain))
      problems.push(`no visible focus indicator on ${rect.label}`);
    // Put focus back where it was, so Tab continues from here.
    await page.evaluate((r) => {
      const el = document.elementFromPoint(
        r.x + r.width / 2,
        r.y + r.height / 2,
      );
      const target = el?.closest(
        "a, button, input, select, textarea, wa-button, wa-radio, wa-checkbox, wa-input, wa-textarea, [tabindex]",
      );
      if (target instanceof HTMLElement) target.focus();
    }, rect);
  }
  return problems;
}

/** axe with every WCAG 2.x A and AA rule. @param {import("@playwright/test").Page} page */
export async function axeProblems(page) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  return results.violations.map(
    (v) => `axe ${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`,
  );
}

/**
 * Runs every check against the current screen.
 * @param {import("@playwright/test").Page} page @param {string} screen
 * @returns {Promise<string[]>} problems, each prefixed with the screen name
 */
export async function auditScreen(page, screen) {
  const groups = [
    await titleProblems(page),
    await structureProblems(page),
    await axeProblems(page),
    await reflowProblems(page),
    await textSpacingProblems(page),
    await targetSizeProblems(page),
    await reducedMotionProblems(page),
  ];
  return groups.flat().map((p) => `[${screen}] ${p}`);
}
