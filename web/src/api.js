// @ts-check

export class ApiError extends Error {
  /** @param {number} status @param {{ code?: string, message?: string, details?: any[] }} error */
  constructor(status, error) {
    super(error.message ?? "Request failed");
    this.status = status;
    this.code = error.code ?? "error";
    this.details = error.details ?? [];
  }
}

/** @type {string | undefined} */
let csrfToken;

/** @param {string | undefined} token */
export function setCsrfToken(token) {
  csrfToken = token;
}

/**
 * @param {string} method @param {string} path @param {unknown} [body]
 * @returns {Promise<any>}
 */
export async function api(method, path, body) {
  const response = await fetch(path, {
    method,
    credentials: "same-origin",
    referrerPolicy: "no-referrer",
    headers: {
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(method === "GET" || !csrfToken ? {} : { "X-CSRF-Token": csrfToken }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (response.status === 204) return null;
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new ApiError(response.status, data.error ?? {});
  return data;
}
