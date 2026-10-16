const layer = document.getElementById("ambientBackground");
const video = document.getElementById("reviewBackgroundVideo");
const motionPreference = window.matchMedia("(prefers-reduced-motion: reduce)");

if (layer && video) {
  let visible = true;
  let suspended = false;
  let failed = false;

  function publish(state) {
    layer.dataset.state = state;
    document.dispatchEvent(
      new CustomEvent("eduagent:ambient-state", { detail: { state } }),
    );
  }

  function canPlay() {
    return (
      !failed &&
      !suspended &&
      visible &&
      !document.hidden &&
      !motionPreference.matches
    );
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
      if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
        layer.dataset.renderer = "video";
      }
      publish("static");
      return;
    }

    try {
      await video.play();
      layer.dataset.renderer = "video";
      publish("running");
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

  video.addEventListener("loadeddata", markReady);
  video.addEventListener("canplay", markReady);
  video.addEventListener("error", markUnavailable);
  video.querySelectorAll("source").forEach((source) => {
    source.addEventListener("error", markUnavailable);
  });
  document.addEventListener("visibilitychange", synchronize);
  motionPreference.addEventListener("change", synchronize);
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
