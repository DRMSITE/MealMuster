// @ts-check
/** Money is always integer minor units (pence). Never floating point. */

/**
 * @param {unknown} value
 * @returns {value is number}
 */
export function isMinorUnits(value) {
  return Number.isSafeInteger(value) && /** @type {number} */ (value) >= 0;
}

/**
 * @param {number} minor
 * @param {string} [currency]
 * @param {string} [locale]
 */
export function formatMoney(minor, currency = "GBP", locale = "en-GB") {
  if (!Number.isSafeInteger(minor))
    throw new TypeError("Amount must be an integer number of minor units");
  return new Intl.NumberFormat(locale, { style: "currency", currency }).format(
    minor / 100,
  );
}

/** @param {number[]} amounts */
export function sumMinor(amounts) {
  return amounts.reduce((total, amount) => {
    if (!Number.isSafeInteger(amount))
      throw new TypeError("Amount must be an integer number of minor units");
    return total + amount;
  }, 0);
}
