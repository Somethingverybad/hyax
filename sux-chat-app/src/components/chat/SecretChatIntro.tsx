import { Check, Lock, X } from "lucide-react";

/**
 * Плашка «что такое секретный чат» — перед созданием и перед принятием.
 * Пока человек не подтвердил, ключи не создаются и на сервер ничего не уходит.
 */
export default function SecretChatIntro({
  mode,
  peerName,
  busy,
  onConfirm,
  onCancel,
  onDecline,
}: {
  mode: "create" | "accept";
  peerName: string;
  busy?: boolean;
  onConfirm: () => void;
  onCancel?: () => void;
  onDecline?: () => void;
}) {
  const can = [
    "Текст с оформлением, ответы, редактирование и удаление у всех",
    "Фото, видео, музыка и файлы до 50 МБ — шифруются на устройстве до отправки",
    "Голосовые и кружки",
    "Реакции",
  ];
  const cannot = [
    "Стикеры и звуки",
    "Расшифровка голосовых в текст — её делает сервер",
    "Пересылать сообщения из чата и в чат",
    "Ботов и inline-ботов",
    "Читать переписку на другом устройстве — чат живёт только на этом",
    "Вернуть переписку после выхода из аккаунта",
  ];
  return (
    <div className="ui-card rounded-lg bg-surface-2 border border-border p-5 max-w-md w-full mx-auto">
      <div className="flex items-center gap-2 text-h2 text-foreground">
        <Lock className="w-5 h-5 text-online" />
        Секретный чат {mode === "create" ? "с" : "от"} {peerName}
      </div>
      <p className="mt-2 text-small text-subtle leading-relaxed">
        Сообщения шифруются на вашем устройстве и расшифровываются только на устройстве собеседника.
        Сервер хранит лишь шифротекст и прочитать его не может. Это отдельный чат — обычная
        переписка с {peerName} остаётся как была.
      </p>

      <div className="mt-4 grid grid-cols-1 gap-3">
        <div>
          <p className="text-caption uppercase tracking-wide text-subtle mb-1.5">Можно</p>
          <ul className="space-y-1">
            {can.map((t) => (
              <li key={t} className="flex items-start gap-2 text-small text-foreground">
                <Check className="w-4 h-4 mt-0.5 shrink-0 text-online" />{t}
              </li>
            ))}
          </ul>
        </div>
        <div>
          <p className="text-caption uppercase tracking-wide text-subtle mb-1.5">Нельзя</p>
          <ul className="space-y-1">
            {cannot.map((t) => (
              <li key={t} className="flex items-start gap-2 text-small text-foreground">
                <X className="w-4 h-4 mt-0.5 shrink-0 text-destructive" />{t}
              </li>
            ))}
          </ul>
        </div>
      </div>

      <p className="mt-4 text-caption text-subtle leading-relaxed">
        Сервер видит только, кто с кем переписывается, когда и какого размера файлы. Уведомления приходят без текста.
        Фото и файлы открываются чуть дольше обычного: сначала они загружаются на устройство.
        Ключ можно сверить с собеседником в меню чата — «Ключ шифрования».
      </p>

      {/* Кнопки прилипают к низу прокрутки: плашка выше экрана телефона, а
          «Принять» должно быть видно сразу. */}
      <div className="sticky bottom-0 -mx-5 -mb-5 mt-5 px-5 pb-5 pt-3 bg-surface-2 rounded-b-lg flex flex-col gap-2">
        <button type="button" onClick={onConfirm} disabled={busy}
          className="h-11 rounded-md bg-primary text-primary-foreground text-body font-medium active:opacity-90 disabled:opacity-50">
          {busy ? "Создаю ключи…" : mode === "create" ? "Понятно, создать секретный чат" : "Принять на этом устройстве"}
        </button>
        {mode === "accept" && onDecline && (
          <button type="button" onClick={onDecline} disabled={busy}
            className="h-11 rounded-md border border-border text-body text-foreground active:bg-surface-3 disabled:opacity-50">
            Отклонить
          </button>
        )}
        {onCancel && (
          <button type="button" onClick={onCancel} disabled={busy}
            className="h-10 text-small text-subtle active:text-foreground disabled:opacity-50">
            Отмена
          </button>
        )}
      </div>
    </div>
  );
}
