// Motion is optional enhancement: the interface is never hidden waiting for it.
const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
const activeAnimations = new Set();
let motionPromise;
let initialized = false;

function animator() {
  if (!motionPromise) {
    motionPromise = import("../../vendor/motion-mini.mjs")
      .then((module) => module.animate)
      .catch(() => null);
  }
  return motionPromise;
}

function finishAnimations() {
  activeAnimations.forEach((animation) => animation.complete?.());
  activeAnimations.clear();
}

preference.addEventListener?.("change", () => {
  if (preference.matches) finishAnimations();
});
window.addEventListener("pagehide", finishAnimations);

export async function revealElements(elements, options = {}) {
  const targets = Array.from(elements || []).filter(
    (element) => element?.isConnected,
  );
  if (preference.matches || !targets.length) return;
  const animate = await animator();
  if (!animate || preference.matches) return;

  const {
    duration = 0.62,
    stagger = 0.065,
    delay = 0,
    distance = 18,
  } = options;
  targets.forEach((element, index) => {
    if (!element.isConnected) return;
    try {
      const animation = animate(
        element,
        {
          opacity: [0, 1],
          transform: [`translateY(${distance}px)`, "translateY(0px)"],
        },
        { duration, delay: delay + index * stagger, ease: [0.22, 1, 0.36, 1] },
      );
      activeAnimations.add(animation);
      animation.then(() => activeAnimations.delete(animation));
    } catch (_) {
      // Unsupported animation APIs must not affect the learning workflow.
    }
  });
}

export function revealSection(element) {
  if (!element) return;
  const targets = element.querySelectorAll("[data-motion]");
  return revealElements(targets.length ? targets : [element]);
}

export function animateFeedback(element) {
  return revealElements([element], { duration: 0.24, distance: 4, stagger: 0 });
}

export function scrollToElement(element, options = {}) {
  element?.scrollIntoView({
    ...options,
    behavior: preference.matches ? "auto" : "smooth",
  });
}

export function initPageMotion() {
  if (initialized) return;
  initialized = true;
  revealElements(document.querySelectorAll("[data-page-motion]"), {
    stagger: 0.075,
  });
}
