import { Component, type ErrorInfo, type ReactNode } from "react";
import { applog } from "@/lib/applog";
import { showBugReportDialog } from "@/lib/bugHotkey";
import { t } from "@/lib/i18n";

/**
 * Последний рубеж: ошибка рендера где-то в дереве раньше оставляла белый экран
 * (баг-репорт b3df29d5 — хуки после раннего return в RailPlayer). Теперь —
 * экран с «Перезагрузить» и «Отправить лог», а сама ошибка уже в журнале
 * (lib/applog перехватывает uncaught).
 */
type State = { error: Error | null };

export default class RootBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    applog.error(`render: ${error?.message || error}${info.componentStack ? ` @${info.componentStack.split("\n").filter(Boolean)[0]?.trim()}` : ""}`);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-background text-foreground p-6">
        <div className="max-w-sm w-full text-center">
          <p className="text-h1 mb-2">{t("Что-то сломалось")}</p>
          <p className="text-small text-subtle mb-5">{t("Ошибка уже в журнале. Перезагрузите экран, а если повторяется — отправьте лог, разберёмся.")}</p>
          <div className="flex gap-2 justify-center">
            <button type="button" onClick={() => location.reload()} className="h-10 px-4 rounded-md bg-primary text-primary-foreground font-medium">{t("Перезагрузить")}</button>
            <button type="button" onClick={() => showBugReportDialog()} className="h-10 px-4 rounded-md bg-surface-4 font-medium">{t("Отправить лог")}</button>
          </div>
        </div>
      </div>
    );
  }
}
