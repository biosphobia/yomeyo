import { defineConfig } from "vite";

export default defineConfig({
  /**
   * Relative base so the same build works at a domain root, in a GitHub
   * Pages project subpath (/yomeyo/), or from the filesystem — every asset,
   * the manifest, the service worker and the dictionary resolve against
   * wherever index.html happens to live.
   */
  base: "./",
  build: {
    target: "es2022",
  },
});
