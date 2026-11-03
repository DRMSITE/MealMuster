import { expect, test } from "@playwright/test";
import { DEMO_PASSWORD } from "../../seed/demo.js";
import { expectNoAxeViolations, fillWa } from "./helpers.js";

async function signIn(page, email, password = DEMO_PASSWORD) {
  await page.goto("/admin");
  await page.locator("#email input").waitFor();
  await fillWa(page, "email", email);
  await fillWa(page, "password", password);
  await page.getByRole("button", { name: "Sign in" }).click();
}

async function openEvent(page, email, eventId = "demo-event-set") {
  await signIn(page, email);
  await expect(
    page.getByRole("heading", { level: 1, name: "Your events" }),
  ).toBeVisible();
  await page.goto(`/admin/events/${eventId}`);
  await expect(
    page.getByRole("heading", { level: 2, name: "Attendance" }),
  ).toBeVisible();
}

test("sign-in gives one generic message for a wrong password", async ({
  page,
}) => {
  await page.goto("/admin");
  await expectNoAxeViolations(page, "organiser sign-in");
  await signIn(page, "owner@example.test", "not-the-password");
  await expect(page.getByRole("alert")).toContainText("not recognised");
  await expect(page.locator("#sign-in-error")).toBeFocused();
  await expectNoAxeViolations(page, "sign-in error");
});

test("an owner sees only their own organisation's events", async ({ page }) => {
  await signIn(page, "owner@example.test");
  await expect(
    page.getByRole("link", { name: "Demo Club Dinner" }),
  ).toBeVisible();
  await expect(page.getByText("Other Organisation Event")).toHaveCount(0);
  await expectNoAxeViolations(page, "event list");
});

test("another organisation cannot open the event", async ({ page }) => {
  await signIn(page, "outsider@example.test");
  await expect(page.getByText("Other Organisation Event")).toBeVisible();
  await page.goto("/admin/events/demo-event-set");
  await expect(page.getByRole("alert")).toContainText("do not have access");
  await expect(page.getByText("Demo Club Dinner")).toHaveCount(0);
});

test("the dashboard shows counts and passes accessibility checks", async ({
  page,
}) => {
  await openEvent(page, "owner@example.test");
  await expect(page.getByText("Links issued")).toBeVisible();
  await expect(page.getByRole("table", { name: /Invitations/ })).toBeVisible();
  await expectNoAxeViolations(page, "organiser dashboard");
});

test("a created link works once shared, and revoking it stops it", async ({
  page,
  browser,
}, testInfo) => {
  const name = `Link test ${testInfo.project.name}`;
  await openEvent(page, "owner@example.test");
  await fillWa(page, "link-name", name);
  await page.getByRole("button", { name: "Create link" }).click();
  const link = await page.locator("#new-link").inputValue();
  expect(link).toMatch(/\/i#[\w-]{40,}$/);
  await expectNoAxeViolations(page, "dashboard with new link");

  const invitee = await browser.newContext({
    extraHTTPHeaders: { "x-forwarded-for": "198.51.100.77" },
  });
  const inviteePage = await invitee.newPage();
  await inviteePage.goto(link);
  await expect(
    inviteePage.getByRole("heading", { level: 1, name: "Demo Club Dinner" }),
  ).toBeVisible();

  await page.getByRole("button", { name: `Revoke for ${name}` }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "no longer works" }),
  ).toBeVisible();

  const after = await browser.newContext({
    extraHTTPHeaders: { "x-forwarded-for": "198.51.100.78" },
  });
  const afterPage = await after.newPage();
  await afterPage.goto(link);
  await expect(
    afterPage.getByRole("heading", {
      name: "We could not open your invitation",
    }),
  ).toBeVisible();
  await invitee.close();
  await after.close();
});

test("exports download, escape formulas and keep dietary notes to the restaurant file", async ({
  page,
}) => {
  await openEvent(page, "owner@example.test");
  const read = async (label) => {
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: label }).click(),
    ]);
    const stream = await download.createReadStream();
    let text = "";
    for await (const chunk of stream) text += chunk;
    return text;
  };
  const restaurant = await read("Restaurant order CSV");
  expect(restaurant).toContain("'=HYPERLINK");
  expect(restaurant).not.toMatch(/(^|,)=HYPERLINK/m);
  expect(restaurant).toContain("Demo dietary request");
  const attendance = await read("Attendance CSV");
  expect(attendance).not.toContain("Demo dietary request");
  const totals = await read("Item totals CSV");
  expect(totals).toContain("Demo soup");
});

test("the printable summary groups orders by item and by person", async ({
  page,
}) => {
  await openEvent(page, "owner@example.test");
  await page.getByRole("link", { name: "Open printable summary" }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: /Order summary/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("table", { name: "Quantity of each item" }),
  ).toBeVisible();
  await expect(
    page.getByText("Dietary request: Demo dietary request"),
  ).toBeVisible();
  await expectNoAxeViolations(page, "printable summary");
});

test("an owner can close orders and reopen them", async ({ page }) => {
  await openEvent(page, "owner@example.test");
  await page.getByRole("button", { name: "Close orders now" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "closed" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Reopen orders" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "open again" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Close orders now" }),
  ).toBeVisible();
});

test("only an owner is offered personal-data deletion", async ({ page }) => {
  await openEvent(page, "helper@example.test");
  await expect(
    page.getByText("Only an organisation owner can delete personal data."),
  ).toBeVisible();
});

test("an owner can delete a closed event's personal data after typing its title", async ({
  page,
}, testInfo) => {
  const project = testInfo.project.name;
  await openEvent(
    page,
    "owner@example.test",
    `demo-event-retention-${project}`,
  );
  await expect(page.getByText("Held")).toBeVisible();
  await fillWa(page, "confirm-title", "wrong title");
  await page.getByRole("button", { name: "Delete personal data" }).click();
  await expect(page.getByRole("alert")).toContainText("exactly");
  await fillWa(page, "confirm-title", `Demo Retention Event ${project}`);
  await page.getByRole("button", { name: "Delete personal data" }).click();
  await expect(page.getByText(/Deleted /)).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Delete personal data" }),
  ).toHaveCount(0);
  await expectNoAxeViolations(page, "after deletion");
});
