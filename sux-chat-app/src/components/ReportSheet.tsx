import { useState } from "react";
import { Check, Flag, X } from "lucide-react";
import { toast } from "sonner";
import { api, type ReportReason, type ReportTarget } from "@/api/client";
import { cn } from "@/lib/utils";

const REASONS: { id: ReportReason; label: string }[] = [
  { id: "sexual", label: "Сексуальный контент" },
  { id: "violence", label: "Насилие или угрозы" },
  { id: "abuse", label: "Оскорбления, травля" },
  { id: "spam", label: "Спам или мошенничество" },
  { id: "illegal", label: "Противозаконное" },
  { id: "other", label: "Другое" },
];

/**
 * Шторка «Пожаловаться»: причина из списка и необязательный комментарий.
 *
 * Одна на все объекты — сообщение, пользователя, чат, пак. Жалоба уходит
 * в системный чат «Жалобы» (см. backend/chat/moderation.py), поэтому здесь
 * только сбор: без статусов, без «мы рассмотрим в течение…».
 */
const ReportSheet = ({
  target,
  title = "Пожаловаться",
  onClose,
}: {
  target: { type: ReportTarget; id: string };
  title?: string;
  onClose: () => void;
}) => {
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!reason || busy) return;
    setBusy(true);
    try {
      await api.report({ target_type: target.type, target_id: target.id, reason, comment: comment.trim() || undefined });
      toast.success("Жалоба отправлена");
      onClose();
    } catch (e: any) {
      toast.error(e?.message || "Не удалось отправить жалобу");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[95] bg-black/60 flex items-end md:items-center md:justify-center" onClick={onClose}>
      <div
        className="w-full md:w-[420px] bg-surface-2 rounded-t-[16px] md:rounded-lg md:border md:border-border p-5 pb-[calc(var(--sab)+20px)] md:pb-5 relative"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="md:hidden absolute top-2 left-1/2 -translate-x-1/2 w-9 h-1 rounded-full bg-foreground/20" aria-hidden />
        <div className="flex items-center gap-2 mb-4">
          <Flag className="w-5 h-5 text-primary" />
          <h2 className="text-h2 flex-1">{title}</h2>
          <button type="button" onClick={onClose} className="p-1.5 text-subtle" aria-label="Закрыть">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="rounded-lg bg-surface-4 divide-y divide-border overflow-hidden">
          {REASONS.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => setReason(r.id)}
              className={cn("w-full h-12 px-4 flex items-center gap-3 text-body text-left active:bg-surface-3", reason === r.id && "text-foreground")}
              aria-pressed={reason === r.id}
            >
              <span className="flex-1">{r.label}</span>
              {reason === r.id && <Check className="w-4 h-4 text-primary shrink-0" />}
            </button>
          ))}
        </div>

        <textarea
          value={comment}
          onChange={(e) => setComment(e.target.value.slice(0, 2000))}
          rows={3}
          placeholder="Что именно не так (необязательно)"
          className="mt-3 w-full rounded-md bg-surface-4 border border-transparent px-3 py-2 text-body outline-none resize-none focus:border-amber"
        />

        <button
          type="button"
          onClick={submit}
          disabled={!reason || busy}
          className="mt-3 w-full h-11 rounded-md bg-primary text-primary-foreground font-medium active:opacity-90 disabled:opacity-40"
        >
          {busy ? "Отправляю…" : "Отправить жалобу"}
        </button>
      </div>
    </div>
  );
};

export default ReportSheet;
