// @ts-check
import { ApiError } from "../api.js";
import { idToken } from "./auth.js";

/** @param {string} method @param {string} path @param {unknown} [body] @returns {Promise<any>} */
export async function adminApi(method, path, body) {
  const response = await fetch(path, {
    method,
    referrerPolicy: "no-referrer",
    headers: {
      Authorization: `Bearer ${await idToken()}`,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new ApiError(response.status, data.error ?? {});
  return data;
}

/** Downloads a CSV through the authenticated API (a plain link could not send the token). @param {string} path @param {string} filename */
export async function downloadCsv(path, filename) {
  const response = await fetch(path, {
    referrerPolicy: "no-referrer",
    headers: { Authorization: `Bearer ${await idToken()}` },
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new ApiError(response.status, data.error ?? {});
  }
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
