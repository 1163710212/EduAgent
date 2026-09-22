// Optional background-only handoff; business state is saved before navigation.
const storageKey = "eduagent.scene-handoff";
const preference = matchMedia("(prefers-reduced-motion: reduce)");
const allowed = new Map([["create", "solve"], ["solve", "review"]]);
const currentStep = () => location.pathname.replace(/\/$/, "").split("/").pop();
const layer = document.getElementById("ambientBackground");
const controls = new Set();

function readHandoff() {
  try {
    const raw = sessionStorage.getItem(storageKey);
    sessionStorage.removeItem(storageKey);
    const marker = JSON.parse(raw || "null");
    const age = Date.now()-marker?.createdAt;
    return allowed.get(marker?.from) === marker?.to &&
      marker.to === currentStep() &&
      marker.sessionId === new URL(location.href).searchParams.get("session_id") &&
      Number.isFinite(age) && age >= 0 && age < 10000 ? marker : null;
  } catch (_) { return null; }
}
function settle() {
  controls.forEach(control => control.cancel());
  controls.clear();
}
async function play(keyframes,duration) {
  if (!layer?.animate || preference.matches || document.hidden) return;
  let timer, control;
  try {
    control = layer.animate(keyframes,{duration,easing:"cubic-bezier(.22,1,.36,1)",fill:"both"});
    controls.add(control);
    await Promise.race([
      control.finished.catch(() => {}),
      new Promise(resolve => { timer=setTimeout(resolve,duration+60); }),
    ]);
  } catch (_) { /* Visual failures must never block navigation. */ }
  finally { clearTimeout(timer); control?.cancel(); controls.delete(control); }
}
export async function transitionToNextStep(url) {
  const target = new URL(url,location.href);
  const from = currentStep();
  const to = target.pathname.replace(/\/$/, "").split("/").pop();
  if(target.origin === location.origin && allowed.get(from) === to) {
    if(!preference.matches && !document.hidden) {
      try {
        sessionStorage.setItem(storageKey,JSON.stringify({
          from,to,sessionId:target.searchParams.get("session_id"),createdAt:Date.now(),
        }));
      } catch (_) { /* Continuity marker is optional. */ }
      await play([
        {opacity:1,transform:"translateX(0) scale(1)"},
        {opacity:.65,transform:"translateX(-12px) scale(1.015)"},
      ],180);
    }
  }
  window.location.replace(target.href);
}
async function enterScene() {
  if(readHandoff()) await play([
    {opacity:.65,transform:"translateX(12px) scale(1.015)"},
    {opacity:1,transform:"translateX(0) scale(1)"},
  ],260);
  document.dispatchEvent(new CustomEvent("eduagent:scene-settled"));
}
document.addEventListener("visibilitychange",() => { if(document.hidden) settle(); });
preference.addEventListener("change",() => { if(preference.matches) settle(); });
window.addEventListener("pagehide",settle);
enterScene();
