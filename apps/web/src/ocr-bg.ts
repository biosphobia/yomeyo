import { setActiveAccount } from "./db.js";
import { pendingJobs, runJobs } from "./ocr-jobs.js";

/**
 * The batch reader, packaged for the service worker.
 *
 * This is built to its own small file (`ocr-bg.js`) and pulled in by the
 * service worker, so a book carries on being read after the tab is shut.
 * It shares every line of the real pipeline — the same detector, the same
 * transcription, the same cache — and differs only in what it cannot
 * reach: there is no sign-in out here, so results are written locally and
 * swept into a shared book the next time the app itself runs, and PDFs
 * (whose renderer does not live here) wait for the app.
 *
 * How long a browser lets a worker run is a browser's business, so the
 * run is given a budget and stops cleanly inside it. Whatever is left is
 * still written down, and the next wake-up — or the next time the app is
 * opened — carries on from exactly there.
 */

interface BackgroundApi {
  run: (uid: string | null, budgetMs: number) => Promise<{ left: number }>;
  pending: (uid: string | null) => Promise<number>;
}

const api: BackgroundApi = {
  async run(uid, budgetMs) {
    // Which account's shelf this is; the worker has no memory of its own.
    setActiveAccount(uid);
    await runJobs({ budgetMs });
    const left = (await pendingJobs()).length;
    return { left };
  },
  async pending(uid) {
    setActiveAccount(uid);
    return (await pendingJobs()).length;
  },
};

(globalThis as unknown as { yomeyoOcrBg: BackgroundApi }).yomeyoOcrBg = api;

export default api;
