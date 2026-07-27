/**
 * Brief confirmation messages.
 *
 * Every action that changes something says so. A button that silently
 * succeeds is indistinguishable from one that is broken — which is exactly
 * how a working Save can look like a dead one.
 */

let active: HTMLElement | null = null;
let timers: number[] = [];

export function toast(message: string, kind: "ok" | "error" = "ok"): void {
  for (const timer of timers) clearTimeout(timer);
  timers = [];
  active?.remove();

  const el = document.createElement("div");
  el.className = kind === "error" ? "toast toast-error" : "toast";
  el.setAttribute("role", "status");
  el.textContent = message;
  document.body.appendChild(el);
  active = el;

  timers.push(
    window.setTimeout(() => el.classList.add("out"), 2600),
    window.setTimeout(() => {
      el.remove();
      if (active === el) active = null;
    }, 3100),
  );
}
