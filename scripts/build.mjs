import { build } from "esbuild";

await build({
  entryPoints: ["index.ts", "scripts/fetch-models.ts", "scripts/sync-models.ts", "scripts/install.ts"],
  outdir: "dist",
  bundle: true,
  platform: "node",
  target: "node20",
  format: "esm",
  mainFields: ["module", "main"],
  // Installable artifacts include their dependencies and need no runtime npm install.
  sourcemap: false,
  logLevel: "info",
});
