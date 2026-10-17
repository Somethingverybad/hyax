/**
 * Недостающее в старых WebView — подключается первым (main.tsx), до всего
 * остального кода.
 *
 * Huawei без сервисов Google живут на своём WebView (com.huawei.webview), и
 * он отстаёт от Chrome: на Honor DNN-LX9 (Android 10) это Chromium 92, а на
 * iPhone с iOS 15 — Safari 15. AbortSignal.timeout там нет (Chrome 103,
 * Safari 16), а проба CDN в api/client.ts вызывала его при загрузке модуля:
 * ошибка роняла весь бандл, и после заставки оставался белый экран.
 */

if (typeof AbortSignal !== "undefined" && typeof (AbortSignal as any).timeout !== "function") {
  (AbortSignal as any).timeout = (ms: number): AbortSignal => {
    const c = new AbortController();
    setTimeout(() => c.abort(typeof DOMException === "function" ? new DOMException("signal timed out", "TimeoutError") : undefined), ms);
    return c.signal;
  };
}

// Chrome 93 / Safari 15.4.
if (typeof (Object as any).hasOwn !== "function") {
  (Object as any).hasOwn = (o: object, k: PropertyKey) => Object.prototype.hasOwnProperty.call(o, k);
}

// Chrome 97 / Safari 15.4.
for (const [name, impl] of [
  ["findLast", function (this: unknown[], f: (v: unknown, i: number, a: unknown[]) => unknown) { for (let i = this.length - 1; i >= 0; i--) if (f(this[i], i, this)) return this[i]; return undefined; }],
  ["findLastIndex", function (this: unknown[], f: (v: unknown, i: number, a: unknown[]) => unknown) { for (let i = this.length - 1; i >= 0; i--) if (f(this[i], i, this)) return i; return -1; }],
] as const) {
  if (typeof (Array.prototype as any)[name] !== "function") {
    Object.defineProperty(Array.prototype, name, { value: impl, writable: true, configurable: true });
  }
}

export {};
