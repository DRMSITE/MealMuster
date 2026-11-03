import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { DEMO_PASSWORD } from "../../seed/demo.js";
import { expectNoAxeViolations, fillWa } from "./helpers.js";

const EXAMPLE_EVENT = "example-club-sample-kitchen";
const ITEM_COUNT = JSON.parse(
  readFileSync("reference/sample-draft-menu.json", "utf8"),
).sections.flatMap((s) => s.items).length;

async function signInTo(page, path) {
  await page.goto("/admin");
  await page.locator("#email input").waitFor();
  await fillWa(page, "email", "owner@example.test");
  await fillWa(page, "password", DEMO_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: "Your events" }),
  ).toBeVisible();
  await page.goto(path);
}

test("the Sample Kitchen draft is clearly unapproved and cannot be opened to guests", async ({
  page,
}) => {
  await signInTo(page, `/admin/events/${EXAMPLE_EVENT}`);
  await expect(
    page.getByRole("heading", { level: 1, name: /Sample Kitchen/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Before you can invite people" }),
  ).toBeVisible();
  for (const todo of [
    "To do: Event date and time",
    "To do: Organiser contact",
    "To do: RSVP deadline",
    "To do: Order deadline",
    "To do: Menu approved",
  ])
    await expect(page.getByText(todo)).toBeVisible();
  await expect(
    page.getByText(`${ITEM_COUNT} of ${ITEM_COUNT} items still need checking`),
  ).toBeVisible();
  await expect(page.getByText("Links cannot be created yet.")).toBeVisible();
  await expect(page.locator("#open-orders")).toHaveAttribute("disabled", "");
  await expect(
    page.getByRole("button", { name: "Create link" }),
  ).toBeDisabled();
  await expectNoAxeViolations(page, "Example draft dashboard");
});

test("the Example menu review shows the transcription without approving it", async ({
  page,
}) => {
  await signInTo(page, `/admin/events/${EXAMPLE_EVENT}/menu`);
  await expect(
    page.getByRole("heading", { level: 1, name: /Review menu/ }),
  ).toBeVisible();
  await expect(page.getByText("Status: draft.")).toBeVisible();
  await expect(page.getByText(/not a confirmed Christmas/i)).toBeVisible();
  await expect(
    page.getByText(`0 of ${ITEM_COUNT} items saved as checked.`),
  ).toBeVisible();
  await expect(page.getByText("£3.99").first()).toBeVisible();
  await expect(page.locator("#approve-menu")).toHaveAttribute("disabled", "");
  // Even after the confirmation box, unchecked items keep approval disabled.
  await page.getByLabel("I have checked every item with the venue").check();
  await expect(page.locator("#approve-menu")).toHaveAttribute("disabled", "");
  await expectNoAxeViolations(page, "Example menu review");
});

test("an organiser can check a menu, approve it, set the details and open it to guests", async ({
  page,
  browser,
}, testInfo) => {
  const project = testInfo.project.name;
  const eventId = `demo-event-approve-${project}`;
  await signInTo(page, `/admin/events/${eventId}`);
  await expect(page.locator("#open-orders")).toHaveAttribute("disabled", "");

  // Review the menu: check two items, mark one as not offered, fix a name.
  await page.getByRole("link", { name: "Review and approve the menu" }).click();
  await expect(page.getByText("0 of 3 items saved as checked.")).toBeVisible();
  await page.getByLabel("Checked against the venue: Demo curry").check();
  await page.getByLabel("Offered by the venue: Demo rice").uncheck();
  await page.getByLabel("Name of item: Demo dhal").fill("Demo dhal (lentils)");
  await page.getByLabel("Checked against the venue: Demo dhal").check();
  await expect(
    page.getByLabel("Checked against the venue: Demo rice"),
  ).toBeChecked();
  await page.getByRole("button", { name: "Save checks" }).click();
  await expect(page.getByText("Your checks are saved.")).toBeVisible();
  await expect(page.getByText("3 of 3 items saved as checked.")).toBeVisible();
  await expectNoAxeViolations(page, "menu review with checks");

  await page.getByLabel("I have checked every item with the venue").check();
  await page.getByRole("button", { name: "Approve menu" }).click();
  await expect(page.getByText("The menu is approved.")).toBeVisible();
  await expect(page.getByText("can no longer be edited")).toBeVisible();
  await expect(
    page.getByLabel("Name of item: Demo dhal (lentils)"),
  ).toBeDisabled();

  // The menu is approved, but the event is still not ready: details are missing.
  await page.goto(`/admin/events/${eventId}`);
  await expect(page.getByText("Done: Menu approved")).toBeVisible();
  await expect(page.locator("#open-orders")).toHaveAttribute("disabled", "");

  // A past date is refused with a clear message.
  await page.locator("#set-start").fill("2020-01-01T18:00");
  await page.getByRole("button", { name: "Save event details" }).click();
  await expect(page.getByRole("alert")).toContainText("future");

  await page.locator("#set-start").fill("2098-12-12T18:30");
  await page.locator("#set-rsvp").fill("2098-11-30T12:00");
  await page.locator("#set-order").fill("2098-12-01T12:00");
  await fillWa(page, "set-contact", "organiser@example.test");
  await page.getByRole("button", { name: "Save event details" }).click();
  await expect(page.getByText("Event details saved.")).toBeVisible();
  await expect(page.getByText("To do: Event date and time")).toHaveCount(0);
  await expectNoAxeViolations(page, "dashboard with details");

  await page.locator("#open-orders").click();
  await expect(page.getByText("Orders are open.")).toBeVisible();

  // Now a link can be created, and it opens the event for a guest.
  await fillWa(page, "link-name", "Walkthrough guest");
  await page.getByRole("button", { name: "Create link" }).click();
  const link = await page.locator("#new-link").inputValue();
  const guest = await browser.newContext({
    extraHTTPHeaders: {
      "x-forwarded-for": `198.51.100.${project === "mobile" ? 91 : 90}`,
    },
  });
  const guestPage = await guest.newPage();
  await guestPage.goto(link);
  await expect(
    guestPage.getByRole("heading", {
      level: 1,
      name: `Demo Approval Event ${project}`,
    }),
  ).toBeVisible();
  await guest.close();
});
