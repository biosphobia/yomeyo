import { currentAccount } from "./cloud.js";
import { newCanvas } from "./ocr.js";
import { pendingJobs, runJobs, setJobEnv, sweepShares, type PageSource } from "./ocr-jobs.js";

/**
 * Keeping a batch of pages moving, from the app's side.
 *
 * Three things happen here. The app lends the job runner the one thing the
 * background worker has not got — a PDF renderer. Anything left unfinished
 * is picked up on startup, so a batch interrupted by a closed tab simply
 * carries on. And when the tab is hidden or closing, the service worker is
 * asked to take over, with a Background Sync registered so the browser
 * wakes it again later if it is able.
 *
 * Every one of these is optional. Where none of it works, the batch still
 * runs whenever the app is open, which is where it started.
 */

/** The app's PDF renderer, handed to the job runner. */
async function pdfPages(blob: Blob): Promise<PageSource> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url,
  ).toString();
  const doc = await pdfjs.getDocument({ data: await blob.arrayBuffer() }).promise;
  return {
    total: doc.numPages,
    pageOf: (slot) => slot + 1,
    render: async (slot) => {
      const page = await doc.getPage(slot + 1);
      // A page carrying its own Japanese text needs no OCR at all.
      const content = await page.getTextContent();
      let japanese = 0;
      for (const item of content.items as { str?: string }[]) {
        for (const ch of item.str ?? "") if (/[぀-ヿ一-鿿]/.test(ch)) japanese++;
      }
      if (japanese >= 4) return null;
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: 1300 / base.width });
      const canvas = newCanvas(Math.round(viewport.width), Math.round(viewport.height));
      await page.render({
        canvasContext: canvas.getContext("2d") as CanvasRenderingContext2D,
        viewport,
      } as never).promise;
      return canvas;
    },
    close: () => void doc.destroy(),
  };
}

/** Ask the service worker to carry on, and to be woken again if it can. */
export async function handOverToWorker(): Promise<void> {
  if (!("serviceWorker" in navigator)) return;
  if ((await pendingJobs()).length === 0) return;
  try {
    const registration = await navigator.serviceWorker.ready;
    const uid = (await currentAccount().catch(() => null))?.uid ?? null;
    registration.active?.postMessage({ type: "yomeyo-ocr", uid, budgetMs: 120000 });
    const sync = (registration as ServiceWorkerRegistration & { sync?: { register: (t: string) => Promise<void> } })
      .sync;
    await sync?.register("yomeyo-ocr").catch(() => undefined);
  } catch {
    /* no worker here; the app does the work itself */
  }
}

/** Wire the runner into the app, and pick up anything left unfinished. */
export function resumeOcrJobs(): void {
  setJobEnv({ pdf: pdfPages });

  // Pages read in the background, or offline, still owe their results to
  // any shared copy of the book. This is what settles that debt.
  void sweepShares().catch(() => undefined);
  void pendingJobs().then((jobs) => {
    if (jobs.length > 0) void runJobs().catch(() => undefined);
  });

  // A job that stopped because the service was busy books its own return.
  // Nothing else would wake it, so the app checks in periodically and
  // starts the run again the moment the wait is over.
  window.setInterval(() => {
    void pendingJobs().then((jobs) => {
      if (jobs.length > 0) void runJobs().catch(() => undefined);
    });
  }, 30000);

  // Leaving, or putting the phone down: hand the rest to the worker.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") void handOverToWorker();
  });
  window.addEventListener("pagehide", () => void handOverToWorker());
}
