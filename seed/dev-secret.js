// @ts-check
// The signing secret used with the emulators only. It is deliberately public and
// worthless: the seed hashes its demo invitation links with it, and the emulator
// runner supplies it to the Functions emulator so those links redeem. A real
// deployment uses a long random value in Secret Manager instead.
export const DEV_SECRET = "dev-only-secret-not-for-production";
