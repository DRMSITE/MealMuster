// @ts-check
import { isMinorUnits } from "./money.js";

/**
 * @typedef {import("./errors.js").ValidationIssue} ValidationIssue
 * @typedef {{ name: string, description?: string, printedPriceMinor?: number, printedTags: string[], verification?: string }} ImportItem
 * @typedef {{ name: string, items: ImportItem[] }} ImportSection
 */

const MAX_SECTIONS = 50;
const MAX_ITEMS = 500;
const MAX_TEXT = 200;

/** @param {unknown} v @returns {v is Record<string, any>} */
const isRecord = (v) =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** @param {unknown} v */
const isText = (v) =>
  typeof v === "string" && v.trim().length > 0 && v.length <= MAX_TEXT;

/**
 * Validates a menu import document and returns a preview. Nothing is
 * approved or published: imported menus are always created as drafts, and
 * original names, printed tags and prices are preserved exactly.
 *
 * @param {unknown} doc
 * @returns {{ ok: boolean, issues: ValidationIssue[], preview: { title: string, currency: string, sections: ImportSection[], itemCount: number, needsReviewCount: number } | null }}
 */
export function validateMenuImport(doc) {
  /** @type {ValidationIssue[]} */
  const issues = [];
  const fail = (
    /** @type {string} */ path,
    /** @type {string} */ code,
    /** @type {string} */ message,
  ) => issues.push({ path, code, message });

  if (!isRecord(doc)) {
    fail("", "invalid_type", "Menu import must be a JSON object");
    return { ok: false, issues, preview: null };
  }
  if (!/^[A-Z]{3}$/.test(String(doc.currency)))
    fail(
      "currency",
      "invalid_currency",
      "Currency must be a three-letter code",
    );
  if (
    !Array.isArray(doc.sections) ||
    doc.sections.length === 0 ||
    doc.sections.length > MAX_SECTIONS
  ) {
    fail(
      "sections",
      "invalid_sections",
      `Provide between 1 and ${MAX_SECTIONS} sections`,
    );
    return { ok: false, issues, preview: null };
  }

  /** @type {ImportSection[]} */
  const sections = [];
  let itemCount = 0;
  let needsReviewCount = 0;
  const seen = new Set();

  doc.sections.forEach((section, si) => {
    const sp = `sections[${si}]`;
    if (!isRecord(section) || !isText(section.name)) {
      fail(`${sp}.name`, "invalid_name", "Section needs a name");
      return;
    }
    if (!Array.isArray(section.items)) {
      fail(`${sp}.items`, "invalid_items", "Section items must be a list");
      return;
    }
    /** @type {ImportItem[]} */
    const items = [];
    section.items.forEach((item, ii) => {
      const ip = `${sp}.items[${ii}]`;
      if (++itemCount > MAX_ITEMS) {
        if (itemCount === MAX_ITEMS + 1)
          fail(
            "sections",
            "too_many_items",
            `At most ${MAX_ITEMS} items are allowed`,
          );
        return;
      }
      if (!isRecord(item) || !isText(item.name)) {
        fail(`${ip}.name`, "invalid_name", "Item needs a name");
        return;
      }
      const key = `${section.name}\u0000${item.name}`;
      if (seen.has(key))
        fail(
          ip,
          "duplicate_item",
          `Duplicate item "${item.name}" in "${section.name}"`,
        );
      seen.add(key);
      if (
        item.printedPriceMinor !== undefined &&
        !isMinorUnits(item.printedPriceMinor)
      ) {
        fail(
          `${ip}.printedPriceMinor`,
          "invalid_price",
          "Price must be a whole number of pence",
        );
      }
      const tags = item.printedTags ?? [];
      if (!Array.isArray(tags) || !tags.every((t) => isText(t))) {
        fail(
          `${ip}.printedTags`,
          "invalid_tags",
          "Tags must be a list of short text values",
        );
      }
      if (item.verification === "needs-manual-review") needsReviewCount++;
      items.push({
        name: item.name,
        description:
          typeof item.description === "string" ? item.description : undefined,
        printedPriceMinor: isMinorUnits(item.printedPriceMinor)
          ? item.printedPriceMinor
          : undefined,
        printedTags: Array.isArray(tags) ? tags.map(String) : [],
        verification:
          typeof item.verification === "string" ? item.verification : undefined,
      });
    });
    sections.push({ name: section.name, items });
  });

  const ok = issues.length === 0;
  return {
    ok,
    issues,
    preview: ok
      ? {
          title: typeof doc.title === "string" ? doc.title : "Imported menu",
          currency: String(doc.currency),
          sections,
          itemCount,
          needsReviewCount,
        }
      : null,
  };
}

/** @param {string} text */
const slug = (text) =>
  text
    .normalize("NFKD")
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .split("-")
    .filter(Boolean)
    .join("-")
    .slice(0, 40) || "item";

/**
 * Turns a validated import into a DRAFT menu. Original names, printed tags and
 * printed prices are kept exactly as supplied. A printed price is deliberately
 * NOT copied to `priceMinor` (the orderable price): a takeaway price is not
 * evidence of a dine-in or group price, so an organiser must set that.
 * Items keep their `needs-manual-review` flag until a person clears it.
 *
 * @param {unknown} doc
 * @param {{ id: string, organisationId: string, title?: string }} target
 * @returns {import("./types.js").Menu}
 */
export function importToMenu(doc, target) {
  const { ok, issues, preview } = validateMenuImport(doc);
  if (!ok || !preview)
    throw new Error(
      `Menu import is invalid: ${issues.map((i) => i.message).join("; ")}`,
    );
  const source = /** @type {Record<string, any>} */ (doc);
  return {
    id: target.id,
    organisationId: target.organisationId,
    title: target.title ?? preview.title,
    source: typeof source.source === "string" ? source.source : undefined,
    importWarning:
      typeof source.warning === "string" ? source.warning : undefined,
    status: "draft",
    currency: preview.currency,
    sections: preview.sections.map((section, si) => ({
      id: `${slug(section.name)}-${si + 1}`,
      name: section.name,
      order: si + 1,
      sectionType: "category",
      items: section.items.map((item, ii) => ({
        id: `${slug(section.name)}-${si + 1}-${slug(item.name)}-${ii + 1}`,
        name: item.name,
        description: item.description,
        printedPriceMinor: item.printedPriceMinor,
        tags: item.printedTags,
        allergenInfoStatus: "unverified",
        available: true,
        sortOrder: ii + 1,
        verification: item.verification ?? "needs-manual-review",
      })),
    })),
  };
}
