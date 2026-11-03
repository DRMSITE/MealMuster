import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  buildEnvProblems,
  parseEnvFile,
} from "../../scripts/check-build-env.js";
import {
  menuReplacementCheck,
  parseSetupArgs,
  planSetup,
  SMOKE_ORGANISATION_ID,
} from "../../seed/production.js";
import { invitationBlockers } from "../../shared/menu-lifecycle.js";

const NOW = new Date("2026-11-10T09:00:00Z");
const base = [
  "--project",
  "mealmuster-prod",
  "--owner",
  "organiser@example.test",
];

describe("production setup arguments", () => {
  it("accepts a real project, an owner email and an action", () => {
    expect(parseSetupArgs([...base, "--example-event"]).errors).toEqual([]);
  });

  it("refuses a demo project, a bad email and a missing action", () => {
    expect(
      parseSetupArgs([
        "--project",
        "demo-mealmuster",
        "--owner",
        "a@b.test",
        "--smoke",
      ]).errors.join(),
    ).toMatch(/demo project/);
    expect(
      parseSetupArgs([
        "--project",
        "mealmuster-prod",
        "--owner",
        "nope",
        "--smoke",
      ]).errors.join(),
    ).toMatch(/email/);
    expect(parseSetupArgs(base).errors.join()).toMatch(/at least one/);
    expect(
      parseSetupArgs([...base, "--smoke", "--remove-smoke"]).errors.length,
    ).toBe(1);
    expect(
      parseSetupArgs([...base, "--smoke", "--bogus"]).errors.join(),
    ).toMatch(/Unknown/);
  });

  it("is a dry run unless --yes is given", () => {
    expect(parseSetupArgs([...base, "--smoke"]).yes).toBe(false);
    expect(parseSetupArgs([...base, "--smoke", "--yes"]).yes).toBe(true);
  });
});

describe("production setup plan", () => {
  it("writes the Example draft unapproved and never overwrites an existing document", () => {
    const writes = planSetup(
      parseSetupArgs([...base, "--example-event"]),
      "uid-1",
      NOW,
    );
    const menu = writes.find((w) => w.path.startsWith("menus/"));
    const event = writes.find((w) => w.path.startsWith("events/"));
    expect(menu?.mode).toBe("create");
    expect(event?.mode).toBe("create");
    expect(menu?.data).toMatchObject({ status: "draft" });
    expect(event?.data).toMatchObject({
      status: "draft",
      orderingMode: "a_la_carte",
    });
    expect(JSON.stringify(menu?.data)).not.toContain('"approvedAt"');
    expect(
      writes.find((w) => w.path === "memberships/example-club_uid-1")?.data,
    ).toEqual({
      userId: "uid-1",
      organisationId: "example-club",
      role: "owner",
    });
    // Nothing about the club's event is invented.
    for (const key of [
      "startAt",
      "rsvpDeadline",
      "orderDeadline",
      "capacity",
      "organiserContact",
    ])
      expect(event?.data[key]).toBeUndefined();
  });

  it("writes no demo data and no invitations", () => {
    const writes = planSetup(
      parseSetupArgs([...base, "--example-event", "--smoke"]),
      "uid-1",
      NOW,
    );
    expect(writes.some((w) => w.path.startsWith("invitations/"))).toBe(false);
    expect(JSON.stringify(writes)).not.toMatch(/demo-|Demo /);
  });

  it("builds a fictitious RSVP-only smoke event that can issue links, in its own organisation", () => {
    const writes = planSetup(
      parseSetupArgs([...base, "--smoke"]),
      "uid-1",
      NOW,
    );
    expect(writes.map((w) => w.path)).toEqual([
      `memberships/${SMOKE_ORGANISATION_ID}_uid-1`,
      "events/smoke-test-event",
    ]);
    const event = writes[1].data;
    expect(event).toMatchObject({ orderingMode: "rsvp_only", status: "open" });
    expect(invitationBlockers(event, undefined)).toEqual([]);
    expect(Date.parse(event.rsvpDeadline)).toBeGreaterThan(NOW.getTime());
    expect(event.organiserContact).toMatch(/example\.invalid$/);
  });
});

describe("replacing the live draft menu", () => {
  const draft = {
    status: "draft",
    sections: [
      {
        items: [
          { verification: "needs-manual-review" },
          { verification: "verified" },
        ],
      },
    ],
  };

  it("allows an unapproved menu on a draft event and counts confirmations that would be lost", () => {
    expect(menuReplacementCheck(draft, { status: "draft" })).toEqual({
      ok: true,
      reasons: [],
      confirmedItemsLost: 1,
    });
  });

  it("refuses an approved menu, an open event, or anything missing", () => {
    expect(
      menuReplacementCheck(
        { ...draft, status: "approved", approvedAt: "2026-11-03T09:00:00Z" },
        { status: "draft" },
      ).ok,
    ).toBe(false);
    expect(
      menuReplacementCheck({ ...draft, approvedAt: "x" }, { status: "draft" })
        .ok,
    ).toBe(false);
    expect(menuReplacementCheck(draft, { status: "open" }).ok).toBe(false);
    expect(menuReplacementCheck(undefined, undefined).reasons).toHaveLength(2);
  });
});

describe("production build guard", () => {
  const good = {
    VITE_FIREBASE_API_KEY: "key",
    VITE_FIREBASE_AUTH_DOMAIN: "mealmuster-prod.firebaseapp.com",
    VITE_FIREBASE_PROJECT_ID: "mealmuster-prod",
  };

  it("passes real settings", () => {
    expect(buildEnvProblems(good)).toEqual([]);
  });

  it("refuses missing settings", () => {
    expect(buildEnvProblems({}).length).toBe(3);
  });

  it("refuses an emulator-mode or demo-project bundle", () => {
    expect(
      buildEnvProblems({ ...good, VITE_USE_AUTH_EMULATOR: "true" }).join(),
    ).toMatch(/emulator/);
    expect(
      buildEnvProblems({
        ...good,
        VITE_FIREBASE_PROJECT_ID: "demo-mealmuster",
      }).join(),
    ).toMatch(/demo/);
    expect(
      buildEnvProblems({
        ...good,
        VITE_FIREBASE_AUTH_DOMAIN: "localhost",
      }).join(),
    ).toMatch(/local/);
  });

  it("reads KEY=value files, ignoring comments and quotes", () => {
    expect(
      parseEnvFile('# note\nVITE_A=1\nVITE_B="two"\n  VITE_C = three \n'),
    ).toEqual({
      VITE_A: "1",
      VITE_B: "two",
      VITE_C: "three",
    });
  });
});

describe("firebase.json deploy hooks", () => {
  const config = JSON.parse(readFileSync("firebase.json", "utf8"));

  it("syncs the shared code before deploying functions (it is generated and git-ignored)", () => {
    expect(config.functions[0].predeploy).toContain(
      "node scripts/sync-shared.js",
    );
    expect(readFileSync(".gitignore", "utf8")).toContain(
      "functions/src/shared/",
    );
  });

  it("checks the build settings, then builds fresh, before deploying hosting", () => {
    expect(config.hosting.predeploy).toEqual([
      "node scripts/check-build-env.js",
      "npm run build",
    ]);
  });

  it("rewrites /api to the function in its own region", () => {
    const rewrite = config.hosting.rewrites.find((r) => r.source === "/api/**");
    expect(rewrite.function).toEqual({
      functionId: "api",
      region: "europe-west2",
    });
  });
});
