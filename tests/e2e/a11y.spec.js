import { expect, test } from "@playwright/test";
import { DEMO_PASSWORD } from "../../seed/demo.js";
import {
  auditScreen,
  axeProblems,
  focusVisibleProblems,
} from "./a11y-helpers.js";
import { fillWa, openInvitation, tokens } from "./helpers.js";

// A scripted accessibility pass. Axe finds markup defects; these tests add the
// layout, interaction and preference checks that need a browser (reflow, text
// spacing, target size, focus visibility, reduced motion, forced colours,
// titles and a keyboard-only journey). A person using a real screen reader is
// still needed for the final judgement: see docs/accessibility.md.

const pick = (page, groupId, value) =>
  page.locator(`#${groupId} wa-radio[value="${value}"]`).click();

/** Runs the audit on each screen and fails once, listing every problem. */
function recorder(page) {
  /** @type {string[]} */
  const problems = [];
  /** @type {Map<string, string>} first title seen for each distinct view */
  const views = new Map();
  return {
    /** @param {string} name @param {string} [view] screens in one view may share a title */
    async screen(name, view = name) {
      problems.push(...(await auditScreen(page, name)));
      if (!views.has(view)) views.set(view, await page.title());
    },
    finish() {
      const titles = [...views.values()];
      const duplicates = titles.filter((t, i) => titles.indexOf(t) !== i);
      if (duplicates.length > 0)
        problems.push(
          `screens share a page title: ${[...new Set(duplicates)].join(" | ")}`,
        );
      expect(problems, problems.join("\n")).toEqual([]);
    },
  };
}

async function signIn(page, email = "owner@example.test") {
  await page.goto("/admin");
  await page.locator("#email input").waitFor();
  await fillWa(page, "email", email);
  await fillWa(page, "password", DEMO_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: "Your events" }),
  ).toBeVisible();
}

test("every invitee screen passes the accessibility checks", async ({
  page,
}) => {
  const audit = recorder(page);
  await openInvitation(page, "a11y");
  await audit.screen("booking page before reply", "booking form");

  await pick(page, "attendance", "yes");
  await fillWa(page, "contactName", "Alex Example");
  await page.locator("#add-guest").click();
  await expect(page.locator("wa-card")).toHaveCount(2);
  await audit.screen("booking form with a guest", "booking form");

  await page.locator("#review").click();
  await expect(page.locator("#error-summary")).toBeVisible();
  await audit.screen("form with error summary");

  const cards = page.locator("wa-card");
  await cards.nth(1).locator('wa-input[id^="name-"] input').fill("Guest One");
  for (let i = 0; i < 2; i += 1) {
    const card = cards.nth(i);
    await card.locator('wa-radio[value="soup"]').click();
    await card.locator('wa-radio[value="roast"]').click();
    await card.locator('wa-radio[value="gravy"]').click();
  }
  await page.locator("#review").click();
  await expect(
    page.getByRole("heading", { name: "Check your order" }),
  ).toBeVisible();
  await audit.screen("review order");

  await page.locator("#submit-order").click();
  await expect(page.locator("#confirmation")).toContainText(/MM-[A-Z2-9]{8}/);
  await audit.screen("confirmation");

  await page.locator("#edit-booking").click();
  await page.locator("#review").waitFor();
  await audit.screen("editing a submitted booking", "booking form");

  await openInvitation(page, "draft");
  await expect(
    page.getByRole("status").filter({ hasText: "not been confirmed" }),
  ).toBeVisible();
  await audit.screen("event not open for ordering");

  await page.goto(`/i#${tokens().revoked}`);
  await expect(
    page.getByRole("heading", { name: "We could not open your invitation" }),
  ).toBeVisible();
  await audit.screen("link not valid");

  audit.finish();
});

test("every organiser screen passes the accessibility checks", async ({
  page,
}) => {
  const audit = recorder(page);
  await page.goto("/admin");
  await page.locator("#email input").waitFor();
  await audit.screen("organiser sign-in");

  await signIn(page);
  await audit.screen("event list");

  await page.goto("/admin/events/demo-event-set");
  await expect(
    page.getByRole("heading", { level: 2, name: "Attendance" }),
  ).toBeVisible();
  await audit.screen("event dashboard");

  await page.goto("/admin/events/example-club-sample-kitchen");
  await expect(page.getByText("To do: Event date and time")).toBeVisible();
  await audit.screen("draft event dashboard with checklist");

  await page.goto("/admin/events/example-club-sample-kitchen/menu");
  await expect(
    page.getByRole("heading", { level: 1, name: /Review menu/ }),
  ).toBeVisible();
  await audit.screen("menu review");

  await page.goto("/admin/events/demo-event-set/summary");
  await expect(
    page.getByRole("heading", { level: 1, name: /Order summary/ }),
  ).toBeVisible();
  await audit.screen("printable summary");

  audit.finish();
});

test("keyboard focus is clearly visible on every stop", async ({ page }) => {
  const problems = [];
  await openInvitation(page, "isolation-a");
  await pick(page, "attendance", "yes");
  await fillWa(page, "contactName", "Focus Check");
  problems.push(
    ...(await focusVisibleProblems(page, 30)).map((p) => `[invitee form] ${p}`),
  );

  await signIn(page);
  await page.goto("/admin/events/demo-event-set");
  await expect(
    page.getByRole("heading", { level: 2, name: "Attendance" }),
  ).toBeVisible();
  problems.push(
    ...(await focusVisibleProblems(page, 40)).map((p) => `[dashboard] ${p}`),
  );

  await page.goto("/admin/events/example-club-sample-kitchen/menu");
  await expect(
    page.getByRole("heading", { level: 1, name: /Review menu/ }),
  ).toBeVisible();
  problems.push(
    ...(await focusVisibleProblems(page, 25)).map((p) => `[menu review] ${p}`),
  );
  expect(problems, problems.join("\n")).toEqual([]);
});

test("screens stay usable in forced-colours mode", async ({ page }) => {
  await page.emulateMedia({ forcedColors: "active" });
  const problems = [];
  await page.goto("/admin");
  await page.locator("#email input").waitFor();
  problems.push(
    ...(await axeProblems(page)).map((p) => `[sign-in, forced colours] ${p}`),
  );
  problems.push(
    ...(await focusVisibleProblems(page, 6)).map(
      (p) => `[sign-in, forced colours] ${p}`,
    ),
  );

  await openInvitation(page, "isolation-b");
  await pick(page, "attendance", "yes");
  problems.push(
    ...(await axeProblems(page)).map((p) => `[booking, forced colours] ${p}`),
  );
  problems.push(
    ...(await focusVisibleProblems(page, 12)).map(
      (p) => `[booking, forced colours] ${p}`,
    ),
  );
  expect(problems, problems.join("\n")).toEqual([]);
});

test("a whole order can be placed with the keyboard alone", async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, "keyboard-only journeys are a desktop concern");
  await openInvitation(page, "a11y-keyboard");

  /** Presses Tab until the wanted control has focus (shadow DOM aware). */
  const tabTo = async (selector, limit = 60) => {
    for (let i = 0; i < limit; i += 1) {
      const there = await page.evaluate(
        (s) => Boolean(document.activeElement?.matches(s)),
        selector,
      );
      if (there) return;
      await page.keyboard.press("Tab");
    }
    throw new Error(`keyboard focus never reached ${selector}`);
  };
  /** Waits for focus to settle on a control after the form re-renders. */
  const focused = (selector) =>
    page.waitForFunction((s) => document.activeElement?.matches(s), selector);

  await tabTo('#attendance wa-radio[value="yes"]');
  await page.keyboard.press("Space");
  await focused('#attendance wa-radio[value="yes"]');
  await tabTo("#contactName");
  await page.keyboard.type("Keyboard User");
  await tabTo('wa-radio[value="soup"]');
  await page.keyboard.press("Space");
  await focused('wa-radio[value="soup"]');
  await tabTo('wa-radio[value="roast"]');
  await page.keyboard.press("Space");
  await focused('wa-radio[value="roast"]');
  await tabTo('wa-radio[value="gravy"]');
  await page.keyboard.press("Space");
  await focused('wa-radio[value="gravy"]');
  await tabTo("#review");
  await page.keyboard.press("Enter");

  await expect(
    page.getByRole("heading", { name: "Check your order" }),
  ).toBeFocused();
  // The chosen sauce must be visible before the order is submitted.
  await expect(page.getByText("1 × Demo roast (Gravy)")).toBeVisible();
  await tabTo("#submit-order");
  await page.keyboard.press("Enter");
  await expect(page.locator("#confirmation")).toContainText(/MM-[A-Z2-9]{8}/);
  await expect(page.locator("#confirmation")).toBeFocused();
});

test("the audit itself detects known accessibility defects", async ({
  page,
  isMobile,
}) => {
  // The bad page has no viewport tag, so mobile emulation would lay it out wide.
  test.skip(isMobile, "the self-check needs a desktop viewport");
  // A deliberately bad page: if any helper stops noticing, this test fails.
  await page.setContent(`
    <!doctype html><html lang="en-US"><head><title>MealMuster</title>
    <style>
      button { margin: 16px; }
      button.tiny { width: 10px; height: 10px; }
      button.noring { outline: none; border: 0; background: #eee; padding: 8px; }
      button.noring:focus, button.noring:focus-visible { outline: none; box-shadow: none; }
      .wide { width: 900px; height: 20px; background: #ccc; }
      .clip { width: 80px; height: 1.2em; overflow: hidden; }
      @keyframes spin { to { transform: rotate(360deg); } }
      .spin { width: 20px; height: 20px; background: red; animation: spin 2s linear infinite; }
    </style></head><body>
      <main>
        <h1>First</h1><h1>Second</h1><h4>Skipped levels</h4>
        <div class="wide"></div>
        <div class="clip">Some text that is long enough to overflow its tiny box</div>
        <button class="tiny" aria-label="tiny"></button>
        <button class="noring">No focus ring</button>
        <div class="spin"></div>
        <img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" width="20" height="20">
      </main>
    </body></html>`);
  const {
    titleProblems,
    structureProblems,
    reflowProblems,
    textSpacingProblems,
    targetSizeProblems,
    reducedMotionProblems,
  } = await import("./a11y-helpers.js");
  expect((await titleProblems(page)).length).toBeGreaterThan(0);
  expect((await structureProblems(page)).join()).toMatch(/one h1/);
  expect((await structureProblems(page)).join()).toMatch(/jumps from/);
  expect((await structureProblems(page)).join()).toMatch(/lang is/);
  expect((await structureProblems(page)).join()).toMatch(/banner/);
  expect((await reflowProblems(page)).length).toBeGreaterThan(0);
  expect((await textSpacingProblems(page)).join()).toMatch(/clipped/);
  expect((await targetSizeProblems(page)).join()).toMatch(/button is \d+x10px/);
  expect((await reducedMotionProblems(page)).length).toBeGreaterThan(0);
  expect((await axeProblems(page)).length).toBeGreaterThan(0);
  expect((await focusVisibleProblems(page, 4)).join()).toMatch(
    /no visible focus indicator/,
  );
});
