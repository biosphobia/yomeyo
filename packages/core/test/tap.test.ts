import { describe, expect, it } from "vitest";
import { onTap, TAP_SLOP_PX } from "../src/tap.js";

/** A stand-in for a DOM element: collects listeners so tests can fire them. */
function fakeButton() {
  const listeners = new Map<string, ((ev: any) => void)[]>();
  const timers: (() => void)[] = [];
  const taps: any[] = [];

  const target = {
    addEventListener(type: string, listener: (ev: any) => void) {
      const list = listeners.get(type) ?? [];
      list.push(listener);
      listeners.set(type, list);
    },
  };

  onTap(target, (ev) => taps.push(ev), { setTimeout: (fn) => timers.push(fn) });

  const fire = (type: string, ev: any = {}) => {
    for (const listener of listeners.get(type) ?? []) listener(ev);
  };
  const touch = (x: number, y: number) => ({ changedTouches: [{ clientX: x, clientY: y }] });

  return {
    taps,
    fire,
    /**
     * A finger landing at (100,100), drifting `drift` pixels, and lifting —
     * with the full event sequence Chrome sends for a clean tap.
     */
    finger(drift = 0) {
      fire("pointerdown", { pointerId: 1, clientX: 100, clientY: 100 });
      fire("touchstart", touch(100, 100));
      fire("pointerup", { pointerId: 1, clientX: 100, clientY: 100 + drift });
      fire("touchend", touch(100, 100 + drift));
    },
    /**
     * The sequence Chrome sends when it decides the gesture might be a scroll:
     * the pointer stream is cancelled, but the touch stream completes.
     */
    fingerAfterPointerCancel(drift: number) {
      fire("pointerdown", { pointerId: 1, clientX: 100, clientY: 100 });
      fire("touchstart", touch(100, 100));
      fire("touchmove", touch(100, 100 + drift));
      fire("pointercancel", {});
      fire("touchend", touch(100, 100 + drift));
    },
    /** Run the pending grace-period timeout, as a real clock eventually would. */
    flushTimers() {
      timers.splice(0).forEach((fn) => fn());
    },
  };
}

describe("tapping a button with a finger", () => {
  it("fires on a still tap", () => {
    const btn = fakeButton();
    btn.finger(0);
    expect(btn.taps).toHaveLength(1);
  });

  it("still fires when the finger drifts a little, as fingers do", () => {
    const btn = fakeButton();
    btn.finger(TAP_SLOP_PX - 4);
    expect(btn.taps).toHaveLength(1);
  });

  it("fires even when the browser cancels the pointer, guessing at a scroll", () => {
    // This is the case that made the Save button feel dead: Chrome sends
    // pointercancel and no click, but the finger did lift on the button.
    const btn = fakeButton();
    btn.fingerAfterPointerCancel(TAP_SLOP_PX - 4);
    expect(btn.taps).toHaveLength(1);
  });

  it("does not fire for a real scroll, which travels far", () => {
    const btn = fakeButton();
    btn.fingerAfterPointerCancel(180);
    expect(btn.taps).toHaveLength(0);
  });

  it("does not fire for a drag", () => {
    const btn = fakeButton();
    btn.finger(TAP_SLOP_PX + 20);
    expect(btn.taps).toHaveLength(0);
  });

  it("fires once per tap, not once per event the browser sends", () => {
    const btn = fakeButton();
    btn.finger(2);
    btn.fire("click", {});
    expect(btn.taps).toHaveLength(1);
  });

  it("accepts the next tap after one has been handled", () => {
    const btn = fakeButton();
    btn.finger(2);
    btn.fire("click", {});
    btn.finger(2);
    expect(btn.taps).toHaveLength(2);
  });

  it("does not swallow a later click when no click followed the tap", () => {
    const btn = fakeButton();
    btn.finger(2);
    btn.flushTimers(); // the grace period expires with no compatibility click
    btn.fire("click", {});
    expect(btn.taps).toHaveLength(2);
  });

  it("ignores a press the system takes away, such as an incoming call", () => {
    const btn = fakeButton();
    btn.fire("touchstart", { changedTouches: [{ clientX: 100, clientY: 100 }] });
    btn.fire("touchcancel", {});
    btn.fire("touchend", { changedTouches: [{ clientX: 100, clientY: 100 }] });
    expect(btn.taps).toHaveLength(0);
  });
});

describe("tapping without a touch screen", () => {
  it("works for a plain mouse click", () => {
    const btn = fakeButton();
    btn.fire("pointerdown", { pointerId: 1, clientX: 10, clientY: 10, button: 0 });
    btn.fire("pointerup", { pointerId: 1, clientX: 10, clientY: 10, button: 0 });
    expect(btn.taps).toHaveLength(1);
  });

  it("ignores a right-click", () => {
    const btn = fakeButton();
    btn.fire("pointerdown", { pointerId: 1, clientX: 10, clientY: 10, button: 2 });
    btn.fire("pointerup", { pointerId: 1, clientX: 10, clientY: 10, button: 2 });
    expect(btn.taps).toHaveLength(0);
  });

  it("works for keyboard activation, which sends a click and no gesture", () => {
    const btn = fakeButton();
    btn.fire("click", {});
    expect(btn.taps).toHaveLength(1);
  });
});
