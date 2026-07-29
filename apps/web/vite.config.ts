import { resolve } from "node:path";
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
    rollupOptions: {
      /**
       * sync.html is the page the browser extension loads in a hidden frame
       * to hand saved words over. It is a separate entry so it stays tiny —
       * it must not pull in the dictionary or the rest of the app.
       */
      input: {
        index: resolve(import.meta.dirname, "index.html"),
        sync: resolve(import.meta.dirname, "sync.html"),
      },
      output: {
        /**
         * Keep the Firebase SDK in one predictably-named chunk. It is loaded
         * dynamically only once cloud sync is configured, and the service
         * worker skips precaching anything named `firebase-*` — so a user who
         * never signs in never downloads it.
         */
        manualChunks(id: string) {
          if (id.includes("node_modules/firebase") || id.includes("node_modules/@firebase")) {
            return "firebase";
          }
          return undefined;
        },
      },
    },
  },
});
