import { useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { ESC_BACK, runEscapeStack } from "@/lib/escape";

/** Экраны, дальше которых Esc не уводит: список чатов («Выберите чат» на
 *  широком окне) и всё, что до входа. */
const FLOOR = new Set(["/", "/chat", "/auth", "/onboarding"]);
const signedIn = () => { try { return !!localStorage.getItem("access_token"); } catch { return false; } };

/** Глобальный обработчик Esc — порядок действий описан в lib/escape. */
export default function EscapeKey() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const pathRef = useRef(pathname);
  pathRef.current = pathname;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.isComposing || e.repeat) return;
      // Ждём, пока событие обойдут все: диалоги Radix, подтверждение,
      // просмотрщик фото закрываются по Esc сами и ставят defaultPrevented.
      window.setTimeout(() => {
        if (e.defaultPrevented) return;
        const el = document.activeElement as HTMLElement | null;
        if (el && el !== document.body && el.matches("input, textarea, select, [contenteditable]:not([contenteditable='false'])")) {
          el.blur();
          return;
        }
        if (runEscapeStack()) return;
        const back = new CustomEvent(ESC_BACK, { cancelable: true });
        window.dispatchEvent(back);
        if (back.defaultPrevented || FLOOR.has(pathRef.current)) return;
        // Шаг назад — если до этого экрана был другой экран приложения;
        // открыли сразу по ссылке — к списку чатов (без входа — никуда).
        const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
        if (idx > 0) navigate(-1);
        else if (signedIn()) navigate("/chat", { replace: true });
      }, 0);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navigate]);

  return null;
}
