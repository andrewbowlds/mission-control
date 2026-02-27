import { defineConfig } from "vite";

export default defineConfig({
  root: "ui",
  base: "/mission-control/", 
  build: {
    outDir: "../dist/ui",
    emptyOutDir: true,
  },
});
