import { expect, test } from "@playwright/test";
import { DEMO_PASSWORD, HOSTILE } from "../../seed/demo.js";
import { fillWa, openInvitation } from "./helpers.js";

// Hostile markup is stored in every text field an invitee or organiser can
// control. It must appear literally on every screen and must never run.
test.describe.configure({ mode: "serial" });

/** @type {string[]} */
let dialogs = [];

test.beforeEach(async ({ page }) => {
  dialogs = [];
  page.on("dialog", async (dialog) => {
    dialogs.push(dialog.message());
    await dialog.dismiss();
  });
});

/** Long unbroken text must wrap instead of making the page scroll sideways. */
async function expectNoHorizontalScroll(page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

async function expectInert(page) {
  expect(await page.evaluate(() => window.__xss)).toBeUndefined();
  expect(dialogs).toEqual([]);
  // Nothing was built from the markup: no element was created from it.
  await expect(page.locator("main img[src='x']")).toHaveCount(0);
  await expect(page.locator("main svg[onload]")).toHaveCount(0);
  await expect(page.locator("main script")).toHaveCount(0);
  await expect(page.locator("main a[href^='javascript:']")).toHaveCount(0);
}

test("hostile event, menu and guest text is shown as plain text and never runs", async ({
  page,
}) => {
  await openInvitation(page, "hostile");
  const main = page.locator("main");
  // Organiser-controlled text: title, venue, description, instructions, contact.
  await expect(
    page.getByRole("heading", { level: 1, name: HOSTILE.image, exact: true }),
  ).toBeVisible();
  for (const text of [HOSTILE.script, HOSTILE.svg, HOSTILE.link, HOSTILE.image])
    await expect(main).toContainText(text);
  await expectInert(page);

  await expectNoHorizontalScroll(page);

  // Guest-controlled text: name, dietary request.
  await page.locator('#attendance wa-radio[value="yes"]').click();
  await fillWa(page, "contactName", HOSTILE.image);
  await expect(main).toContainText(`Diner 1: ${HOSTILE.image}`);
  // Menu-controlled text: section, item, description, option group and choice.
  await expect(main).toContainText(HOSTILE.script);
  await page.locator('wa-checkbox[id^="item-"]').first().click();
  await page.locator('wa-textarea[id^="diet-"] textarea').fill(HOSTILE.svg);
  await expectInert(page);

  await page.locator("#review").click();
  await expect(
    page.getByRole("heading", { name: "Check your order" }),
  ).toBeFocused();
  await expect(main).toContainText(HOSTILE.image);
  await expect(main).toContainText(`Dietary request: ${HOSTILE.svg}`);
  await expectInert(page);

  await page.locator("#submit-order").click();
  await expect(page.locator("#confirmation")).toContainText(/MM-[A-Z2-9]{8}/);
  await expect(main).toContainText(HOSTILE.image);
  await expectInert(page);
});

test("hostile text is inert throughout the organiser area", async ({
  page,
}, testInfo) => {
  const linkName = `${HOSTILE.image} (${testInfo.project.name})`;
  await page.goto("/admin");
  await page.locator("#email input").waitFor();
  await fillWa(page, "email", "owner@example.test");
  await fillWa(page, "password", DEMO_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: "Your events" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: HOSTILE.image, exact: true }),
  ).toBeVisible();
  await expectInert(page);

  await page.goto("/admin/events/demo-event-hostile");
  await expect(
    page.getByRole("heading", { level: 1, name: HOSTILE.image, exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("rowheader", { name: linkName })).toBeVisible();
  await expectNoHorizontalScroll(page);
  await expectInert(page);

  await page.getByRole("button", { name: `View for ${linkName}` }).click();
  await expect(page.locator("#detail-h")).toContainText(linkName);
  await expect(page.locator("main")).toContainText(
    `Dietary request: ${HOSTILE.svg}`,
  );
  await expectInert(page);

  await page.goto("/admin/events/demo-event-hostile/summary");
  await expect(page.locator("main")).toContainText(HOSTILE.image);
  await expect(page.locator("main")).toContainText(
    `Dietary request: ${HOSTILE.svg}`,
  );
  await expectInert(page);

  await page.goto("/admin/events/demo-event-hostile/menu");
  await expect(page.getByLabel(`Name of item: ${HOSTILE.image}`)).toHaveValue(
    HOSTILE.image,
  );
  await expect(page.locator("main")).toContainText(HOSTILE.script);
  await expectInert(page);
});
