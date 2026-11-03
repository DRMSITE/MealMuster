import { expect, test } from "@playwright/test";
import {
  expectNoAxeViolations,
  fillWa,
  openInvitation,
  tokens,
} from "./helpers.js";

const pick = (page, groupId, value) =>
  page.locator(`#${groupId} wa-radio[value="${value}"]`).click();

test("redeeming a link leaves no token in the URL or history", async ({
  page,
}) => {
  await openInvitation(page, "isolation-a");
  expect(page.url()).not.toContain(tokens()["isolation-a"]);
  expect(page.url()).toMatch(/\/invitation$/);
  await expect(
    page.getByRole("heading", { level: 1, name: "Demo Club Dinner" }),
  ).toBeVisible();
  await expectNoAxeViolations(page, "booking page before reply");
});

test("a revoked link cannot open an invitation", async ({ page }) => {
  await page.goto(`/i#${tokens().revoked}`);
  await expect(
    page.getByRole("heading", { name: "We could not open your invitation" }),
  ).toBeVisible();
  await expect(page.getByRole("alert")).toContainText("not valid");
  await expectNoAxeViolations(page, "invalid link page");
});

test("an invitee can decline without choosing food", async ({ page }) => {
  await openInvitation(page, "decline");
  await pick(page, "attendance", "no");
  await expect(page.locator("#add-guest")).toHaveCount(0);
  await page.locator("#review").click();
  await expect(page.locator("#confirmation")).toContainText(
    "Your reply is recorded",
  );
  await expectNoAxeViolations(page, "decline confirmation");
});

test("accept with two guests, different food each, submit, then amend", async ({
  page,
}) => {
  await openInvitation(page, "accept");
  await pick(page, "attendance", "yes");
  await fillWa(page, "contactName", "Alex Example");
  await expect(
    page.getByRole("heading", { level: 3, name: /Diner 1/ }),
  ).toBeVisible();

  await page.locator("#add-guest").click();
  await page.locator("#add-guest").click();
  const cards = page.locator("wa-card");
  await expect(cards).toHaveCount(3);
  await expectNoAxeViolations(page, "booking form with three diners");

  const diners = [
    ["Alex Example", "soup", "roast", "gravy"],
    ["Guest One", "salad", "pie"],
    ["Guest Two", "soup", "risotto"],
  ];
  for (const [i, [name, starter, main, sauce]] of diners.entries()) {
    const card = cards.nth(i);
    if (i > 0) await card.locator('wa-input[id^="name-"] input').fill(name);
    await card.locator(`wa-radio[value="${starter}"]`).click();
    await card.locator(`wa-radio[value="${main}"]`).click();
    if (sauce) await card.locator(`wa-radio[value="${sauce}"]`).click();
  }
  await expect(
    page.getByRole("heading", { level: 3, name: "Diner 2: Guest One" }),
  ).toBeVisible();

  await page.locator("#review").click();
  await expect(
    page.getByRole("heading", { name: "Check your order" }),
  ).toBeFocused();
  await expect(
    page.getByRole("heading", { level: 2, name: "Diner 3: Guest Two" }),
  ).toBeVisible();
  await expect(page.getByText("1 × Demo pie")).toBeVisible();
  await expectNoAxeViolations(page, "review page");

  // Repeated clicks must not create duplicate orders.
  await page.locator("#submit-order").dblclick();
  const confirmation = page.locator("#confirmation");
  await expect(confirmation).toContainText(/MM-[A-Z2-9]{8}/);
  await expectNoAxeViolations(page, "confirmation page");
  const id = (await confirmation.textContent()).match(/MM-[A-Z2-9]{8}/)[0];

  // Return later through the same session and amend.
  await page.reload();
  await expect(page.locator("#confirmation")).toContainText(id);
  await page.locator("#edit-booking").click();
  await page.locator("#review").waitFor();
  await cards.nth(1).locator('wa-radio[value="risotto"]').click();
  await page.locator("#review").click();
  await page.locator("#submit-order").click();
  await expect(page.locator("#confirmation")).toContainText(id);
  await expect(page.getByText("1 × Demo risotto")).toHaveCount(2);
  await expect(page.getByText("1 × Demo pie")).toHaveCount(0);
});

test("an incomplete order is rejected with a clear, focusable error summary", async ({
  page,
}) => {
  await openInvitation(page, "isolation-b");
  await pick(page, "attendance", "yes");
  await fillWa(page, "contactName", "Sam Example");
  await page.locator("#review").click();
  const summary = page.locator("#error-summary");
  await expect(summary).toBeFocused();
  await expect(summary).toContainText("Choose at least 1 from Starters");
  await expectNoAxeViolations(page, "error summary");

  // Each problem links to the thing that needs fixing, so a keyboard or
  // screen-reader user need not hunt for it.
  await summary
    .getByRole("link", { name: /Choose at least 1 from Starters/ })
    .first()
    .click();
  await expect(
    page.getByRole("heading", { level: 3, name: /Diner 1/ }),
  ).toBeFocused();
});

test("an invitee cannot read another invitee's booking", async ({
  browser,
}) => {
  const a = await browser.newContext();
  const b = await browser.newContext();
  const pageB = await b.newPage();
  await openInvitation(await a.newPage(), "isolation-a");
  await openInvitation(pageB, "isolation-b");
  const res = await pageB.request.get(
    "/api/booking?invitationId=demo-inv-isolation-a",
  );
  expect((await res.json()).booking?.contactName).not.toBe("Alex Example");
  await a.close();
  await b.close();
});

test("an unapproved draft menu blocks ordering", async ({ page }) => {
  await openInvitation(page, "draft");
  await expect(
    page.getByRole("status").filter({ hasText: "not been confirmed" }),
  ).toBeVisible();
  await expect(page.locator("#review")).toHaveCount(0);
  await expectNoAxeViolations(page, "closed event page");
});

test("the form can be completed using the keyboard alone", async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, "keyboard flow is a desktop concern");
  await openInvitation(page, "isolation-a");
  // Tab from the top of the page until focus reaches the attendance group.
  for (let i = 0; i < 15; i += 1) {
    await page.keyboard.press("Tab");
    if (await page.locator("#attendance:focus-within").count()) break;
  }
  await expect(page.locator("#attendance:focus-within")).toHaveCount(1);
  await page.keyboard.press("Space");
  await expect(page.locator("#contactName")).toBeVisible();
  // The form re-renders after a choice; focus must stay on the chosen radio.
  await expect(page.locator("#attendance:focus-within")).toHaveCount(1);
  await page.keyboard.press("Tab");
  await expect(page.locator("#contactName input")).toBeFocused();
});
