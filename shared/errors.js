// @ts-check

/** @typedef {{ path: string, code: string, message: string }} ValidationIssue */

export class ValidationError extends Error {
  /** @param {ValidationIssue[]} issues */
  constructor(issues) {
    super("Validation failed");
    this.name = "ValidationError";
    this.issues = issues;
  }
}
