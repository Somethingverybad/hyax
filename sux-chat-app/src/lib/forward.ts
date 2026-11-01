import { toast } from "sonner";
import { api } from "@/api/client";
import { t } from "@/lib/i18n";

/** Куда пересылаем — строка шторки «Отправить в чат» (components/ShareToChat). */
export type ShareTarget = { id: string; title: string; kind: "saved" | "group" | "direct" | "channel" | "wall" };

/**
 * Пересылка в отмеченные чаты: в каждый — комментарий обычным сообщением
 * (если есть), затем само пересылаемое (forward). Тосты — здесь же. true —
 * хоть куда-то ушло; false — никуда, шторка остаётся открытой для повтора.
 */
export async function sendToTargets(
  targets: ShareTarget[], comment: string, forward: (chatId: string) => Promise<unknown>, doneLabel: (t: ShareTarget) => string,
): Promise<boolean> {
  const failed = new Set<string>();
  let error = "";
  for (const tg of targets) {
    try {
      if (comment) await api.sendMessage(tg.id, comment);
      await forward(tg.id);
    } catch (e) {
      failed.add(tg.id);
      error = (e as Error)?.message || t("Не удалось переслать");
    }
  }
  const ok = targets.filter((tg) => !failed.has(tg.id));
  if (ok.length === 1) toast.success(doneLabel(ok[0]));
  else if (ok.length > 1) toast.success(t("Переслано в чаты: {n}", { n: ok.length }));
  if (failed.size) {
    toast.error(ok.length ? t("Не переслано: {list}", { list: targets.filter((tg) => failed.has(tg.id)).map((tg) => tg.title).join(", ") }) : error);
  }
  return ok.length > 0;
}
