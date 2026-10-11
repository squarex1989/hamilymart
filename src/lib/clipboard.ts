/** Copy from a user gesture, including browsers without the Clipboard API. */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== "undefined" && typeof navigator.clipboard?.writeText === "function") {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Permissions or an insecure context can block the modern API.
  }

  if (typeof document === "undefined") return false;
  const previousFocus = document.activeElement;
  const dialogSelector = 'dialog[open], [role="dialog"][aria-modal="true"]';
  const container = previousFocus?.closest(dialogSelector)
    ?? Array.from(document.querySelectorAll(dialogSelector)).at(-1)
    ?? document.body;
  if (!container) return false;

  const field = document.createElement("textarea");
  field.value = text;
  field.readOnly = true;
  field.tabIndex = -1;
  // Keep it selectable on mobile without moving the page or opening a keyboard.
  field.style.cssText = "position:fixed;top:0;left:0;width:1px;height:1px;padding:0;border:0;opacity:0;font-size:16px;pointer-events:none;-webkit-user-select:text;user-select:text;";
  try {
    // A focus trap must be able to keep focus inside its own dialog.
    container.appendChild(field);
    field.focus({ preventScroll: true });
    field.select();
    field.setSelectionRange(0, field.value.length);
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    field.remove();
    if (previousFocus instanceof HTMLElement && previousFocus.isConnected) {
      try {
        previousFocus.focus({ preventScroll: true });
      } catch {
        // A concurrent UI update may make the former control unfocusable.
      }
    }
  }
}
