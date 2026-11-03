import { readFileSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

export const tokens = () =>
  JSON.parse(readFileSync(new URL("./.tokens.json", import.meta.url), "utf8"));

/** Opens a personal link and waits for the token-free booking page. */
let nextClient = 1;

/** Gives each test its own client address so the redeem rate limit stays at its real value. */
export async function openInvitation(page, name) {
  // Tests that submit orders use one invitation per project so they stay independent.
  const key = ["accept", "decline", "hostile", "a11y"].includes(name)
    ? `${name}-${test.info().project.name}`
    : name;
  nextClient += 1;
  await page.context().setExtraHTTPHeaders({
    "x-forwarded-for": `203.0.113.${nextClient % 250}`,
  });
  await page.goto(`/i#${tokens()[key]}`);
  await page.waitForURL("**/invitation");
  await page.locator("main h1").first().waitFor();
}

export async function expectNoAxeViolations(page, label) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  const summary = results.violations.map(
    (v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`,
  );
  expect(summary, `axe violations on ${label}`).toEqual([]);
}

/** Wa form controls keep their native input inside the shadow root. */
export const fillWa = (page, id, value) =>
  page.locator(`#${id} input, #${id} textarea`).first().fill(value);
