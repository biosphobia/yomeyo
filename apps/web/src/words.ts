import { liveCards, saveCard } from "./store.js";

/** Words page: browse, delete, export/import the deck. */

export async function renderWords(main: HTMLElement, isCurrent: () => boolean = () => true): Promise<void> {
  const cards = (await liveCards()).sort((a, b) => b.createdAt - a.createdAt);
  if (!isCurrent()) return; // a newer render has taken over

  main.innerHTML = `
    <h1>Words</h1>
    <p class="subtitle">${cards.length} saved word${cards.length === 1 ? "" : "s"}</p>
    <div class="row-actions" style="margin-bottom:14px">
      <button id="export-btn" class="secondary">Export JSON</button>
      <button id="import-btn" class="secondary">Import JSON</button>
      <input type="file" id="import-file" accept="application/json" style="display:none" />
    </div>
    <div id="word-list" class="card-panel" style="padding:6px 14px"></div>
  `;

  const list = main.querySelector<HTMLDivElement>("#word-list")!;
  if (cards.length === 0) {
    list.innerHTML = `<div class="empty-state"><div class="big">📖</div>No words yet.<br/>Tap words in the Reader (or via the browser extension) to start mining.</div>`;
  }

  for (const card of cards) {
    const row = document.createElement("div");
    row.className = "word-row";
    row.innerHTML = `
      <div class="word">
        <div><span class="term" lang="ja"><b>${escapeHtml(card.term)}</b></span>
          <span class="reading" style="color:var(--accent);font-size:0.85rem">${escapeHtml(card.reading)}</span></div>
        <div class="glosses">${escapeHtml(card.glosses.join(" · "))}</div>
      </div>
      <div class="due">${dueLabel(card.due, card.state)}</div>
      <button class="ghost" title="Delete">✕</button>
    `;
    row.querySelector("button")!.addEventListener("click", async () => {
      await saveCard({ ...card, deleted: true, updatedAt: Date.now() });
      row.remove();
    });
    list.appendChild(row);
  }

  main.querySelector<HTMLButtonElement>("#export-btn")!.addEventListener("click", async () => {
    const data = JSON.stringify(await liveCards(), null, 2);
    const blob = new Blob([data], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `yomeyo-deck-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  });

  const fileInput = main.querySelector<HTMLInputElement>("#import-file")!;
  main.querySelector<HTMLButtonElement>("#import-btn")!.addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    try {
      const imported = JSON.parse(await file.text());
      if (!Array.isArray(imported)) throw new Error("not an array");
      let count = 0;
      for (const card of imported) {
        if (card && typeof card.id === "string" && typeof card.term === "string") {
          await saveCard({ ...card, updatedAt: card.updatedAt ?? Date.now() });
          count++;
        }
      }
      alert(`Imported ${count} cards.`);
      renderWords(main);
    } catch {
      alert("That file doesn't look like a Yomeyo deck export.");
    }
  });
}

function dueLabel(due: number, state: string): string {
  if (state === "new") return "new";
  const diff = due - Date.now();
  if (diff <= 0) return "due";
  const days = Math.round(diff / 86400000);
  if (days === 0) return "today";
  return `${days}d`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
