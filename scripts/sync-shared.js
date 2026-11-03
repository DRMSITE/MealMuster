// Copies shared/ into functions/src/shared so the deployed Functions bundle is
// self-contained (Firebase uploads only the functions/ directory).
import { cpSync, mkdirSync, rmSync } from "node:fs";

const target = new URL("../functions/src/shared/", import.meta.url);
rmSync(target, { recursive: true, force: true });
mkdirSync(target, { recursive: true });
cpSync(new URL("../shared/", import.meta.url), target, { recursive: true });
