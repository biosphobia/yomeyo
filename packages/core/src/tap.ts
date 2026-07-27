/**
 * Making a button reliably tappable on a phone.
 *
 * A `click` listener is not enough on touch screens. A finger is not a point:
 * it lands with a contact patch and drifts a few pixels before it lifts. Once
 * that drift passes the browser's touch slop — and inside a scrollable panel
 * that threshold is small — Chrome decides the gesture was a scroll rather
 * than a tap. It then cancels the pointer sequence and never dispatches
 * `click` at all, so the button looks dead even though it was pressed
 * squarely.
 *
 * Touch events survive that: `touchend` is delivered whatever the browser
 * decided the gesture meant. `onTap` therefore accepts a press if the finger
 * lifts near where it landed, and falls back to `click` for mice, keyboards
 * and assistive technology.
 */

/** How far a finger may drift and still count as a tap, in CSS pixels. */
export const TAP_SLOP_PX = 24;

/** The parts of an EventTarget this needs; keeps the module DOM-free. */
export interface TapTarget {
  addEventListener(type: string, listener: (ev: any) => void, options?: any): void;
}

export interface TapOptions {
  slop?: number;
  /**
   * How long to ignore a `click` that follows a tap already handled here.
   * Browsers emit the compatibility click a moment after the gesture ends.
   */
  clickGraceMs?: number;
  /** Injected so tests do not depend on real timers. */
  setTimeout?: (fn: () => void, ms: number) => unknown;
}

interface Point {
  x: number;
  y: number;
}

/** Where a pointer or touch event happened, whichever kind it is. */
function pointOf(ev: any): Point | null {
  const touch = ev?.changedTouches?.[0] ?? ev?.touches?.[0];
  if (touch) return { x: touch.clientX, y: touch.clientY };
  if (typeof ev?.clientX === "number") return { x: ev.clientX, y: ev.clientY };
  return null;
}

/**
 * Call `handler` once per tap, press or activation of `target`.
 *
 * Safe on elements that are also `disabled`: browsers do not dispatch pointer
 * or touch events to disabled form controls, so a disabled button stays inert.
 */
export function onTap(target: TapTarget, handler: (ev: any) => void, options: TapOptions = {}): void {
  const slop = options.slop ?? TAP_SLOP_PX;
  const graceMs = options.clickGraceMs ?? 500;
  const timer = options.setTimeout ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));

  /** Where the current press started, or null if no press is in progress. */
  let from: Point | null = null;
  /** True once this gesture has fired the handler, so it fires only once. */
  let done = false;
  /** Set briefly after a gesture so its compatibility click is ignored. */
  let justHandled = false;

  const begin = (ev: any): void => {
    // Ignore secondary mouse buttons; a right-click is not an activation.
    if (typeof ev?.button === "number" && ev.button > 0) {
      from = null;
      return;
    }
    from = pointOf(ev);
    done = false;
  };

  const end = (ev: any): void => {
    const start = from;
    from = null;
    if (!start || done) return;
    const at = pointOf(ev);
    if (!at) return;
    const dx = at.x - start.x;
    const dy = at.y - start.y;
    if (Math.sqrt(dx * dx + dy * dy) > slop) return; // a drag, not a tap
    done = true;
    justHandled = true;
    timer(() => {
      justHandled = false;
    }, graceMs);
    handler(ev);
  };

  target.addEventListener("pointerdown", begin);
  target.addEventListener("touchstart", begin);
  // No pointercancel handler: Chrome cancels the pointer sequence the moment
  // it suspects a scroll, but the finger may still lift on the button, and
  // `touchend` will say so. Drift is judged by distance, not by the browser's
  // guess at intent.
  target.addEventListener("touchcancel", () => {
    from = null;
  });
  target.addEventListener("pointerup", end);
  target.addEventListener("touchend", end);

  // Mice, keyboards (Enter/Space on a focused button) and screen readers all
  // arrive here with no preceding gesture.
  target.addEventListener("click", (ev: unknown) => {
    if (justHandled) {
      justHandled = false;
      return;
    }
    handler(ev);
  });
}
