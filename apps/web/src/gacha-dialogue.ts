/**
 * The lines the characters say, drawn over the picture in chunky pixels.
 *
 * The text goes onto a small canvas and is then scaled up with
 * `image-rendering: pixelated`, which gives real blocky letters out of
 * whatever font the device already has — no webfont to download, and it
 * looks the same everywhere. Lines type themselves out a character at a
 * time, which is both the convention and a way of pacing a beat.
 *
 * What is said lives in `prizes.json`, so every line can be rewritten on
 * GitHub without touching the code.
 */

/** How many device pixels one drawn pixel becomes. Bigger is chunkier. */
const CHUNK = 4;
/** Characters a second. */
const SPEED = 26;

export interface Line {
  /** When it appears, in scene seconds. */
  at: number;
  /** How long it stays up. */
  seconds: number;
  /** Who is speaking — drawn above the line. Empty for a caption. */
  who: string;
  text: string;
  /** Bigger, shakier, for a line that is being shouted. */
  loud?: boolean;
}

export interface Dialogue {
  /** Draw whatever should be on screen at this moment. */
  update: (t: number) => void;
  dispose: () => void;
}

export function createDialogue(host: HTMLElement, lines: Line[]): Dialogue {
  const canvas = document.createElement("canvas");
  canvas.className = "scene-dialogue";
  host.appendChild(canvas);
  const ctx = canvas.getContext("2d");

  let width = 0;
  let height = 0;
  const fit = (): void => {
    width = Math.max(1, Math.round(host.clientWidth / CHUNK));
    height = Math.max(1, Math.round(host.clientHeight / CHUNK));
    canvas.width = width;
    canvas.height = height;
  };
  fit();
  const onResize = (): void => fit();
  addEventListener("resize", onResize);

  /** Wrap to the box, in the small canvas's own coordinates. */
  function wrap(text: string, max: number): string[] {
    if (!ctx) return [text];
    const out: string[] = [];
    let line = "";
    for (const word of text.split(/\s+/)) {
      const next = line ? `${line} ${word}` : word;
      if (ctx.measureText(next).width > max && line) {
        out.push(line);
        line = word;
      } else {
        line = next;
      }
    }
    if (line) out.push(line);
    return out;
  }

  const update = (t: number): void => {
    if (!ctx) return;
    ctx.clearRect(0, 0, width, height);
    const line = lines.find((l) => t >= l.at && t < l.at + l.seconds);
    if (!line) return;

    // Sized against the picture rather than fixed, so the box is a bar along
    // the bottom on every screen instead of half the frame on a small one.
    const base = Math.max(5, Math.min(11, Math.round(height * 0.045)));
    const size = line.loud ? Math.round(base * 1.35) : base;
    ctx.font = `bold ${size}px system-ui, sans-serif`;
    ctx.textBaseline = "top";

    // Typed out, then held.
    const shown = Math.min(line.text.length, Math.floor((t - line.at) * SPEED));
    const text = line.text.slice(0, shown);
    const rows = wrap(text, width - Math.round(base * 2.4) * 2);

    const lineHeight = size + 2;
    const nameHeight = line.who ? Math.round(base * 0.9) + 2 : 0;
    const pad = Math.round(base * 0.6);
    const boxHeight = rows.length * lineHeight + nameHeight + pad * 2;
    const top = height - boxHeight - pad;

    // A shout gets a shake, which costs one sine.
    const jolt = line.loud ? Math.round(Math.sin(t * 47) * 1.2) : 0;

    ctx.fillStyle = "rgba(6, 8, 14, 0.82)";
    ctx.fillRect(pad, top, width - pad * 2, boxHeight);
    ctx.fillStyle = line.loud ? "#ffd34d" : "#ffffff";
    ctx.fillRect(pad, top, width - pad * 2, 1);

    let y = top + pad;
    if (line.who) {
      ctx.fillStyle = "#8fd8f0";
      ctx.font = `bold ${Math.round(base * 0.9)}px system-ui, sans-serif`;
      ctx.fillText(line.who, pad * 2 + jolt, y);
      ctx.font = `bold ${size}px system-ui, sans-serif`;
      y += nameHeight;
    }
    ctx.fillStyle = line.loud ? "#ffd34d" : "#f2f0ea";
    for (const row of rows) {
      ctx.fillText(row, pad * 2 + jolt, y);
      y += lineHeight;
    }
  };

  return {
    update,
    dispose: () => {
      removeEventListener("resize", onResize);
      canvas.remove();
    },
  };
}
