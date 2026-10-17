import { useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Capacitor } from "@capacitor/core";
import { App as CapApp } from "@capacitor/app";
import { ESC_BACK, runEscapeStack } from "@/lib/escape";
import { isMiniAppOpen } from "@/lib/miniapp";

/** Экраны, дальше которых Esc не уводит: список чатов («Выберите чат» на
 *  широком окне) и всё, что до входа. */
const FLOOR = new Set(["/", "/chat", "/auth", "/onboarding"]);
const signedIn = () => { try { return !!localStorage.getItem("access_token"); } catch { return false; } };
const historyIdx = () => (window.history.state as { idx?: number } | null)?.idx ?? 0;
/** С какой записи истории началась эта загрузка страницы. Раньше неё — записи
 *  прошлой загрузки: шаг туда грузит приложение заново (экран запуска). */
const START_IDX = historyIdx();

/**
 * Глобальный «назад»: Esc на компьютере и системная кнопка «Назад» на Android.
 * Порядок: открытые окна и шторки (lib/escape) → экран (ESC_BACK: открытый
 * чат закрывается) → шаг назад по экранам приложения → к списку чатов. На
 * Android с последнего экрана — свернуть приложение.
 */
export default function EscapeKey() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const pathRef = useRef(pathname);
  pathRef.current = pathname;

  useEffect(() => {
    /** Один шаг назад; false — отступать некуда. */
    const step = (): boolean => {
      if (runEscapeStack()) return true;
      const back = new CustomEvent(ESC_BACK, { cancelable: true });
      window.dispatchEvent(back);
      if (back.defaultPrevented) return true;
      if (FLOOR.has(pathRef.current)) return false;
      // Шаг назад — если до этого экрана был другой экран приложения (в этой
      // же загрузке); открыли сразу по ссылке — к списку чатов.
      if (historyIdx() > START_IDX) navigate(-1);
      else if (signedIn()) navigate("/chat", { replace: true });
      else return false;
      return true;
    };

    let synthetic = false;
    const onKey = (e: KeyboardEvent) => {
      if (synthetic || e.key !== "Escape" || e.isComposing || e.repeat) return;
      // Ждём, пока событие обойдут все: диалоги Radix, подтверждение,
      // просмотрщик фото закрываются по Esc сами и ставят defaultPrevented.
      window.setTimeout(() => {
        if (e.defaultPrevented) return;
        const el = document.activeElement as HTMLElement | null;
        if (el && el !== document.body && el.matches("input, textarea, select, [contenteditable]:not([contenteditable='false'])")) {
          el.blur();
          return;
        }
        step();
      }, 0);
    };
    window.addEventListener("keydown", onKey);

    // Android: без своего обработчика Capacitor вёл WebView назад по истории —
    // мимо экранов приложения, в прошлую загрузку страницы (экран запуска
    // посреди работы). Отдельный обработчик был только у экрана чатов.
    let handle: { remove: () => void } | undefined;
    let disposed = false;
    if (Capacitor.getPlatform() === "android") {
      CapApp.addListener("backButton", () => {
        // Мини-приложение отвечает на «назад» само (MiniAppHost).
        if (isMiniAppOpen()) return;
        // Диалоги Radix закрываются по Esc — даём им его, не трогая свой обработчик.
        const esc = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
        synthetic = true;
        try { (document.activeElement || document.body).dispatchEvent(esc); } finally { synthetic = false; }
        if (esc.defaultPrevented) return;
        (document.activeElement as HTMLElement | null)?.blur?.();
        if (!step()) void CapApp.minimizeApp();
      }).then((h) => { if (disposed) h.remove(); else handle = h; });
    }
    return () => { disposed = true; window.removeEventListener("keydown", onKey); handle?.remove(); };
  }, [navigate]);

  return null;
}
