import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { DEMO_PASSWORD } from "../../seed/demo.js";
import { fillWa, tokens } from "../e2e/helpers.js";

// The Hosting emulator in use neither applies `hosting.headers` nor passes
// Set-Cookie from functions, although real Firebase Hosting applies headers. So
// the production bundle is served by `vite preview`, and these tests read the
// exact header set shipped in firebase.json and add it to each page response, so
// the browser enforces the real policy. What this cannot prove is that Hosting
// itself delivers the headers and the session cookie: verify both on the first
// deployed preview channel.
const firebase = JSON.parse(readFileSync("firebase.json", "utf8"));
const shipped = Object.fromEntries(
  firebase.hosting.headers
    .filter((rule) => rule.source === "**")
    .flatMap((rule) => rule.headers)
    .map((h) => [h.key.toLowerCase(), h.value]),
);
const AUTH_EMULATOR = "http://127.0.0.1:9099";

/** Applies the shipped headers to page loads; optionally lets the CSP reach the Auth emulator. */
async function enforceShippedHeaders(page, { allowAuthEmulator = false } = {}) {
  await page.route("**/*", async (route) => {
    if (route.request().resourceType() !== "document") return route.continue();
    const response = await route.fetch();
    const headers = { ...response.headers(), ...shipped };
    if (allowAuthEmulator)
      headers["content-security-policy"] = headers[
        "content-security-policy"
      ].replace("connect-src 'self'", `connect-src 'self' ${AUTH_EMULATOR}`);
    return route.fulfill({ response, headers });
  });
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.__csp = [];
    document.addEventListener("securitypolicyviolation", (e) => {
      window.__csp.push(`${e.violatedDirective}: ${e.blockedURI || "inline"}`);
    });
  });
});

const violations = (page) => page.evaluate(() => window.__csp);

test("firebase.json ships the full security header set", () => {
  const csp = shipped["content-security-policy"];
  for (const directive of [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "form-action 'self'",
  ])
    expect(csp).toContain(directive);
  expect(csp).not.toContain("unsafe-eval");
  expect(csp).not.toContain("unsafe-inline");
  // Only the two Firebase Auth hosts may be contacted besides this site.
  expect(csp).toMatch(
    /connect-src 'self' https:\/\/identitytoolkit\.googleapis\.com https:\/\/securetoken\.googleapis\.com;/,
  );
  expect(shipped["strict-transport-security"]).toContain("max-age=");
  expect(shipped["x-content-type-options"]).toBe("nosniff");
  expect(shipped["x-frame-options"]).toBe("DENY");
  expect(shipped["referrer-policy"]).toBe("no-referrer");
  expect(shipped["permissions-policy"]).toContain("camera=()");
  expect(shipped["cross-origin-opener-policy"]).toBe("same-origin");
  expect(shipped["x-robots-tag"]).toContain("noindex");
});

test("Hosting rewrites /api to the function in its own region, uncached", async ({
  request,
}) => {
  const hosting = "http://localhost:5000";
  const res = await request.get(`${hosting}/api/session`);
  expect(res.status()).toBe(401);
  expect(res.headers()["cache-control"]).toContain("no-store");
  expect(res.headers()["referrer-policy"]).toBe("no-referrer");
  const admin = await request.get(`${hosting}/api/admin/events`);
  expect(admin.status()).toBe(401);
  expect(admin.headers()["cache-control"]).toContain("no-store");
});

test("the invitee journey works under the shipped CSP with no violations", async ({
  page,
}) => {
  await enforceShippedHeaders(page);
  await page.setExtraHTTPHeaders({ "x-forwarded-for": "198.51.100.150" });
  await page.goto(`/i#${tokens()["isolation-b"]}`);
  await page.waitForURL("**/invitation");
  await expect(
    page.getByRole("heading", { level: 1, name: "Demo Club Dinner" }),
  ).toBeVisible();
  await page.locator('#attendance wa-radio[value="yes"]').click();
  await fillWa(page, "contactName", "CSP Check");
  await page.locator("#add-guest").click();
  await expect(page.locator("wa-card")).toHaveCount(2);
  await page.locator('wa-card wa-radio[value="soup"]').first().click();
  await page.locator("#review").click();
  await expect(page.locator("#error-summary")).toBeVisible();
  expect(await violations(page)).toEqual([]);
});

test("the organiser area works under the shipped CSP with no violations", async ({
  page,
}) => {
  await enforceShippedHeaders(page, { allowAuthEmulator: true });
  await page.goto("/admin");
  await page.locator("#email input").waitFor();
  await fillWa(page, "email", "owner@example.test");
  await fillWa(page, "password", DEMO_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: "Your events" }),
  ).toBeVisible();
  for (const [path, heading] of [
    ["/admin/events/demo-event-set", "Demo Club Dinner"],
    ["/admin/events/demo-event-set/menu", /Review menu/],
    ["/admin/events/demo-event-set/summary", /Order summary/],
  ]) {
    await page.goto(path);
    await expect(
      page.getByRole("heading", { level: 1, name: heading }),
    ).toBeVisible();
  }
  expect(await violations(page)).toEqual([]);
});

test("the policy really blocks an injected inline script", async ({ page }) => {
  await enforceShippedHeaders(page);
  await page.setExtraHTTPHeaders({ "x-forwarded-for": "198.51.100.151" });
  await page.goto("/admin");
  await page.evaluate(() => {
    const script = document.createElement("script");
    script.textContent = "window.__injected = true";
    document.head.append(script);
  });
  expect(await page.evaluate(() => window.__injected)).toBeUndefined();
  expect((await violations(page)).join()).toContain("script-src");
});
