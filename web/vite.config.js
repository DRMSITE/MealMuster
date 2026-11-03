import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

// In development, /api is proxied to the local Functions emulator only.
const FUNCTIONS_EMULATOR = "http://127.0.0.1:5001";

const apiProxy = {
  "/api": {
    target: FUNCTIONS_EMULATOR,
    changeOrigin: false,
    rewrite: (/** @type {string} */ path) =>
      `/demo-mealmuster/europe-west2/api${path}`,
  },
};

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  server: {
    fs: { allow: [fileURLToPath(new URL("..", import.meta.url))] },
    port: 5173,
    strictPort: true,
    proxy: apiProxy,
  },
  preview: { port: 5173, strictPort: true, proxy: apiProxy },
  build: { outDir: "dist", emptyOutDir: true },
});
