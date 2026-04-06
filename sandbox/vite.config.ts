import path from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const sandboxRoot = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: sandboxRoot,
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": "http://127.0.0.1:3030",
    },
  },
  build: {
    outDir: path.resolve(sandboxRoot, "dist"),
    emptyOutDir: true,
    sourcemap: true,
  },
});
