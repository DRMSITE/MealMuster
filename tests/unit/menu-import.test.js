import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { validateMenuImport } from "../../shared/menu-import.js";

const draft = JSON.parse(
  readFileSync(
    new URL("../../reference/sample-draft-menu.json", import.meta.url),
    "utf8",
  ),
);

describe("validateMenuImport", () => {
  it("accepts the Sample Kitchen draft and preserves printed tags exactly", () => {
    const result = validateMenuImport(draft);
    expect(result.ok).toBe(true);
    const mains = result.preview?.sections.find((s) => s.name === "Mains");
    expect(mains?.items[0]).toMatchObject({
      name: "Sample Roast Chicken",
      printedPriceMinor: 1190,
      printedTags: ["GF"],
    });
    const lamb = mains?.items.find((i) => i.name === "Lamb Casserole");
    expect(lamb?.printedTags).toEqual(["DF", "GF"]);
  });

  it("reports every item as needing manual review", () => {
    const result = validateMenuImport(draft);
    expect(result.preview?.needsReviewCount).toBe(result.preview?.itemCount);
  });

  it("rejects non-integer, negative and non-numeric prices", () => {
    for (const price of [3.99, -1, "399"]) {
      const result = validateMenuImport({
        currency: "GBP",
        sections: [
          { name: "A", items: [{ name: "X", printedPriceMinor: price }] },
        ],
      });
      expect(result.ok).toBe(false);
      expect(result.issues[0].path).toBe(
        "sections[0].items[0].printedPriceMinor",
      );
    }
  });

  it("rejects duplicates, missing names and bad structure", () => {
    expect(validateMenuImport(null).ok).toBe(false);
    expect(validateMenuImport({ currency: "GBP", sections: [] }).ok).toBe(
      false,
    );
    const dup = validateMenuImport({
      currency: "GBP",
      sections: [
        { name: "A", items: [{ name: "X" }, { name: "X" }, { name: " " }] },
      ],
    });
    expect(dup.issues.map((i) => i.code)).toEqual([
      "duplicate_item",
      "invalid_name",
    ]);
  });

  it("keeps markup as inert text", () => {
    const result = validateMenuImport({
      currency: "GBP",
      sections: [
        { name: "A", items: [{ name: "<img src=x onerror=alert(1)>" }] },
      ],
    });
    expect(result.preview?.sections[0].items[0].name).toBe(
      "<img src=x onerror=alert(1)>",
    );
  });
});
