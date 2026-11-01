import { copyFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Static client-only build of the prototype for GitHub Pages.
const outDir = resolve(__dirname, "dist-pages");

export default defineConfig({
  root: resolve(__dirname, "static"),
  base: "/nova-finops/",
  publicDir: resolve(__dirname, "public"),
  resolve: { alias: { "@": __dirname } },
  plugins: [
    react(),
    {
      name: "spa-fallback",
      closeBundle() {
        // Pages serves 404.html for unknown paths, so deep links like /app still load the app.
        copyFileSync(resolve(outDir, "index.html"), resolve(outDir, "404.html"));
        writeFileSync(resolve(outDir, ".nojekyll"), "");
      },
    },
  ],
  build: { outDir, emptyOutDir: true },
});
