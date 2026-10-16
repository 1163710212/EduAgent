// Solve-only presentation. Challenge, draft and submission state stay independent.
const layer = document.getElementById("ambientBackground");
const video = document.getElementById("solveBackgroundVideo");
const preference = matchMedia("(prefers-reduced-motion: reduce)");
const finePointer = matchMedia("(hover: hover) and (pointer: fine)");

if (layer && video) {
  let visible = true;
  let suspended = false;
  let failed = false;
  let pointerFrame;

  const focused = () => layer.dataset.attention === "focused";
  const canPlay = () =>
    !failed && !suspended && visible && !document.hidden && !preference.matches;

  function publish(state) {
    layer.dataset.state = state;
    document.dispatchEvent(
      new CustomEvent("eduagent:ambient-state", { detail: { state } }),
    );
  }

  function resetPointer() {
    layer.style.setProperty("--solve-shift-x", "0px");
    layer.style.setProperty("--solve-shift-y", "0px");
  }

  async function synchronize() {
    if (failed) {
      video.pause();
      layer.dataset.renderer = "fallback";
      publish("static");
      return;
    }
    if (!canPlay()) {
      video.pause();
      if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA)
        layer.dataset.renderer = "video";
      publish("static");
      return;
    }

    video.playbackRate = focused() ? 0.45 : 1;
    if (focused()) resetPointer();
    try {
      await video.play();
      layer.dataset.renderer = "video";
      publish(focused() ? "calm" : "running");
    } catch (_) {
      layer.dataset.renderer = "fallback";
      publish("static");
    }
  }

  function markReady() {
    if (failed) return;
    layer.dataset.renderer = "video";
    synchronize();
  }

  function markUnavailable() {
    failed = true;
    synchronize();
  }

  document.addEventListener(
    "pointermove",
    (event) => {
      if (
        event.pointerType !== "mouse" ||
        !finePointer.matches ||
        preference.matches ||
        focused() ||
        failed
      )
        return;
      if (pointerFrame !== undefined) cancelAnimationFrame(pointerFrame);
      pointerFrame = requestAnimationFrame(() => {
        pointerFrame = undefined;
        const x = (event.clientX / Math.max(1, innerWidth) - 0.5) * -10;
        const y = (event.clientY / Math.max(1, innerHeight) - 0.5) * -6;
        layer.style.setProperty("--solve-shift-x", `${x.toFixed(2)}px`);
        layer.style.setProperty("--solve-shift-y", `${y.toFixed(2)}px`);
      });
    },
    { passive: true },
  );
  document.addEventListener("mouseleave", resetPointer);
  document.addEventListener("eduagent:learning-focus", synchronize);
  video.addEventListener("loadeddata", markReady);
  video.addEventListener("canplay", markReady);
  video.addEventListener("error", markUnavailable);
  video.querySelectorAll("source").forEach((source) => {
    source.addEventListener("error", markUnavailable);
  });
  document.addEventListener("visibilitychange", synchronize);
  preference.addEventListener("change", () => {
    if (preference.matches) resetPointer();
    synchronize();
  });
  finePointer.addEventListener("change", () => {
    if (!finePointer.matches) resetPointer();
  });
  window.addEventListener("pagehide", () => {
    suspended = true;
    synchronize();
  });
  window.addEventListener("pageshow", () => {
    suspended = false;
    synchronize();
  });
  if ("IntersectionObserver" in window) {
    new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      synchronize();
    }).observe(layer);
  }

  if (video.error || video.networkState === HTMLMediaElement.NETWORK_NO_SOURCE) markUnavailable();
  else if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) markReady();
  else synchronize();
}
