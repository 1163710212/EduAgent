import { animateFeedback } from "./motion.js";
export { initPageMotion } from "./motion.js";

export const byId = (id) => document.getElementById(id);

export function setLog(element, message, status = "") {
  element.textContent =
    typeof message === "string" ? message : JSON.stringify(message, null, 2);
  if (status) element.dataset.status = status;
  else delete element.dataset.status;
  if (message) animateFeedback(element);
}

export function clearElement(element) {
  element.replaceChildren();
}

export function makeIcon(name) {
  const aliases = {
    "chart-spline": "chart-line",
    "messages-square": "chats-circle",
    route: "path",
  };
  const icon = document.createElement("i");
  icon.className = `ph-duotone ph-${aliases[name] || name}`;
  icon.setAttribute("aria-hidden", "true");
  return icon;
}

export function setButtonLoading(button, isLoading, loadingLabel = "") {
  const label = button.querySelector("span");
  if (!button.dataset.defaultLabel) {
    button.dataset.defaultLabel = label?.textContent || button.textContent;
  }
  button.disabled = isLoading;
  button.setAttribute("aria-busy", String(isLoading));
  if (label)
    label.textContent = isLoading ? loadingLabel : button.dataset.defaultLabel;

  const spinner = button.querySelector(".spinner");
  const icon = button.querySelector("i[class*='ph-']");
  if (isLoading && !spinner) {
    icon?.classList.add("hidden");
    const nextSpinner = document.createElement("span");
    nextSpinner.className = "spinner";
    nextSpinner.setAttribute("aria-hidden", "true");
    button.appendChild(nextSpinner);
  } else if (!isLoading && spinner) {
    spinner.remove();
    icon?.classList.remove("hidden");
  }
}

export function showToast(message) {
  const toast = byId("toast");
  if (!toast) return;
  toast.querySelector("span").textContent = message;
  toast.classList.add("show");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(
    () => toast.classList.remove("show"),
    2600,
  );
}

export async function copyText(value, fallbackInput) {
  try {
    await navigator.clipboard.writeText(value);
  } catch (_) {
    fallbackInput?.select();
    document.execCommand("copy");
  }
}
