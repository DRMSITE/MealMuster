// @ts-check
/**
 * @typedef {{ method: string, path: string, headers: Record<string, string | undefined>, body?: any, ip?: string }} ApiRequest
 * @typedef {{ status: number, headers?: Record<string, string>, body?: any, text?: string }} ApiResponse
 */

/** @param {number} status @param {string} code @param {string} message @param {unknown} [details] @param {Record<string, string>} [headers] @returns {ApiResponse} */
export const fail = (status, code, message, details, headers) => ({
  status,
  headers,
  body: { error: { code, message, ...(details ? { details } : {}) } },
});

/** @param {any} body @returns {ApiResponse} */
export const ok = (body, status = 200) => ({ status, body });
