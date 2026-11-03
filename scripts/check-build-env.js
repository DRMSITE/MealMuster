// @ts-check
// Runs before a production Hosting deploy. Refuses to build a bundle that would
// point organiser sign-in at an emulator or a demo project, or that is missing
// the web configuration. The web API key is public by design (it identifies the
// project, it grants nothing), but the values must be the real project's.
import { existsSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const REQUIRED = [
  "VITE_FIREBASE_API_KEY",
  "VITE_FIREBASE_AUTH_DOMAIN",
  "VITE_FIREBASE_PROJECT_ID",
];

/** @param {string} text @returns {Record<string, string>} */
export function parseEnvFile(text) {
  /** @type {Record<string, string>} */
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (match) out[match[1]] = match[2].replace(/^(["'])(.*)\1$/, "$2");
  }
  return out;
}

/**
 * @param {Record<string, string | undefined>} env
 * @returns {string[]} problems; empty means the build may go ahead
 */
export function buildEnvProblems(env) {
  /** @type {string[]} */
  const problems = [];
  for (const key of REQUIRED) if (!env[key]) problems.push(`${key} is not set`);
  if (env.VITE_USE_AUTH_EMULATOR === "true")
    problems.push(
      "VITE_USE_AUTH_EMULATOR is true: sign-in would point at the local emulator",
    );
  if (env.VITE_FIREBASE_PROJECT_ID?.startsWith("demo-"))
    problems.push("VITE_FIREBASE_PROJECT_ID is a demo project");
  if (
    env.VITE_FIREBASE_AUTH_DOMAIN &&
    /localhost|127\.0\.0\.1/.test(env.VITE_FIREBASE_AUTH_DOMAIN)
  )
    problems.push("VITE_FIREBASE_AUTH_DOMAIN is a local address");
  return problems;
}

/** Vite's production precedence, lowest first, then the process environment. */
function loadEnv() {
  /** @type {Record<string, string | undefined>} */
  let env = {};
  for (const file of [
    "web/.env",
    "web/.env.local",
    "web/.env.production",
    "web/.env.production.local",
  ])
    if (existsSync(file))
      env = { ...env, ...parseEnvFile(readFileSync(file, "utf8")) };
  return { ...env, ...process.env };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const problems = buildEnvProblems(loadEnv());
  if (problems.length > 0) {
    console.error("Refusing to build for production:");
    for (const p of problems) console.error(`  - ${p}`);
    console.error("See docs/deployment.md (web/env.example shows the values).");
    process.exit(1);
  }
  console.log("Production build settings look right.");
}
