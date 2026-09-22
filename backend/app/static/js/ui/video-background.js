// Create-only presentation. It never reads or writes workflow/business state.
const layer = document.getElementById("ambientBackground");
const video = document.getElementById("createBackgroundVideo");
const backdrop = document.getElementById("createBackgroundVideoBackdrop");
const preference = matchMedia("(prefers-reduced-motion: reduce)");
const finePointer = matchMedia("(hover: hover) and (pointer: fine)");
const wideComposition = matchMedia("(min-aspect-ratio: 3/2)");

if (layer && video) {
  let visible = true;
  let suspended = false;
  let failed = false;
  let pointerFrame;

  const canAnimate = () =>
    !failed && !suspended && visible && !document.hidden && !preference.matches;

  function publishState(state) {
    layer.dataset.state = state;
    document.dispatchEvent(new CustomEvent("eduagent:ambient-state"));
  }

  function pauseVideos() {
    video.pause();
    backdrop?.pause();
  }

  function alignBackdrop() {
    if (!backdrop || !wideComposition.matches || video.readyState < 2) return;
    if (Math.abs(backdrop.currentTime - video.currentTime) > 0.16)
      backdrop.currentTime = video.currentTime;
  }

  async function synchronize() {
    if (failed) {
      pauseVideos();
      layer.dataset.renderer = "fallback";
      publishState("static");
      return;
    }
    if (!canAnimate()) {
      pauseVideos();
      if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA)
        layer.dataset.renderer = "video";
      publishState("static");
      return;
    }
    try {
      await video.play();
      if (backdrop && wideComposition.matches) {
        alignBackdrop();
        backdrop.play().catch(() => {
          layer.dataset.backdrop = "unavailable";
        });
      } else backdrop?.pause();
      layer.dataset.renderer = "video";
      publishState("running");
    } catch (_) {
      // Autoplay/network failure leaves the current scene's neutral dark surface.
      layer.dataset.renderer = "fallback";
      publishState("static");
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

  function resetPointer() {
    layer.style.setProperty("--video-shift-x", "0px");
    layer.style.setProperty("--video-shift-y", "0px");
  }

  document.addEventListener(
    "pointermove",
    (event) => {
      if (
        event.pointerType !== "mouse" ||
        !finePointer.matches ||
        preference.matches ||
        failed
      )
        return;
      if (pointerFrame !== undefined) cancelAnimationFrame(pointerFrame);
      pointerFrame = requestAnimationFrame(() => {
        pointerFrame = undefined;
        const x = (event.clientX / Math.max(1, innerWidth) - 0.5) * -12;
        const y = (event.clientY / Math.max(1, innerHeight) - 0.5) * -8;
        layer.style.setProperty("--video-shift-x", `${x.toFixed(2)}px`);
        layer.style.setProperty("--video-shift-y", `${y.toFixed(2)}px`);
      });
    },
    { passive: true },
  );
  document.addEventListener("mouseleave", resetPointer);
  video.addEventListener("loadeddata", markReady);
  video.addEventListener("canplay", markReady);
  video.addEventListener("play", alignBackdrop);
  video.addEventListener("seeking", alignBackdrop);
  video.addEventListener("timeupdate", alignBackdrop);
  video.addEventListener("error", markUnavailable);
  backdrop?.addEventListener("error", () => {
    layer.dataset.backdrop = "unavailable";
  });
  document.addEventListener("visibilitychange", synchronize);
  preference.addEventListener("change", () => {
    if (preference.matches) resetPointer();
    synchronize();
  });
  finePointer.addEventListener("change", () => {
    if (!finePointer.matches) resetPointer();
  });
  wideComposition.addEventListener("change", synchronize);
  window.addEventListener("pagehide", () => {
    suspended = true;
    synchronize();
  });
  window.addEventListener("pageshow", () => {
    suspended = false;
    synchronize();
  });
  if ("IntersectionObserver" in window)
    new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      synchronize();
    }).observe(layer);

  if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) markReady();
  else synchronize();
}
