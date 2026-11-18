import type { EntityType } from "./format";

// В пуле одновременно живут несколько ChatWindow. Нативная команда должна
// попасть в поле с фокусом, а не в последний смонтированный (часто скрытый) чат.
type Compose = {
  field: () => HTMLTextAreaElement | null;
  enabled: () => boolean;
  apply: (type: EntityType) => void;
  selection: (selected: boolean, native: boolean) => void;
};
type NativeSelection = { postMessage: (selected: number) => void };
type FormatWindow = Window & {
  __hyaxFormat?: (type: string) => void;
  webkit?: { messageHandlers?: { hyaxComposeSel?: NativeSelection } };
};
const composers = new Set<Compose>();
const types = new Set<string>(["bold", "italic", "underline", "strike", "code", "pre", "spoiler", "zalgo", "scramble"]);
let lastNative: NativeSelection | undefined;
let lastSelected: boolean | undefined;

function focusedCompose() {
  return [...composers].find((c) => c.enabled() && c.field() === document.activeElement);
}

function syncSelection() {
  const owner = focusedCompose();
  const field = owner?.field();
  const selected = !!field && field.selectionStart !== field.selectionEnd;
  const native = (window as FormatWindow).webkit?.messageHandlers?.hyaxComposeSel;
  for (const c of composers) c.selection(c === owner && selected, !!native);
  if (native && (native !== lastNative || selected !== lastSelected)) {
    try { native.postMessage(selected ? 1 : 0); } catch { /* мост недоступен */ }
  }
  lastNative = native;
  lastSelected = selected;
}

function dispatchFormat(type: string) {
  if (!types.has(type)) return;
  focusedCompose()?.apply(type as EntityType);
}

export function registerComposeFormatBridge(compose: Compose) {
  const w = window as FormatWindow;
  if (!composers.size) {
    w.__hyaxFormat = dispatchFormat;
    document.addEventListener("selectionchange", syncSelection);
    document.addEventListener("focusin", syncSelection);
    document.addEventListener("focusout", syncSelection);
  }
  composers.add(compose);
  syncSelection();
  return () => {
    composers.delete(compose);
    syncSelection();
    if (!composers.size) {
      if (w.__hyaxFormat === dispatchFormat) delete w.__hyaxFormat;
      document.removeEventListener("selectionchange", syncSelection);
      document.removeEventListener("focusin", syncSelection);
      document.removeEventListener("focusout", syncSelection);
      lastNative = undefined;
      lastSelected = undefined;
    }
  };
}
