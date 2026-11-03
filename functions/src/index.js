// @ts-check
import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import {
  defineInt,
  defineSecret,
  defineString,
} from "firebase-functions/params";
import { onRequest } from "firebase-functions/v2/https";
import { createApp } from "./app.js";
import { createFirestoreRepo } from "./firestore-repo.js";

const appSecret = defineSecret("MEALMUSTER_SECRET");
const allowedOrigins = defineString("ALLOWED_ORIGINS", {
  default: "http://localhost:5000,http://127.0.0.1:5000",
});

// Redemption attempts allowed per minute per IP; raised only in the local emulator.
const redeemLimit = defineInt("REDEEM_LIMIT", { default: 10 });

initializeApp();

/**
 * Verifies a Firebase ID token (against the Auth emulator when it is running).
 * Revocation is checked so a disabled organiser loses access promptly.
 * @param {string} token
 */
async function verifyIdToken(token) {
  try {
    const decoded = await getAuth().verifyIdToken(token, true);
    return { uid: decoded.uid };
  } catch {
    return null;
  }
}

/** @type {ReturnType<typeof createApp> | undefined} */
let handler;

/**
 * Single HTTPS entry point behind Hosting's /api/** rewrite. maxInstances caps
 * cost exposure from abusive traffic.
 */
export const api = onRequest(
  { secrets: [appSecret], maxInstances: 10, region: "europe-west2" },
  async (req, res) => {
    handler ??= createApp(createFirestoreRepo(getFirestore()), {
      secret: appSecret.value(),
      redeemLimit:
        process.env.FUNCTIONS_EMULATOR === "true" && process.env.REDEEM_LIMIT
          ? Number(process.env.REDEEM_LIMIT)
          : redeemLimit.value(),
      allowedOrigins: allowedOrigins
        .value()
        .split(",")
        .map((o) => o.trim()),
      secureCookies: process.env.FUNCTIONS_EMULATOR !== "true",
      verifyIdToken,
    });
    const result = await handler({
      method: req.method,
      path: req.path,
      headers: /** @type {Record<string, string | undefined>} */ (req.headers),
      body: req.body,
      ip: req.ip,
    });
    res.set({
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
      ...result.headers,
    });
    if (result.text !== undefined) res.status(result.status).send(result.text);
    else if (result.body === undefined) res.status(result.status).end();
    else res.status(result.status).json(result.body);
  },
);
