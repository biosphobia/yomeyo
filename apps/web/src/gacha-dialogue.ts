/**
 * The lines the characters say, drawn over the picture in chunky pixels.
 *
 * They float above whoever is speaking, which is the whole point: a subtitle
 * bar along the bottom says *something was said*, while a line over Yuuri's
 * head says *Yuuri said it* — no name tag needed, and none is drawn. The line
 * follows her as the shot moves, and stays inside the frame when she walks
 * towards its edge.
 *
 * The text goes onto a small canvas and is then scaled up with
 * `image-rendering: pixelated`, which gives real blocky letters out of
 * whatever font the device already has — no webfont to download, and it looks
 * the same everywhere. Readability comes from a thick dark outline drawn
 * around the letters rather than from a panel behind them: nothing of the
 * picture is covered, and the words are legible over snow, fog or a fish tank.
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
  /** Who is speaking. Empty for a caption, which sits along the bottom. */
  who: string;
  text: string;
  /** Bigger, shakier, for a line that is being shouted. */
  loud?: boolean;
}

/** Where the speaker's head is on screen, 0–1 across and down the picture. */
export type Anchor = (who: string) => { x: number; y: number } | null;

export interface Dialogue {
  /** Draw whatever should be on screen at this moment. */
  update: (t: number, anchor?: Anchor) => void;
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

  /** Wrap to the given width, in the small canvas's own coordinates. */
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

  /**
   * One row of text, outlined.
   *
   * The outline is eight offset copies at one canvas pixel, which is four
   * device pixels once scaled — thick enough to hold the letters apart from
   * anything behind them, and blocky in the same way they are.
   */
  function stroked(row: string, x: number, y: number, colour: string): void {
    if (!ctx) return;
    ctx.fillStyle = "rgba(4, 6, 10, 0.92)";
    for (const [dx, dy] of [
      [-1, 0],
      [1, 0],
      [0, -1],
      [0, 1],
      [-1, -1],
      [1, -1],
      [-1, 1],
      [1, 1],
    ]) {
      ctx.fillText(row, x + dx, y + dy);
    }
    ctx.fillStyle = colour;
    ctx.fillText(row, x, y);
  }

  const update = (t: number, anchor?: Anchor): void => {
    if (!ctx) return;
    ctx.clearRect(0, 0, width, height);
    const line = lines.find((l) => t >= l.at && t < l.at + l.seconds);
    if (!line) return;

    // Sized against the picture rather than fixed, so a line reads the same
    // on a phone as on a monitor.
    const base = Math.max(5, Math.min(11, Math.round(height * 0.05)));
    const size = line.loud ? Math.round(base * 1.4) : base;
    ctx.font = `bold ${size}px system-ui, sans-serif`;
    ctx.textBaseline = "top";
    ctx.textAlign = "center";

    // Typed out, then held.
    const shown = Math.min(line.text.length, Math.floor((t - line.at) * SPEED));
    const text = line.text.slice(0, shown);
    if (!text) return;

    const margin = Math.round(base * 1.2);
    const rows = wrap(text, Math.min(width - margin * 2, Math.round(width * 0.72)));
    const lineHeight = size + 2;
    const block = rows.length * lineHeight;
    const jolt = line.loud ? Math.round(Math.sin(t * 47) * 1.2) : 0;
    const colour = line.loud ? "#ffd34d" : "#f6f4ee";

    const head = line.who ? anchor?.(line.who) ?? null : null;
    const wantY = head ? Math.round(head.y * height) - block - Math.round(base * 0.8) : 0;
    // Over the head, but only where there is room over the head. In a close-up
    // the face fills the frame and "just above" lands on the hat, so the line
    // drops to the bottom of the picture instead of covering the person
    // saying it. Same for anyone standing off the edge of the shot.
    const overhead = head !== null && head.x > 0.02 && head.x < 0.98 && wantY >= margin;

    let x: number;
    let y: number;
    if (overhead && head) {
      x = Math.round(head.x * width);
      y = wantY;
      // Kept on screen: a line that runs off the edge with the person
      // speaking is worse than one that stops short of it.
      const half = Math.round(
        Math.max(...rows.map((row) => ctx.measureText(row).width)) / 2 + margin * 0.5,
      );
      x = Math.min(width - half, Math.max(half, x));
    } else {
      // A caption belongs to nobody, and a line with nowhere to go belongs
      // where it can be read.
      x = Math.round(width / 2);
      y = height - block - margin;
    }

    for (const [i, row] of rows.entries()) {
      stroked(row, x + jolt, y + i * lineHeight, colour);
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
