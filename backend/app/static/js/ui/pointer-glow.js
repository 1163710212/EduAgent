// Delegated events also cover feedback cards rendered after API responses.
const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
const pointer = window.matchMedia("(hover: hover) and (pointer: fine)");
let active;
let frame;
let position;

function mount(card) {
  if (!card.querySelector(":scope > .pointer-glow-rim")) {
    const rim = document.createElement("span");
    rim.className = "pointer-glow-rim";
    rim.setAttribute("aria-hidden", "true");
    card.appendChild(rim);
  }
}

function reset() {
  if (frame !== undefined) cancelAnimationFrame(frame);
  frame = undefined;
  if (active) delete active.dataset.glowActive;
  active = undefined;
}

document.querySelectorAll("[data-pointer-glow]").forEach(mount);
document.addEventListener("pointermove", (event) => {
  if (!pointer.matches || preference.matches || event.pointerType === "touch")
    return;
  const card = event.target.closest?.("[data-pointer-glow]");
  if (card !== active) {
    reset();
    active = card;
    if (active) mount(active);
  }
  if (!active) return;
  position = { x: event.clientX, y: event.clientY };
  if (frame !== undefined) return;
  frame = requestAnimationFrame(() => {
    frame = undefined;
    if (!active?.isConnected) return reset();
    const bounds = active.getBoundingClientRect();
    active.style.setProperty(
      "--glow-x",
      `${Math.max(0, Math.min(bounds.width, position.x - bounds.left))}px`,
    );
    active.style.setProperty(
      "--glow-y",
      `${Math.max(0, Math.min(bounds.height, position.y - bounds.top))}px`,
    );
    active.dataset.glowActive = "true";
  });
});
document.addEventListener("pointerout", (event) => {
  if (active && !active.contains(event.relatedTarget)) reset();
});
document.addEventListener("pointerdown", (event) => {
  if (event.pointerType === "touch") reset();
});
document.addEventListener("focusin", (event) => {
  const card = event.target.closest?.("[data-pointer-glow]");
  if (!card) return;
  mount(card);
  card.dataset.glowFocus = "true";
});
document.addEventListener("focusout", (event) => {
  const card = event.target.closest?.("[data-pointer-glow]");
  if (card && !card.contains(event.relatedTarget))
    delete card.dataset.glowFocus;
});
preference.addEventListener?.("change", reset);
pointer.addEventListener?.("change", reset);
document.addEventListener("visibilitychange", () => {
  if (document.hidden) reset();
});
window.addEventListener("pagehide", reset);
