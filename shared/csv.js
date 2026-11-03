// @ts-check

/**
 * Escapes one CSV cell: neutralises spreadsheet formulas (leading = + - @ tab
 * CR) by prefixing an apostrophe, then applies RFC 4180 quoting.
 * @param {unknown} value
 */
export function csvCell(value) {
  let text = value === null || value === undefined ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/** @param {unknown[][]} rows */
export function toCsv(rows) {
  return `${rows.map((r) => r.map(csvCell).join(",")).join("\r\n")}\r\n`;
}
