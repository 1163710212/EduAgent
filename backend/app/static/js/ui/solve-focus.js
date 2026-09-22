// Attention is decorative UI state only; answer values and draft storage are untouched.
const inputs = [...document.querySelectorAll("#explanation, #completionCode")];
const background = document.getElementById("ambientBackground");
let focused = false;
let suspended = false;

function synchronize() {
  const selected =
    !suspended && inputs.includes(document.activeElement)
      ? document.activeElement
      : null;
  inputs.forEach((input) => {
    const area = input.closest(".answer-area");
    if (area) area.dataset.learningFocus = String(input === selected);
  });
  const next = Boolean(selected);
  if (background) background.dataset.attention = next ? "focused" : "normal";
  if (next === focused) return;
  focused = next;
  document.dispatchEvent(new CustomEvent("eduagent:learning-focus"));
}

document.addEventListener("focusin", synchronize);
document.addEventListener("focusout", () => queueMicrotask(synchronize));
window.addEventListener("pagehide", () => {
  suspended = true;
  synchronize();
});
window.addEventListener("pageshow", () => {
  suspended = false;
  synchronize();
});
synchronize();
