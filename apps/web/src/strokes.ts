/**
 * Animated stroke order, drawn from KanjiVG path data.
 *
 * Each stroke is drawn by animating a dash offset along its own path, in
 * order, so you see the brush move the way you would write it — which is the
 * part a static diagram with numbered arrows never quite conveys. A faint
 * outline of the finished character sits underneath for reference.
 */

/** KanjiVG draws every character in a 109×109 box. */
const VIEW_BOX = "0 0 109 109";
const SVG_NS = "http://www.w3.org/2000/svg";

export interface StrokeOrderOptions {
  /** Pixel size of the square. */
  size?: number;
  /** Milliseconds per stroke, scaled a little by stroke length. */
  strokeMs?: number;
  /** Show the stroke number beside each stroke as it is drawn. */
  numbers?: boolean;
}

export interface StrokeOrderHandle {
  element: SVGSVGElement;
  /** Draw from the beginning. */
  play(): void;
  /** Show the finished character with no animation. */
  showComplete(): void;
}

function el<K extends keyof SVGElementTagNameMap>(name: K): SVGElementTagNameMap[K] {
  return document.createElementNS(SVG_NS, name);
}

export function strokeOrder(paths: string[], options: StrokeOrderOptions = {}): StrokeOrderHandle {
  const size = options.size ?? 180;
  const perStroke = options.strokeMs ?? 420;

  const svg = el("svg");
  svg.setAttribute("viewBox", VIEW_BOX);
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.classList.add("stroke-order");

  // Guide lines, as on squared practice paper.
  const guides = el("g");
  guides.classList.add("guides");
  for (const [x1, y1, x2, y2] of [
    [54.5, 0, 54.5, 109],
    [0, 54.5, 109, 54.5],
  ]) {
    const line = el("line");
    line.setAttribute("x1", String(x1));
    line.setAttribute("y1", String(y1));
    line.setAttribute("x2", String(x2));
    line.setAttribute("y2", String(y2));
    guides.appendChild(line);
  }
  svg.appendChild(guides);

  // The completed character, faint, so the target shape is always visible.
  const ghost = el("g");
  ghost.classList.add("ghost");
  for (const d of paths) {
    const path = el("path");
    path.setAttribute("d", d);
    ghost.appendChild(path);
  }
  svg.appendChild(ghost);

  const drawn = el("g");
  drawn.classList.add("drawn");
  const strokeEls: SVGPathElement[] = paths.map((d) => {
    const path = el("path");
    path.setAttribute("d", d);
    drawn.appendChild(path);
    return path;
  });
  svg.appendChild(drawn);

  const labels = el("g");
  labels.classList.add("stroke-numbers");
  svg.appendChild(labels);

  let animations: Animation[] = [];

  function reset(): void {
    for (const animation of animations) animation.cancel();
    animations = [];
    labels.replaceChildren();
  }

  function showComplete(): void {
    reset();
    for (const path of strokeEls) {
      path.style.strokeDasharray = "none";
      path.style.strokeDashoffset = "0";
      path.style.opacity = "1";
    }
  }

  function play(): void {
    reset();
    let delay = 0;

    strokeEls.forEach((path, index) => {
      // getTotalLength needs the element laid out; callers append first.
      let length = 0;
      try {
        length = path.getTotalLength();
      } catch {
        length = 100;
      }
      const duration = Math.max(180, Math.min(900, perStroke * (length / 60)));

      path.style.strokeDasharray = `${length}`;
      path.style.strokeDashoffset = `${length}`;
      path.style.opacity = "1";

      if (typeof path.animate === "function") {
        animations.push(
          path.animate([{ strokeDashoffset: length }, { strokeDashoffset: 0 }], {
            duration,
            delay,
            fill: "forwards",
            easing: "ease-in-out",
          }),
        );
      } else {
        // Without the Web Animations API, fall back to simply showing it.
        path.style.strokeDashoffset = "0";
      }

      if (options.numbers) {
        window.setTimeout(() => {
          try {
            const start = path.getPointAtLength(0);
            const text = el("text");
            text.setAttribute("x", String(start.x));
            text.setAttribute("y", String(start.y));
            text.textContent = String(index + 1);
            labels.appendChild(text);
          } catch {
            /* numbering is decoration */
          }
        }, delay);
      }

      delay += duration + 90;
    });
  }

  return { element: svg, play, showComplete };
}
