import { mkdir } from "node:fs/promises";
import { build } from "esbuild";

await mkdir("dist", { recursive: true });

await build({
  entryPoints: ["src/action.ts"],
  bundle: true,
  platform: "node",
  target: "node20",
  format: "esm",
  outfile: "dist/index.js",
  sourcemap: true,
  logLevel: "info",
  define: {
    "process.env.NODE_ENV": '"production"',
  },
});
